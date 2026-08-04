import { describe, expect, it } from 'vitest';
import { decideTacticalAction, type AITacticalContext } from './SquadTactics';

const base: AITacticalContext = {
  distanceToLeader: 5,
  visibleEnemies: 0,
  healthRatio: 1,
  ammoRatio: 1,
  downedAllyDistance: null,
  objectiveDistance: 30,
  role: 'assault',
};

describe('AI squad tactics', () => {
  it('prioritizes medic revive over combat movement', () => {
    expect(decideTacticalAction({ ...base, role: 'medic', downedAllyDistance: 10 }).action).toBe('revive');
  });

  it('retreats at low health and suppresses as support', () => {
    expect(decideTacticalAction({ ...base, healthRatio: 0.2 }).action).toBe('retreat');
    expect(decideTacticalAction({ ...base, role: 'support', visibleEnemies: 3 }).action).toBe('suppress');
  });

  it('provides an explainable reason for every decision', () => {
    expect(decideTacticalAction(base).reason).toContain('目标推进');
  });
});
