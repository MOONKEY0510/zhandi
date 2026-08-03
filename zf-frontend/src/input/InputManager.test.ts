import { describe, expect, it, vi } from 'vitest';
import { InputManager } from './InputManager';

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
