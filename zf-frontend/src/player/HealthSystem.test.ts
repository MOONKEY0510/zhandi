import { describe, expect, it, vi } from 'vitest';
import { HealthState, HealthSystem } from './HealthSystem';

describe('HealthSystem', () => {
  it('transitions to death and respawns with protection', () => {
    vi.spyOn(performance, 'now').mockReturnValue(20_000);
    const health = new HealthSystem();

    expect(health.takeDamage(100, 1_000)).toBe(true);
    expect(health.getHealthState()).toBe(HealthState.DEAD);

    health.respawn();
    expect(health.currentHealth).toBe(health.maxHealth);
    expect(health.isSpawnProtected).toBe(true);
    expect(health.getSpawnProtectionRemaining(20_000)).toBe(3);
  });

  it('blocks damage while spawn protection is active', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const health = new HealthSystem();
    health.respawn();

    expect(health.takeDamage(50, 2_000)).toBe(false);
    expect(health.currentHealth).toBe(100);
  });
});
