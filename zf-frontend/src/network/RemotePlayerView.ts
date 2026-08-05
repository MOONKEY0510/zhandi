/**
 * 远端玩家渲染视图（阶段 8 第九批：GameScene 网络接入）。
 * 将 NetClient 快照插值结果维护为"渲染姿势集合"，GameScene 每帧据此同步远端 mesh。
 * 纯逻辑、无 Three.js 依赖，可独立单测。
 */

import type { InterpolatedPlayer } from './SnapshotBuffer.ts';

export interface RemotePose {
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

export class RemotePlayerView {
  private poses = new Map<string, RemotePose>();

  /** 以最新插值结果整体替换远端姿势集合；快照中消失的玩家（离开/移除）同步清除 */
  apply(players: ReadonlyMap<string, InterpolatedPlayer>): void {
    for (const p of players.values()) {
      this.poses.set(p.id, {
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        health: p.health,
        alive: p.alive,
        fromTick: p.fromTick,
        toTick: p.toTick,
        extrapolated: p.extrapolated,
      });
    }
    // 快照中不再出现的玩家（离开房间/被移除）从渲染集合删除
    for (const id of [...this.poses.keys()]) {
      if (!players.has(id)) this.poses.delete(id);
    }
  }

  /** 显式移除单个玩家（player_leave 消息：立即消失，不等插值窗口过期） */
  remove(id: string): void {
    this.poses.delete(id);
  }

  clear(): void {
    this.poses.clear();
  }

  get(id: string): RemotePose | undefined {
    return this.poses.get(id);
  }

  getPoses(): ReadonlyMap<string, RemotePose> {
    return this.poses;
  }

  get size(): number {
    return this.poses.size;
  }
}
