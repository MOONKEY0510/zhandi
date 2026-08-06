import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  CrashReporter,
  getConsent,
  setConsent,
  loadTelemetryEvents,
  clearTelemetryEvents,
  type TelemetryConsent,
} from './Telemetry';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('Telemetry（阶段 10 P0：崩溃/错误匿名统计同意机制）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('同意状态：未决定为 null，可持久化 granted/denied', () => {
    const storage = memoryStorage();
    expect(getConsent(storage)).toBeNull();
    setConsent('granted', storage);
    expect(getConsent(storage)).toBe('granted');
    setConsent('denied', storage);
    expect(getConsent(storage)).toBe('denied');
  });

  it('granted 时 syncWithConsent 激活捕获，denied 时停用', () => {
    const storage = memoryStorage();
    setConsent('granted', storage);
    const reporter = new CrashReporter(storage);
    reporter.syncWithConsent();
    expect(reporter.isActivated()).toBe(true);
    reporter.syncWithConsent();
    setConsent('denied', storage);
    reporter.syncWithConsent();
    expect(reporter.isActivated()).toBe(false);
  });

  it('激活后捕获 window error 并记录到队列（同源合并计数）', () => {
    const storage = memoryStorage();
    const reporter = new CrashReporter(storage);
    reporter.activate();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'main.js' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'main.js' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'other', filename: 'x.js' }));
    expect(reporter.getEventCount()).toBe(3);
    expect(reporter.getEvents().length).toBe(2);
    const boom = reporter.getEvents().find((e) => e.message === 'boom');
    expect(boom?.count).toBe(2);
    expect(boom?.type).toBe('error');
    reporter.deactivate();
  });

  it('捕获 unhandledrejection', () => {
    const storage = memoryStorage();
    const reporter = new CrashReporter(storage);
    reporter.activate();
    reporter.handleRejection(new Error('async fail'));
    expect(reporter.getEvents()[0]?.type).toBe('unhandledrejection');
    expect(reporter.getEvents()[0]?.message).toContain('async fail');
    reporter.deactivate();
  });

  it('deactivate 后不再捕获', () => {
    const storage = memoryStorage();
    const reporter = new CrashReporter(storage);
    reporter.activate();
    reporter.deactivate();
    window.dispatchEvent(new ErrorEvent('error', { message: 'ignored' }));
    expect(reporter.getEventCount()).toBe(0);
  });

  it('flush 模拟匿名上报并清空队列', () => {
    const storage = memoryStorage();
    const reporter = new CrashReporter(storage);
    reporter.activate();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    reporter.flush();
    expect(info).toHaveBeenCalled();
    expect(reporter.getEventCount()).toBe(0);
    expect(loadTelemetryEvents(storage).length).toBe(0);
    reporter.deactivate();
  });

  it('事件持久化到 storage：新实例可读取', () => {
    const storage = memoryStorage();
    const reporter = new CrashReporter(storage);
    reporter.activate();
    window.dispatchEvent(new ErrorEvent('error', { message: 'persist' }));
    reporter.deactivate();
    const reloaded = new CrashReporter(storage);
    expect(reloaded.getEvents()[0]?.message).toBe('persist');
    clearTelemetryEvents(storage);
    expect(loadTelemetryEvents(storage).length).toBe(0);
  });

  it('同意状态恢复默认：setConsent(null) 写空串', () => {
    const storage = memoryStorage();
    setConsent(null as TelemetryConsent, storage);
    expect(storage.getItem('zhandi.telemetry-consent.v1')).toBe('');
  });
});
