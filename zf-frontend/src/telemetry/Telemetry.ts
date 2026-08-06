/**
 * 崩溃/错误匿名统计（阶段 10 P0：同意机制）。
 * 用户显式同意后激活全局错误捕获（window.onerror / unhandledrejection），
 * 收集匿名事件到本地队列（不含个人信息），模拟匿名上报（真实端点不存在时以 console 记录 + 队列可读）。
 */

export type TelemetryConsent = 'granted' | 'denied' | null;

const CONSENT_KEY = 'zhandi.telemetry-consent.v1';
const EVENTS_KEY = 'zhandi.telemetry-events.v1';
const MAX_EVENTS = 50;

export interface TelemetryEvent {
  type: 'error' | 'unhandledrejection';
  message: string;
  source?: string;
  stack?: string;
  time: number;
  count: number;
}

export function getConsent(storage: Pick<Storage, 'getItem'> = localStorage): TelemetryConsent {
  const raw = storage.getItem(CONSENT_KEY);
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

export function setConsent(
  value: TelemetryConsent,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(CONSENT_KEY, value ?? '');
}

export function loadTelemetryEvents(
  storage: Pick<Storage, 'getItem'> = localStorage,
): TelemetryEvent[] {
  try {
    const raw = storage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TelemetryEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearTelemetryEvents(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  storage.removeItem(EVENTS_KEY);
}

/**
 * 匿名崩溃统计上报器：同意后激活捕获，事件入本地队列（同源合并计数，上限 50 条）。
 */
export class CrashReporter {
  private events: TelemetryEvent[] = [];
  private activated = false;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage) {
    this.storage = storage;
    this.events = loadTelemetryEvents(storage);
  }

  /** 按当前同意状态激活/停用捕获（granted 激活，denied/未决定停用） */
  syncWithConsent(): void {
    if (getConsent(this.storage) === 'granted') this.activate();
    else this.deactivate();
  }

  activate(): void {
    if (this.activated) return;
    this.activated = true;
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  deactivate(): void {
    if (!this.activated) return;
    this.activated = false;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  isActivated(): boolean {
    return this.activated;
  }

  /** 模拟匿名上报：console 记录并清空本地队列（真实上报端点接入时替换此方法） */
  flush(): void {
    if (this.events.length === 0) return;
    console.info(
      `[telemetry] 匿名上报 ${this.events.length} 条崩溃/错误事件（不包含个人信息）`,
      this.events,
    );
    this.events = [];
    this.storage.removeItem(EVENTS_KEY);
  }

  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.reduce((sum, e) => sum + e.count, 0);
  }

  private readonly onError = (event: ErrorEvent): void => {
    this.record({
      type: 'error',
      message: event.message || 'Unknown error',
      source: event.filename,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  };

  private readonly onRejection = (event: PromiseRejectionEvent): void => {
    this.handleRejection(event.reason);
  };

  /** 记录一次未捕获的 Promise rejection（事件处理器与外部调用共用） */
  handleRejection(reason: unknown): void {
    this.record({
      type: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  }

  private record(event: Omit<TelemetryEvent, 'time' | 'count'>): void {
    const existing = this.events.find(
      (e) => e.type === event.type && e.message === event.message && e.source === event.source,
    );
    if (existing) {
      existing.count += 1;
      existing.time = Date.now();
    } else {
      this.events.push({ ...event, time: Date.now(), count: 1 });
      // 上限保护：超出丢弃最旧的
      if (this.events.length > MAX_EVENTS) this.events.shift();
    }
    try {
      this.storage.setItem(EVENTS_KEY, JSON.stringify(this.events));
    } catch {
      // localStorage 满/不可用时静默（内存队列仍保留）
    }
  }
}
