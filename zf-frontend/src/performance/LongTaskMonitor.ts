/**
 * 长任务监控（阶段 9：GC/长任务观测）。
 *
 * 验收标准要求「GC 单次暂停 P95 < 4 ms」，但浏览器不暴露 GC 事件；
 * PerformanceObserver('longtask') 是标准代理——主线程任务 >50ms（含 GC
 * 大暂停、布局风暴、同步解码）会被上报。本监控滚动窗口统计长任务次数、
 * 最大/最近时长，接 F3 性能面板与导出 JSON，作为「GC 暂停 P95」的可观测
 * 近似指标。
 *
 * 依赖注入：jsdom/Node 无 PerformanceObserver，observerFactory 可注入
 * fake（测试）；不支持时 start() 为 no-op，不抛错。
 */

export interface LongTaskStats {
  /** 滚动窗口内长任务次数 */
  count: number;
  /** 窗口内最长任务 ms */
  maxMs: number;
  /** 最近一次长任务 ms（无则 0） */
  lastMs: number;
  /** 最近一次长任务发生时间（performance.now()，无则 0） */
  lastAt: number;
}

export interface LongTaskObserverLike {
  observe(options?: { entryTypes?: string[]; type?: string; buffered?: boolean }): void;
  disconnect(): void;
}

export interface LongTaskMonitorOptions {
  /** 统计滚动窗口 ms（默认 60s） */
  windowMs?: number;
  /** 长任务阈值 ms（默认 50，PerformanceObserver 标准阈值） */
  thresholdMs?: number;
  /** 注入 observer 工厂（测试/降级用）；缺省用全局 PerformanceObserver */
  observerFactory?: () => LongTaskObserverLike | null;
  /** 时钟（测试用） */
  now?: () => number;
}

interface LongTaskEntry {
  durationMs: number;
  atMs: number;
}

export class LongTaskMonitor {
  private observer: LongTaskObserverLike | null = null;
  private readonly windowMs: number;
  private readonly thresholdMs: number;
  private readonly observerFactory: () => LongTaskObserverLike | null;
  private readonly now: () => number;

  private entries: LongTaskEntry[] = [];
  private lastMs = 0;
  private lastAt = 0;

  constructor(options: LongTaskMonitorOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.thresholdMs = options.thresholdMs ?? 50;
    this.observerFactory =
      options.observerFactory ??
      (() => {
        const Ctor = (globalThis as { PerformanceObserver?: new (cb: PerformanceObserverCallback) => PerformanceObserver })
          .PerformanceObserver;
        if (!Ctor) return null;
        return new Ctor((list) => this.handleEntries(list.getEntries()));
      });
    this.now = options.now ?? (() => performance.now());
  }

  /** 开始监听；环境不支持 PerformanceObserver 时为 no-op */
  start(): void {
    if (this.observer) return;
    this.observer = this.observerFactory();
    this.observer?.observe({ entryTypes: ['longtask'] });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  reset(): void {
    this.entries = [];
    this.lastMs = 0;
    this.lastAt = 0;
  }

  getStats(): LongTaskStats {
    const cutoff = this.now() - this.windowMs;
    const inWindow = this.entries.filter((e) => e.atMs >= cutoff);
    return {
      count: inWindow.length,
      maxMs: inWindow.length > 0 ? Math.max(...inWindow.map((e) => e.durationMs)) : 0,
      lastMs: this.lastMs,
      lastAt: this.lastAt,
    };
  }

  /** 供注入的 observer 回调调用（测试可直接调用） */
  handleEntries(entries: readonly { duration: number; startTime: number }[]): void {
    for (const entry of entries) {
      if (entry.duration < this.thresholdMs) continue;
      this.entries.push({ durationMs: entry.duration, atMs: entry.startTime });
      this.lastMs = entry.duration;
      this.lastAt = entry.startTime;
    }
    // 内存护栏：长任务极罕见，超过上限截半（防止异常路径无限增长）
    if (this.entries.length > 1024) {
      this.entries.splice(0, this.entries.length - 1024);
    }
  }
}
