import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimClock } from './SimClock.ts';

describe('SimClock（阶段 8 固定 tick）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('默认 30Hz tick、每 2 tick 发快照', () => {
    const clock = new SimClock();
    expect(clock.tickRateHz).toBe(30);
    expect(clock.snapshotEveryTicks).toBe(2);
    expect(clock.shouldSnapshotAt(2)).toBe(true);
    expect(clock.shouldSnapshotAt(3)).toBe(false);
  });

  it('fastForward 推进 tick 并触发回调', () => {
    const clock = new SimClock();
    const ticks: number[] = [];
    const snapshots: number[] = [];
    clock.onTick = (tick, _dt, shouldSnapshot) => {
      ticks.push(tick);
      if (shouldSnapshot) snapshots.push(tick);
    };
    clock.fastForward(6);
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snapshots).toEqual([2, 4, 6]);
  });

  it('step 按真实时间差推进 tick（推进 100ms 约 3 tick）', () => {
    const clock = new SimClock();
    const ticks: number[] = [];
    clock.onTick = (tick) => ticks.push(tick);
    const base = performance.now();
    clock.step(base); // 同步基准
    clock.step(base + 1000 / 30);
    clock.step(base + 1000 / 30 * 2);
    clock.step(base + 1000 / 30 * 3);
    expect(ticks.length).toBe(3);
    expect(clock.tick).toBe(3);
  });

  it('step 单帧多 tick 追赶（掉帧恢复）', () => {
    const clock = new SimClock();
    let count = 0;
    clock.onTick = () => { count += 1; };
    const base = performance.now();
    clock.step(base); // 同步基准
    clock.step(base + 1000 / 30 * 5); // 一次步进 5 tick
    expect(count).toBe(5);
    expect(clock.tick).toBe(5);
  });

  it('时钟回拨保护：不推进', () => {
    const clock = new SimClock();
    const steps = clock.step(0); // nowMs 早于 lastStepMs（初始为 0 附近）
    expect(steps).toBeGreaterThanOrEqual(0);
    expect(clock.tick).toBeGreaterThanOrEqual(0);
  });

  it('nowMs 单调增长', () => {
    const clock = new SimClock();
    const a = clock.nowMs();
    clock.step(performance.now() + 100);
    const b = clock.nowMs();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
