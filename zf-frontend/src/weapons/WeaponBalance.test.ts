import { describe, expect, it } from 'vitest';
import { calculateDamage } from './Bullet';
import { Weapon, WEAPON_CONFIGS, WeaponType } from './WeaponSystem';

function torsoDamage(type: WeaponType, distance: number): number {
  const config = WEAPON_CONFIGS[type];
  return calculateDamage(
    {
      baseDamage: config.damage,
      minDamage: config.minDamage,
      falloffStart: config.falloffStart,
      falloffEnd: config.falloffEnd,
      headshotMultiplier: config.headshotMultiplier,
      limbMultiplier: 0.7,
      range: config.range,
    },
    'torso',
    distance,
  );
}

function shotsToKill(damage: number): number {
  return Math.ceil(100 / damage);
}

describe('vertical-slice weapon balance', () => {
  it.each([
    [WeaponType.ASSAULT_RIFLE, 10, 25, 4],
    [WeaponType.ASSAULT_RIFLE, 30, 24.36, 5],
    [WeaponType.ASSAULT_RIFLE, 60, 20.55, 5],
    [WeaponType.BOLT_RIFLE, 10, 80, 2],
    [WeaponType.BOLT_RIFLE, 30, 80, 2],
    [WeaponType.BOLT_RIFLE, 60, 80, 2],
  ])('%s at %im has expected torso damage and shots-to-kill', (type, distance, damage, shots) => {
    const actual = torsoDamage(type, distance);
    expect(actual).toBeCloseTo(damage, 1);
    expect(shotsToKill(actual)).toBe(shots);
  });

  it('enforces Kar98k bolt action timing', () => {
    const weapon = new Weapon(WeaponType.BOLT_RIFLE);

    expect(weapon.fire(1_000)).toBe(true);
    expect(weapon.fire(1_799)).toBe(false);
    expect(weapon.fire(1_833)).toBe(false);
    expect(weapon.fire(1_834)).toBe(true);
  });

  it('differentiates stance and movement spread', () => {
    const rifle = new Weapon(WeaponType.ASSAULT_RIFLE);

    expect(rifle.getSpreadMultiplier(true, false)).toBeGreaterThan(1);
    expect(rifle.getSpreadMultiplier(false, true)).toBeLessThan(1);
  });

  it.each([30, 60, 120])('keeps STG44 cyclic rate stable at %i FPS', (fps) => {
    const weapon = new Weapon(WeaponType.ASSAULT_RIFLE);
    const frameMs = 1_000 / fps;
    let shots = 0;

    for (let time = 0; time <= 1_000 + frameMs / 2; time += frameMs) {
      if (weapon.fire(time)) shots++;
    }

    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(13);
  });
});
