/**
 * 网络条件模拟器（阶段 8 P0：网络模拟面板）。
 * 在真实传输外层注入：基础延迟、抖动、丢包、乱序、带宽限速。
 * 纯逻辑、可单测；客户端联调时作为传输包装，F3 面板可实时调参。
 */

export interface NetSimOptions {
  /** 基础单向延迟 ms */
  latencyMs?: number;
  /** 抖动幅度 ms（实际延迟 = 基础 ± 均匀抖动） */
  jitterMs?: number;
  /** 丢包率 0..1 */
  lossRate?: number;
  /** 乱序率 0..1：延迟窗口内与相邻包交换顺序 */
  reorderRate?: number;
  /** 带宽上限 B/s（令牌桶），0 = 不限 */
  bandwidthBps?: number;
}

export interface NetSimStats {
  sent: number;
  received: number;
  dropped: number;
  reordered: number;
  delayed: number;
}

interface PendingPacket {
  bytes: Uint8Array;
  deliverAt: number;
  order: number;
}

export class NetSimulator {
  private readonly opts: Required<NetSimOptions>;
  onReceive: ((bytes: Uint8Array) => void) | null = null;
  private pending: PendingPacket[] = [];
  private orderCounter = 0;
  private tokenBucket = 0;
  private lastRefillMs = 0;
  readonly stats: NetSimStats = { sent: 0, received: 0, dropped: 0, reordered: 0, delayed: 0 };
  private disposed = false;

  constructor(options: NetSimOptions = {}) {
    this.opts = {
      latencyMs: options.latencyMs ?? 0,
      jitterMs: options.jitterMs ?? 0,
      lossRate: options.lossRate ?? 0,
      reorderRate: options.reorderRate ?? 0,
      bandwidthBps: options.bandwidthBps ?? 0,
    };
    this.lastRefillMs = this.now();
  }

  updateOptions(options: NetSimOptions): void {
    Object.assign(this.opts, options);
  }

  /** 发送：应用丢包/限速/延迟后异步投递 */
  send(bytes: Uint8Array): void {
    if (this.disposed) return;
    this.stats.sent += 1;

    // 丢包
    if (this.opts.lossRate > 0 && Math.random() < this.opts.lossRate) {
      this.stats.dropped += 1;
      return;
    }

    // 带宽限速（令牌桶）：超限包直接丢弃
    if (this.opts.bandwidthBps > 0) {
      this.refillTokens();
      if (this.tokenBucket < bytes.length) {
        this.stats.dropped += 1;
        return;
      }
      this.tokenBucket -= bytes.length;
    }

    // 延迟 = 基础 + 抖动
    const jitter = this.opts.jitterMs > 0
      ? (Math.random() * 2 - 1) * this.opts.jitterMs
      : 0;
    const delay = Math.max(0, this.opts.latencyMs + jitter);

    const packet: PendingPacket = { bytes, deliverAt: this.now() + delay, order: this.orderCounter++ };
    this.pending.push(packet);

    if (delay > 0) {
      this.stats.delayed += 1;
    }

    // 乱序：新包与上一个延迟窗口内的包交换投递顺序
    if (this.opts.reorderRate > 0 && this.pending.length >= 2 && Math.random() < this.opts.reorderRate) {
      const prev = this.pending[this.pending.length - 2];
      packet.deliverAt = prev.deliverAt - 0.001; // 早于前一个投递
      prev.deliverAt += 0.001;
      this.stats.reordered += 1;
    }

    this.scheduleFlush();
  }

  /** 驱动投递：按当前时间交付到期包（测试用可手动调用） */
  flush(): void {
    if (this.disposed) return;
    const now = this.now();
    const due = this.pending
      .filter((p) => p.deliverAt <= now)
      .sort((a, b) => a.deliverAt - b.deliverAt || a.order - b.order);
    if (due.length > 0) {
      this.pending = this.pending.filter((p) => p.deliverAt > now);
      for (const packet of due) {
        this.stats.received += 1;
        this.onReceive?.(packet.bytes);
      }
    }
    // 仍有未到期包 → 按下一个投递时刻重新调度
    if (this.pending.length > 0 && !this.disposed) {
      this.scheduleFlush();
    }
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    this.onReceive = null;
  }

  private scheduleFlush(): void {
    const next = this.pending.reduce((min, p) => Math.min(min, p.deliverAt), Infinity);
    const delayMs = Math.max(0, next - this.now());
    setTimeout(() => this.flush(), Math.min(delayMs, 1000));
  }

  private refillTokens(): void {
    const now = this.now();
    const elapsed = (now - this.lastRefillMs) / 1000;
    this.lastRefillMs = now;
    this.tokenBucket = Math.min(this.opts.bandwidthBps, this.tokenBucket + elapsed * this.opts.bandwidthBps);
  }

  private now(): number {
    // 用 Date.now()（vitest fake timers 可 mock），延迟/令牌桶都基于相对差值
    return Date.now();
  }
}
