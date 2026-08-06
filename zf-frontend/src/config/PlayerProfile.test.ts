import { describe, expect, it, vi } from 'vitest';
import {
  loadPlayerProfile,
  savePlayerProfile,
  isFirstRun,
} from './PlayerProfile';

describe('PlayerProfile（阶段 10 P0：首次设置流程）', () => {
  it('无档案时 load 返回 null，isFirstRun 为 true', () => {
    expect(loadPlayerProfile({ getItem: () => null })).toBeNull();
    expect(isFirstRun(null)).toBe(true);
  });

  it('save 后 load 往返一致，isFirstRun 为 false', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    savePlayerProfile({ nickname: '老兵', completedSetup: true, completedAt: 123 }, storage);
    const loaded = loadPlayerProfile(storage);
    expect(loaded?.nickname).toBe('老兵');
    expect(loaded?.completedSetup).toBe(true);
    expect(loaded?.completedAt).toBe(123);
    expect(isFirstRun(loaded)).toBe(false);
  });

  it('损坏 JSON / 缺字段回退 null（视为首次运行）', () => {
    expect(loadPlayerProfile({ getItem: () => '{bad' })).toBeNull();
    expect(loadPlayerProfile({ getItem: () => JSON.stringify({ nickname: 'x' }) })).toBeNull();
  });

  it('昵称清洗：去空白、超长截断、空昵称回退「士兵」', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    savePlayerProfile({ nickname: '  ', completedSetup: true, completedAt: 1 }, storage);
    expect(loadPlayerProfile(storage)?.nickname).toBe('士兵');
    savePlayerProfile({ nickname: '超长昵称超长昵称超长昵称超长昵称超长昵称', completedSetup: true, completedAt: 1 }, storage);
    expect(loadPlayerProfile(storage)?.nickname.length).toBeLessThanOrEqual(24);
  });

  it('save 使用 zhandi.player-profile.v1 键', () => {
    const setItem = vi.fn();
    savePlayerProfile({ nickname: 'a', completedSetup: true, completedAt: 1 }, { setItem });
    expect(setItem).toHaveBeenCalledWith(
      'zhandi.player-profile.v1',
      JSON.stringify({ nickname: 'a', completedSetup: true, completedAt: 1 }),
    );
  });
});
