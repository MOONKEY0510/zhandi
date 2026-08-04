import { describe, expect, it, vi } from 'vitest';
import { CharacterAnimationState, CharacterAnimationStateMachine } from './CharacterAnimationStateMachine';

const base = {
  moving: false,
  sprinting: false,
  crouching: false,
  grounded: true,
  justLanded: false,
  reloading: false,
  firing: false,
  hit: false,
  downed: false,
  reviving: false,
};

describe('CharacterAnimationStateMachine', () => {
  it('resolves locomotion and action priorities', () => {
    const machine = new CharacterAnimationStateMachine();

    expect(machine.update({ ...base, moving: true })).toBe(CharacterAnimationState.MOVE);
    expect(machine.update({ ...base, moving: true, sprinting: true })).toBe(CharacterAnimationState.SPRINT);
    expect(machine.update({ ...base, moving: true, firing: true })).toBe(CharacterAnimationState.FIRE);
    expect(machine.update({ ...base, reloading: true, firing: true })).toBe(CharacterAnimationState.RELOAD);
    expect(machine.update({ ...base, downed: true, reloading: true })).toBe(CharacterAnimationState.DOWNED);
  });

  it('emits animation markers independently from gameplay results', () => {
    const machine = new CharacterAnimationStateMachine();
    const onMarker = vi.fn();
    machine.onMarker = onMarker;

    machine.emitMarker('magazine_out');
    machine.emitMarker('magazine_in');
    machine.emitMarker('bolt');

    expect(onMarker.mock.calls.map(([marker]) => marker)).toEqual(['magazine_out', 'magazine_in', 'bolt']);
  });
});
