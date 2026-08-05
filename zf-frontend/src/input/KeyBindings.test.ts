import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS,
  buildCodeToActions,
  findKeyConflicts,
  loadKeyBindings,
  sanitizeKeyBindings,
  saveKeyBindings,
} from './KeyBindings';

describe('KeyBindings（阶段 10：键位重绑定 + 持久化）', () => {
  it('缺省动作补默认键，非法值回退默认', () => {
    const s = sanitizeKeyBindings({ move_forward: 'ArrowUp', jump: '' } as Partial<typeof DEFAULT_KEY_BINDINGS>);
    expect(s.move_forward).toBe('ArrowUp');
    expect(s.jump).toBe(DEFAULT_KEY_BINDINGS.jump);
  });

  it('冲突检测：同一键绑多个动作时返回冲突映射', () => {
    const bindings = sanitizeKeyBindings({ move_forward: 'KeyW', jump: 'KeyW' } as Partial<typeof DEFAULT_KEY_BINDINGS>);
    const conflicts = findKeyConflicts(bindings);
    expect(conflicts.get('KeyW')).toEqual(['move_forward', 'jump']);
    expect(conflicts.size).toBe(1);
  });

  it('无冲突时返回空映射', () => {
    expect(findKeyConflicts({ ...DEFAULT_KEY_BINDINGS }).size).toBe(0);
  });

  it('反向映射：code → 动作列表', () => {
    const map = buildCodeToActions({ ...DEFAULT_KEY_BINDINGS, move_forward: 'ArrowUp' });
    expect(map.get('ArrowUp')).toContain('move_forward');
    expect(map.get('KeyW')).toBeUndefined();
  });

  it('持久化往返：保存后再加载保持一致', () => {
    const store = new Map<string, string>();
    const custom = sanitizeKeyBindings({ move_forward: 'KeyP' } as Partial<typeof DEFAULT_KEY_BINDINGS>);
    saveKeyBindings(custom, { setItem: (k, v) => store.set(k, v) });
    const loaded = loadKeyBindings({ getItem: (k) => store.get(k) ?? null });
    expect(loaded.move_forward).toBe('KeyP');
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(DEFAULT_KEY_BINDINGS).sort()); // 键集完整且与 GameSettings 隔离
  });

  it('坏存档回退默认', () => {
    expect(loadKeyBindings({ getItem: () => '{bad json' })).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('save 返回 sanitize 后结果并写入 v1 key', () => {
    const setItem = vi.fn();
    const saved = saveKeyBindings({ ...DEFAULT_KEY_BINDINGS, reload: 'KeyX' }, { setItem });
    expect(saved.reload).toBe('KeyX');
    expect(setItem).toHaveBeenCalledWith('zhandi.key-bindings.v1', JSON.stringify(saved));
  });
});
