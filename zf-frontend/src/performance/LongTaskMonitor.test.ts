import { describe, expect, it, vi } from 'vitest';
import { LongTaskMonitor, type LongTaskObserverLike } from './LongTaskMonitor';

/** 捕获 monitor 创建的 observer，便于手动触发回调 */
function captureObserver() {
  let captured: LongTaskObserverLike | null = null;
  const factory = () => {
    captured = {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
    return captured;
  };
  return { factory, get: () => captured! };
}

describe('LongTaskMonitor（阶段 9：GC/长任务观测）', () => {
  it('start 创建 observer 并 observe longtask', () => {
    const { factory, get } = captureObserver();
    const monitor = new LongTaskMonitor({ observerFactory: factory });
    monitor.start();
    expect(get().observe).toHaveBeenCalledWith({ entryTypes: ['longtask'] });
    monitor.stop();
    expect(get().disconnect).toHaveBeenCalled();
  });

  it('重复 start 不重复创建 observer', () => {
    const { factory, get } = captureObserver();
    const monitor = new LongTaskMonitor({ observerFactory: factory });
    monitor.start();
    monitor.start();
    expect(get().observe).toHaveBeenCalledTimes(1);
  });

  it('记录超过阈值的长任务并统计窗口内 max/count/last', () => {
    let clock = 0;
    const { factory, get } = captureObserver();
    const monitor = new LongTaskMonitor({ observerFactory: factory, now: () => clock });
    monitor.start();

    monitor.handleEntries([
      { duration: 120, startTime: 1000 },
      { duration: 30, startTime: 1100 }, // 低于阈值 50ms：忽略
      { duration: 65, startTime: 1200 },
    ]);
    clock = 2000;
    const stats = monitor.getStats();

    expect(stats.count).toBe(2);
    expect(stats.maxMs).toBe(120);
    expect(stats.lastMs).toBe(65);
    expect(stats.lastAt).toBe(1200);
    void get;
  });

  it('滚动窗口：窗口外的旧长任务不计入 count/max', () => {
    let clock = 0;
    const monitor = new LongTaskMonitor({ observerFactory: () => null, now: () => clock, windowMs: 60_000 });
    monitor.handleEntries([{ duration: 200, startTime: 1000 }]);

    clock = 70_000; // 超出 60s 窗口
    const stats = monitor.getStats();
    expect(stats.count).toBe(0);
    expect(stats.maxMs).toBe(0);
  });

  it('不支持 PerformanceObserver 的环境 start 为 no-op，不抛错', () => {
    const monitor = new LongTaskMonitor({ observerFactory: () => null });
    expect(() => monitor.start()).not.toThrow();
    expect(monitor.getStats()).toEqual({ count: 0, maxMs: 0, lastMs: 0, lastAt: 0 });
  });

  it('reset 清空统计', () => {
    const monitor = new LongTaskMonitor({ observerFactory: () => null });
    monitor.handleEntries([{ duration: 100, startTime: 0 }]);
    monitor.reset();
    expect(monitor.getStats()).toEqual({ count: 0, maxMs: 0, lastMs: 0, lastAt: 0 });
  });
});
