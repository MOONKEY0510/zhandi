import { describe, expect, it } from 'vitest';
import { Weapon, WeaponType } from './WeaponSystem';

describe('Weapon', () => {
  it('enforces fire rate and consumes ammunition', () => {
    const weapon = new Weapon(WeaponType.ASSAULT_RIFLE);

    expect(weapon.fire(1_000)).toBe(true);
    expect(weapon.currentAmmo).toBe(29);
    expect(weapon.fire(1_001)).toBe(false);
    expect(weapon.fire(1_100)).toBe(true);
  });

  it('reloads only after the configured duration', () => {
    const weapon = new Weapon(WeaponType.BOLT_RIFLE);
    weapon.currentAmmo = 1;
    weapon.reserveAmmo = 8;

    expect(weapon.startReload(1_000)).toBe(true);
    expect(weapon.updateReload(3_999)).toBe(false);
    expect(weapon.updateReload(4_000)).toBe(true);
    expect(weapon.currentAmmo).toBe(5);
    expect(weapon.reserveAmmo).toBe(4);
  });
});
