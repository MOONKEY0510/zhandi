/**
 * 快照缓冲与插值（阶段 8 P0：客户端网络体验）。
 * 服务器快照进入环形缓冲，按渲染时间在相邻两帧间插值，避免抖动；
 * 丢包时短时保持上一帧，超时标记冻结（fade）。
 * 纯逻辑、可单测。
 */

import type { SnapshotPlayer } from '../../shared/protocol.ts';

export interface SnapshotData {
  tick: number;
  serverTime: number;
  players: SnapshotPlayer[];
}

export interface InterpolatedPlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
  /** 插值基准帧（调试用） */
  fromTick: number;
  toTick: number;
  /** 是否由最后两帧速度外推（丢包短时补偿） */
  extrapolated?: boolean;
}

export interface SnapshotBufferStats {
  buffered: number;
  lastTick: number;
  /** 渲染时间落后最新快照的毫秒数（插值延迟） */
  lagMs: number;
  /** 是否因无新快照而冻结（staleness > 冻结阈值） */
  frozen: boolean;
}

export interface SnapshotBufferOptions {
  maxBuffered?: number;
  /** 渲染延迟 ms（默认 100ms，等于 2 帧快照间隔） */
  renderDelayMs?: number;
  /** 冻结阈值 ms：超过则标记 frozen */
  freezeThresholdMs?: number;
  /** 丢包短时外推窗口 ms：渲染时间超过最新快照但未超此窗口时按最后两帧速度外推 */
  extrapolateMs?: number;
}

export class SnapshotBuffer {
  private snapshots: SnapshotData[] = [];
  private readonly maxBuffered: number;
  private readonly renderDelayMs: number;
  private readonly freezeThresholdMs: number;
  private readonly extrapolateMs: number;

  constructor(options: SnapshotBufferOptions = {}) {
    this.maxBuffered = options.maxBuffered ?? 30;
    this.renderDelayMs = options.renderDelayMs ?? 100;
    this.freezeThresholdMs = options.freezeThresholdMs ?? 500;
    this.extrapolateMs = options.extrapolateMs ?? 200;
  }

  /** 压入服务端快照：按 tick 去重，淘汰过旧 */
  push(snapshot: SnapshotData): void {
    if (this.snapshots.some((s) => s.tick === snapshot.tick)) return;
    this.snapshots.push(snapshot);
    this.snapshots.sort((a, b) => a.tick - b.tick);
    if (this.snapshots.length > this.maxBuffered) {
      this.snapshots.splice(0, this.snapshots.length - this.maxBuffered);
    }
  }

  /** 指定渲染时间（= 最新快照时间 - 插值延迟）下的插值结果 */
  interpolate(renderServerTime?: number): Map<string, InterpolatedPlayer> | null {
    if (this.snapshots.length === 0) return null;

    const latest = this.snapshots[this.snapshots.length - 1];
    const target = renderServerTime ?? latest.serverTime - this.renderDelayMs;

    // 渲染时间超过最新快照：短时按最后两帧速度外推，超窗冻结（保持最新帧）
    if (target >= latest.serverTime) {
      const aheadMs = target - latest.serverTime;
      if (aheadMs <= this.extrapolateMs && this.snapshots.length >= 2) {
        return this.extrapolate(aheadMs);
      }
      return this.interpolateAt(this.snapshots.length - 1, this.snapshots.length - 1, 0);
    }

    // 找到 target 所在区间 [i, i+1]
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const a = this.snapshots[i];
      const b = this.snapshots[i + 1];
      if (target >= a.serverTime && target <= b.serverTime) {
        const span = b.serverTime - a.serverTime;
        const alpha = span > 0 ? (target - a.serverTime) / span : 0;
        return this.interpolateAt(i, i + 1, Math.min(1, Math.max(0, alpha)));
      }
    }

