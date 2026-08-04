/**
 * 固定 tick 时钟（阶段 8 P0：服务器架构）。
 * 以单调时钟驱动，每 tick 调用回调；快照按 SNAPSHOT_EVERY_TICKS 节拍广播。
 */

import { TICK_RATE_HZ, SNAPSHOT_EVERY_TICKS } from '../shared/protocol.ts';

export interface SimClockOptions {
  tickRateHz?: number;
  snapshotEveryTicks?: number;
  /** 单次 step 最大追赶 tick 数（防 GC 暂停/时钟异常导致循环爆炸），0 = 不限制 */
  maxCatchUpTicks?: number;
}

export class SimClock {
  readonly tickRateHz: number;
  readonly snapshotEveryTicks: number;
  readonly maxCatchUpTicks: number;
  /** 当前 tick（单调递增） */
  tick = 0;
  /** 服务端时间基准（ms，单调） */
  private timeBaseMs: number;
  private accumulatorMs = 0;
  private lastStepMs: number;
  private lastSnapshotTick = 0;
  /** 每 tick 回调（返回 true 表示该 tick 需要广播快照） */
  onTick: ((tick: number, deltaSeconds: number, shouldSnapshot: boolean) => void) | null = null;

  constructor(options: SimClockOptions = {}) {
    this.tickRateHz = options.tickRateHz ?? TICK_RATE_HZ;
    this.snapshotEveryTicks = options.snapshotEveryTicks ?? SNAPSHOT_EVERY_TICKS;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? 90;
    this.timeBaseMs = nowMonotonic();
    this.lastStepMs = this.timeBaseMs;
  }

  /** 处理自上次 step 以来的时间差，返回本帧应推进的 tick 数 */
  step(nowMs = nowMonotonic()): number {
    const elapsed = nowMs - this.lastStepMs;
    this.lastStepMs = nowMs;
    if (elapsed < 0) return 0; // 时钟回拨保护

    this.accumulatorMs += elapsed;
    const tickMs = 1000 / this.tickRateHz;
    let steps = 0;
    while (this.accumulatorMs >= tickMs) {
      if (this.maxCatchUpTicks > 0 && steps >= this.maxCatchUpTicks) {
        // 追赶上限：丢弃积压（慢机器/暂停后不追帧，避免螺旋死循环）
        this.accumulatorMs = 0;
        break;
      }
      this.accumulatorMs -= tickMs;
      this.tick += 1;
      steps += 1;
      const shouldSnapshot = this.shouldSnapshotAt(this.tick);
      this.onTick?.(this.tick, tickMs / 1000, shouldSnapshot);
    }
    return steps;
  }

  /** 指定 tick 是否应发快照（tick 节拍对齐） */
  shouldSnapshotAt(tick: number): boolean {
    return tick % this.snapshotEveryTicks === 0;
  }

  /** 服务端当前时间（ms） */
  nowMs(): number {
    return nowMonotonic() - this.timeBaseMs;
  }

  /** 模拟长时间流逝（测试用）：推进若干 tick 而不依赖真实时间 */
  fastForward(ticks: number): void {
    const tickMs = 1000 / this.tickRateHz;
    for (let i = 0; i < ticks; i++) {
      this.tick += 1;
      const shouldSnapshot = this.shouldSnapshotAt(this.tick);
      this.onTick?.(this.tick, tickMs / 1000, shouldSnapshot);
    }
    // 同步累加器，避免随后 step() 重复推进
    this.accumulatorMs = 0;
  }
}

function nowMonotonic(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
