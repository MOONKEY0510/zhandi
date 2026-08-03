import { describe, expect, it } from 'vitest';
import { TeamSupportSystem, type SupportPlayerState } from './TeamSupportSystem';

function player(): SupportPlayerState {
  return {
    id: 'player',
    health: 40,
    maxHealth: 100,
    reserveAmmo: 20,
    maxReserveAmmo: 120,
    downedAt: null,
    spottedUntil: 0,
  };
}

describe('TeamSupportSystem', () => {
  it('revives within the downed window and rejects late revives', () => {
    const support = new TeamSupportSystem(15_000, 50);
    const target = player();
    support.down(target, 1_000);

    expect(support.revive(target, 15_999)).toBe(true);
    expect(target.health).toBe(50);

    support.down(target, 20_000);
    expect(support.revive(target, 35_001)).toBe(false);
  });

  it('caps healing and ammunition resupply', () => {
    const support = new TeamSupportSystem();
    const target = player();

    expect(support.heal(target, 100)).toBe(60);
    expect(support.resupply(target, 200)).toBe(100);
  });

  it('tracks deterministic spotting duration', () => {
    const support = new TeamSupportSystem();
    const target = player();
    support.spot(target, 1_000, 5_000);

    expect(support.isSpotted(target, 5_999)).toBe(true);
    expect(support.isSpotted(target, 6_000)).toBe(false);
  });
});