    // target 早于最早快照 → 用最早帧
    return this.interpolateAt(0, 0, 0);
  }

  /** 丢包短时外推：按最后两帧速度推进（新玩家/静止者冻结在最新帧） */
  private extrapolate(aheadMs: number): Map<string, InterpolatedPlayer> {
    const n = this.snapshots.length;
    const latest = this.snapshots[n - 1];
    const prev = this.snapshots[n - 2];
    const dtMs = latest.serverTime - prev.serverTime;
    const dtSec = dtMs > 0 ? dtMs / 1000 : 0;
    const aheadSec = aheadMs / 1000;
    const prevById = new Map<string, SnapshotPlayer>();
    for (const p of prev.players) prevById.set(p.id, p);

    const result = new Map<string, InterpolatedPlayer>();
    for (const p of latest.players) {
      const pa = prevById.get(p.id);
      if (!pa || dtSec <= 0 || !p.alive) {
        result.set(p.id, {
          id: p.id,
          x: p.x, y: p.y, z: p.z,
          yaw: p.yaw, pitch: p.pitch,
          health: p.health, alive: p.alive,
          fromTick: latest.tick, toTick: latest.tick,
          extrapolated: false,
        });
        continue;
      }
      result.set(p.id, {
        id: p.id,
        x: p.x + ((p.x - pa.x) / dtSec) * aheadSec,
        y: p.y + ((p.y - pa.y) / dtSec) * aheadSec,
        z: p.z + ((p.z - pa.z) / dtSec) * aheadSec,
        yaw: p.yaw + (angleDelta(pa.yaw, p.yaw) / dtSec) * aheadSec,
        pitch: p.pitch + ((p.pitch - pa.pitch) / dtSec) * aheadSec,
        health: p.health,
        alive: p.alive,
        fromTick: latest.tick,
        toTick: latest.tick,
        extrapolated: true,
      });
    }
    return result;
  }

  private interpolateAt(aIndex: number, bIndex: number, alpha: number): Map<string, InterpolatedPlayer> {
    const a = this.snapshots[aIndex];
    const b = this.snapshots[bIndex];
    const result = new Map<string, InterpolatedPlayer>();
    const byId = new Map<string, SnapshotPlayer>();
    for (const p of b.players) byId.set(p.id, p);
    const aById = new Map<string, SnapshotPlayer>();
    for (const p of a.players) aById.set(p.id, p);

    for (const pb of b.players) {
      const pa = aById.get(pb.id);
      if (!pa || aIndex === bIndex) {
        result.set(pb.id, {
          id: pb.id,
          x: pb.x, y: pb.y, z: pb.z,
          yaw: pb.yaw, pitch: pb.pitch,
          health: pb.health, alive: pb.alive,
          fromTick: b.tick, toTick: b.tick,
        });
        continue;
      }
      result.set(pb.id, {
        id: pb.id,
        x: lerp(pa.x, pb.x, alpha),
        y: lerp(pa.y, pb.y, alpha),
        z: lerp(pa.z, pb.z, alpha),
        yaw: lerpAngle(pa.yaw, pb.yaw, alpha),
        pitch: lerp(pa.pitch, pb.pitch, alpha),
        health: lerp(pa.health, pb.health, alpha),
        alive: pb.alive,
        fromTick: a.tick,
        toTick: b.tick,
      });
    }

    // 只存在于 a 的玩家（在 b 中消失：离开/死亡）→ 保持 a 最后一帧
    for (const pa of a.players) {
      if (!byId.has(pa.id)) {
        result.set(pa.id, {
          id: pa.id,
          x: pa.x, y: pa.y, z: pa.z,
          yaw: pa.yaw, pitch: pa.pitch,
          health: pa.health, alive: pa.alive,
          fromTick: a.tick, toTick: a.tick,
        });
      }
    }
    return result;
  }

  getLatest(): SnapshotData | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  stats(renderServerTime?: number): SnapshotBufferStats {
    const latest = this.getLatest();
    if (!latest) {
      return { buffered: 0, lastTick: -1, lagMs: 0, frozen: false };
    }
    const target = renderServerTime ?? latest.serverTime - this.renderDelayMs;
    const lagMs = latest.serverTime - target;
    return {
      buffered: this.snapshots.length,
      lastTick: latest.tick,
      lagMs,
      frozen: lagMs > this.freezeThresholdMs,
    };
  }

  clear(): void {
    this.snapshots = [];
  }
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** 最短弧有符号角差（±π） */
function angleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function lerpAngle(a: number, b: number, alpha: number): number {
  return a + angleDelta(a, b) * alpha;
}
