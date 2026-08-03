import { describe, expect, it } from 'vitest';
import { SquadSystem } from './SquadSystem';

describe('SquadSystem', () => {
  it('limits squads to four members and assigns a leader', () => {
    const squad = new SquadSystem();
    for (let index = 0; index < 4; index++) {
      expect(squad.addMember({ id: String(index), name: `P${index}`, alive: true, inCombatUntil: 0 })).toBe(true);
    }

    expect(squad.leaderId).toBe('0');
    expect(squad.addMember({ id: '4', name: 'P4', alive: true, inCombatUntil: 0 })).toBe(false);
  });

  it('only allows leaders to issue commands and awards completion points', () => {
    const squad = new SquadSystem();
    squad.addMember({ id: 'leader', name: 'Leader', alive: true, inCombatUntil: 0 });
    squad.addMember({ id: 'member', name: 'Member', alive: true, inCombatUntil: 0 });

    expect(squad.issueOrder('member', { type: 'attack', targetId: 'B', issuedAt: 1_000 })).toBe(false);
    expect(squad.issueOrder('leader', { type: 'attack', targetId: 'B', issuedAt: 1_000 })).toBe(true);
    expect(squad.completeOrder('B')).toBe(true);
    expect(squad.commandPoints).toBe(100);
  });

  it('blocks spawning on dead or recently engaged squadmates', () => {
    const squad = new SquadSystem();
    squad.addMember({ id: 'safe', name: 'Safe', alive: true, inCombatUntil: 5_000 });

    expect(squad.canSpawnOn('safe', 4_999)).toBe(false);
    expect(squad.canSpawnOn('safe', 5_000)).toBe(true);
  });
});
