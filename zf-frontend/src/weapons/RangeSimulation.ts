import { calculateDamage } from './Bullet';
import { Projectile } from './Projectile';
import { WEAPON_CONFIGS, type WeaponConfig, type WeaponType } from './WeaponSystem';

export interface RangeSample {
  distance: number;
  torsoDamage: number;
  headDamage: number;
  shotsToKill: number;
  theoreticalTtkSeconds: number;
  flightTimeSeconds: number;
}

export function simulateWeaponRange(
  type: WeaponType,
  distances: readonly number[] = [10, 30, 60],
): RangeSample[] {
  const config = WEAPON_CONFIGS[type];
  return distances.map((distance) => createSample(config, distance));
}

function createSample(config: WeaponConfig, distance: number): RangeSample {
  const damageInfo = {
    baseDamage: config.damage,
    minDamage: config.minDamage,
    falloffStart: config.falloffStart,
    falloffEnd: config.falloffEnd,
    headshotMultiplier: config.headshotMultiplier,
    limbMultiplier: 0.7,
    range: config.range,
  };
  const torsoDamage = calculateDamage(damageInfo, 'torso', distance);
  const headDamage = calculateDamage(damageInfo, 'head', distance);
  const shotsToKill = Math.ceil(100 / torsoDamage);

  return {
    distance,
    torsoDamage,
    headDamage,
    shotsToKill,
    theoreticalTtkSeconds: (shotsToKill - 1) / config.fireRate,
    flightTimeSeconds: Projectile.flightTime(distance, config.bulletSpeed),
  };
}
