import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetSimulator } from './NetSimulator.ts';

function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe('NetSimulator（阶段 8 网络模拟）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 固定随机：不丢包、不乱序
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('无配置：立即投递', () => {
    const sim = new NetSimulator();
    const received: Uint8Array[] = [];
    sim.onReceive = (b) => received.push(b);
    sim.send(new Uint8Array([1, 2, 3]));
    advance(0);
    expect(received.length).toBe(1);
    expect(received[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(sim.stats.sent).toBe(1);
    expect(sim.stats.received).toBe(1);
  });

  it('基础延迟：延迟后再投递', () => {
    const sim = new NetSimulator({ latencyMs: 100 });
    const received: Uint8Array[] = [];
    sim.onReceive = (b) => received.push(b);
    sim.send(new Uint8Array([1]));
    advance(50);
    expect(received.length).toBe(0);
    advance(50);
    expect(received.length).toBe(1);
    expect(sim.stats.delayed).toBe(1);
  });

  it('丢包：按概率丢弃', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.3 → 丢
    const sim = new NetSimulator({ lossRate: 0.3 });
    let received = 0;
    sim.onReceive = () => { received += 1; };
    sim.send(new Uint8Array([1]));
    advance(0);
    expect(received).toBe(0);
    expect(sim.stats.dropped).toBe(1);
  });

  it('抖动：实际延迟在 [base-jitter, base+jitter] 内', () => {
    const sim = new NetSimulator({ latencyMs: 50, jitterMs: 20 });
    const sim2 = new NetSimulator({ latencyMs: 50, jitterMs: 20 });
    let received = 0;
    sim.onReceive = () => { received += 1; };
    sim2.onReceive = () => { received += 1; };
    // random=0.5 → jitter = 0 → delay 50ms
    sim.send(new Uint8Array([1]));
    advance(50);
    expect(received).toBe(1);
  });

  it('乱序：交换相邻包投递顺序', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // reorder 命中 (0.5 < 1)
    const sim = new NetSimulator({ latencyMs: 10, reorderRate: 1 });
    const received: number[] = [];
    sim.onReceive = (b) => received.push(b[0]);
    sim.send(new Uint8Array([1]));
    sim.send(new Uint8Array([2]));
    // 交换后第 1 包落在基础延迟 +0.001ms（抖动扰动），推进 11ms 覆盖整个投递窗
    advance(11);
    expect(received).toEqual([2, 1]);
    expect(sim.stats.reordered).toBe(1);
  });

  it('带宽限速：超限包丢弃，令牌桶恢复', () => {
    const sim = new NetSimulator({ bandwidthBps: 10 }); // 10 B/s
    let received = 0;
    sim.onReceive = () => { received += 1; };
    sim.send(new Uint8Array(new Array(20).fill(1))); // 20B > 桶 → 丢
    expect(sim.stats.dropped).toBe(1);
    advance(2000); // 2s 攒 20B
    sim.send(new Uint8Array(new Array(5).fill(1)));
    advance(0);
    expect(received).toBe(1);
  });

  it('dispose 后不再投递', () => {
    const sim = new NetSimulator({ latencyMs: 50 });
    sim.onReceive = () => { throw new Error('不应投递'); };
    sim.send(new Uint8Array([1]));
    sim.dispose();
    advance(100);
    expect(sim.pendingCount).toBe(0);
  });

  it('seed：相同种子丢包模式可复现（压测确定性）', () => {
    const run = (seed: number): { received: number; dropped: number } => {
      const sim = new NetSimulator({ lossRate: 0.3, seed });
      let received = 0;
      sim.onReceive = () => { received += 1; };
      for (let i = 0; i < 20; i += 1) sim.send(new Uint8Array([i]));
      advance(0);
      return { received, dropped: sim.stats.dropped };
    };
    const a1 = run(42);
    const a2 = run(42);
    expect(a1).toEqual(a2);
    // 2% 级别的丢失统计与种子相关：20 个包、30% 丢包，期望有丢有收
    expect(a1.dropped).toBeGreaterThan(0);
    expect(a1.received).toBeGreaterThan(0);
    // 不同种子通常产生不同模式（确定性 PRNG 并非平凡重复）
    const b = run(43);
    expect(b).not.toEqual(a1);
  });
});
