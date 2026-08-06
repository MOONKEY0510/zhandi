import { describe, it, expect, beforeEach } from 'vitest';
import { addReport, clearReports, loadReports, REPORT_REASONS } from './Reports';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: store.size,
  } as unknown as Storage;
}

describe('Reports（阶段 10 P1：举报记录持久化）', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('addReport 写入后可读回', () => {
    const entry = addReport(
      { targetId: 'bot_3', targetName: 'AI Bot 4', reason: 'cheat', note: ' 疑似自瞄  ' },
      storage,
    );
    expect(entry.id).toBeTruthy();
    expect(entry.time).toBeGreaterThan(0);
    expect(entry.note).toBe('疑似自瞄'); // 去空格

    const loaded = loadReports(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].targetId).toBe('bot_3');
    expect(loaded[0].reason).toBe('cheat');
  });

  it('空存储返回空数组；损坏数据容错返回空', () => {
    expect(loadReports(storage)).toEqual([]);
    storage.setItem('zhandi.reports.v1', '{broken json');
    expect(loadReports(storage)).toEqual([]);
    storage.setItem('zhandi.reports.v1', JSON.stringify({ not: 'array' }));
    expect(loadReports(storage)).toEqual([]);
  });

  it('最多保留 50 条（超出后保留最新）', () => {
    for (let i = 0; i < 55; i++) {
      addReport({ targetId: `bot_${i}`, targetName: `B${i}`, reason: 'other' }, storage);
    }
    const loaded = loadReports(storage);
    expect(loaded).toHaveLength(50);
    expect(loaded[49].targetId).toBe('bot_54');
  });

  it('clearReports 清空', () => {
    addReport({ targetId: 'bot_1', targetName: 'B1', reason: 'toxic' }, storage);
    clearReports(storage);
    expect(loadReports(storage)).toEqual([]);
  });

  it('REPORT_REASONS 含 4 种理由且 id 唯一', () => {
    expect(REPORT_REASONS).toHaveLength(4);
    const ids = new Set(REPORT_REASONS.map((r) => r.id));
    expect(ids.size).toBe(4);
  });
});
