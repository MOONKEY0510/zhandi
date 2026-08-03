import { describe, expect, it, vi } from 'vitest';
import { GameState, GameStateMachine } from './GameStateMachine';

describe('GameStateMachine', () => {
  it('supports the normal menu to play lifecycle', () => {
    const machine = new GameStateMachine();

    machine.transition(GameState.MENU);
    machine.transition(GameState.LOADING);
    machine.transition(GameState.PLAYING);
    machine.transition(GameState.PAUSED);
    machine.transition(GameState.PLAYING);
    machine.transition(GameState.ROUND_END);

    expect(machine.getState()).toBe(GameState.ROUND_END);
  });

  it('rejects invalid transitions', () => {
    const machine = new GameStateMachine();

    expect(() => machine.transition(GameState.PLAYING)).toThrow(
      'Invalid game state transition: boot -> playing',
    );
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const machine = new GameStateMachine();
    const listener = vi.fn();
    const unsubscribe = machine.subscribe(listener);

    machine.transition(GameState.MENU);
    unsubscribe();
    machine.transition(GameState.LOADING);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(GameState.MENU, GameState.BOOT);
  });
});
