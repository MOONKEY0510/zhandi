/**
 * 服务端玩家位置历史（阶段 8 第十九批：有限历史回溯 / lag compensation）。
 * 命中裁决需要「弹丸发射时刻」的目标位置（射手屏幕看到的是客户端插值缓冲的滞后位置），
 * 服务端按 tick 记录玩家位置，命中判定时按发射时刻线性插值采样。
 * 纯逻辑、无 I/O，可单测；ServerApp 每 tick 喂入玩家位置，弹道裁决查询采样。
 */

export interface PositionSample {
  timeMs: number;
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export interface SampledPosition {
  x: number;
  y: number;
  z: number;
}

/** 采样时间与记录时间的最小间隔（ms）：低于该间隔视为同一时刻，直接取最近记录 */
const SAMPLE_EPS_MS = 1;

export class PositionHistory {
  private samples: PositionSample[] = [];
  private readonly capacity: number;

  constructor(capacity = 128) {
    this.capacity = capacity;
  }

  /**
   * 记录一个位置采样（按时间单调追加；时间回退/相同时刻防御处理）。
   * ServerApp 每 tick（输入应用后 / 无输入 / 重生）调用。
   */
  record(timeMs: number, x: number, y: number, z: number, alive: boolean): void {
    const last = this.samples[this.samples.length - 1];
    if (last && timeMs < last.timeMs) return; // 乱序防御：忽略回退采样
    if (last && timeMs - last.timeMs < SAMPLE_EPS_MS) {
      // 同一时刻：替换（取最新状态，如同一 tick 内移动 + 重生）
      last.x = x;
      last.y = y;
      last.z = z;
      last.alive = alive;
      return;
    }
    this.samples.push({ timeMs, x, y, z, alive });
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  /**
   * 按时刻线性插值采样位置。
   * - 早于最旧样本（超回溯窗口）→ null（调用方回退当前帧位置）；
   * - 晚于最新样本 → 返回最新位置（当前帧）；
   * - 两样本之间 → 线性插值。
   */
  sampleAt(timeMs: number, maxAgeMs: number): SampledPosition | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const oldest = this.samples[0];
    const newest = this.samples[n - 1];
    if (timeMs < oldest.timeMs - maxAgeMs - SAMPLE_EPS_MS) return null; // 超窗
    if (timeMs <= oldest.timeMs) return { x: oldest.x, y: oldest.y, z: oldest.z };
    if (timeMs >= newest.timeMs) return { x: newest.x, y: newest.y, z: newest.z };

    // 二分查找最后一个 timeMs <= 查询时刻的样本
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid].timeMs <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    const a = this.samples[lo];
    const b = this.samples[lo + 1];
    if (!b || b.timeMs <= a.timeMs) return { x: a.x, y: a.y, z: a.z };
    const t = (timeMs - a.timeMs) / (b.timeMs - a.timeMs);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  /** 最新样本时间（无样本返回 null） */
  get newestTimeMs(): number | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].timeMs : null;
  }

  get size(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples = [];
  }
}
