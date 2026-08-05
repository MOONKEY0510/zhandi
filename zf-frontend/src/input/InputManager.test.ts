import { describe, expect, it, vi } from 'vitest';
import { InputManager } from './InputManager';
import { DEFAULT_KEY_BINDINGS } from './KeyBindings';

function keydown(code: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, bubbles: true });
}
function keyup(code: string): KeyboardEvent {
  return new KeyboardEvent('keyup', { code, bubbles: true });
}

describe('InputManager lifecycle', () => {
  it('does not register duplicate listeners when initialized twice', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const manager = new InputManager();

    manager.init();
    const listenerCount = addSpy.mock.calls.length;
    manager.init();

    expect(addSpy.mock.calls.length).toBe(listenerCount);
    manager.dispose();
  });

  it('removes its listeners only once when disposed repeatedly', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const manager = new InputManager();
    manager.init();

    manager.dispose();
    const listenerCount = removeSpy.mock.calls.length;
    manager.dispose();

    expect(removeSpy.mock.calls.length).toBe(listenerCount);
  });
});

describe('InputManager 键位重绑定（阶段 10）', () => {
  it('默认键位：W 触发 forward', () => {
    const manager = new InputManager();
    manager.init();
    document.dispatchEvent(keydown('KeyW'));
    expect(manager.state.forward).toBe(true);
    document.dispatchEvent(keyup('KeyW'));
    expect(manager.state.forward).toBe(false);
    manager.dispose();
  });

  it('applyBindings 后新键生效、旧键失效', () => {
    const manager = new InputManager();
    manager.init();
    manager.applyBindings({ move_forward: 'ArrowUp' });

    document.dispatchEvent(keydown('ArrowUp'));
    expect(manager.state.forward).toBe(true);
    document.dispatchEvent(keyup('ArrowUp'));

    document.dispatchEvent(keydown('KeyW'));
    expect(manager.state.forward).toBe(false);
    manager.dispose();
  });

  it('重绑定后换弹动作走新键', () => {
    const manager = new InputManager();
    manager.init();
    const reload = vi.fn();
    manager.onReloadPressed(reload);
    manager.applyBindings({ reload: 'KeyX' });

    document.dispatchEvent(keydown('KeyX'));
    expect(reload).toHaveBeenCalledTimes(1);
    document.dispatchEvent(keyup('KeyX'));
    manager.dispose();
  });

  it('getBindings 返回当前绑定的副本', () => {
    const manager = new InputManager();
    manager.applyBindings({ jump: 'KeyJ' });
    const bindings = manager.getBindings();
    expect(bindings.jump).toBe('KeyJ');
    expect(bindings.move_forward).toBe(DEFAULT_KEY_BINDINGS.move_forward);
  });

  it('sprint 兼容右侧 Shift（保持默认行为）', () => {
    const manager = new InputManager();
    manager.init();
    document.dispatchEvent(keydown('ShiftRight'));
    expect(manager.state.sprint).toBe(true);
    document.dispatchEvent(keyup('ShiftRight'));
    manager.dispose();
  });
});
