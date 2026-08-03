import { describe, expect, it } from 'vitest';
import { simulateWeaponRange } from './RangeSimulation';
import { WeaponType } from './WeaponSystem';

describe('range simulation', () => {
  it('produces repeatable STG44 range samples', () => {
    const samples = simulateWeaponRange(WeaponType.ASSAULT_RIFLE);

    expect(samples.map((sample) => sample.distance)).toEqual([10, 30, 60]);
    expect(samples.map((sample) => sample.shotsToKill)).toEqual([4, 5, 5]);
    expect(samples[2].flightTimeSeconds).toBeCloseTo(60 / 620, 5);
  });

  it('reports slower cadence but stronger damage for Kar98k', () => {
    const samples = simulateWeaponRange(WeaponType.BOLT_RIFLE);

    expect(samples.every((sample) => sample.shotsToKill === 2)).toBe(true);
    expect(samples[0].theoreticalTtkSeconds).toBeCloseTo(1 / 1.2, 5);
  });
});
