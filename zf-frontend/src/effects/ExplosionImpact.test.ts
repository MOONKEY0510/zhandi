import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPLOSION_IMPACT_CONFIG,
  ExplosionImpactSystem,
  type ExplosionImpactConfig,
} from './ExplosionImpact';

const ORIGIN = { x: 0, y: 0, z: 0 };

function makeConfig(overrides: Partial<ExplosionImpactConfig> = {}): ExplosionImpactConfig {
  return { ...DEFAULT_EXPLOSION_IMPACT_CONFIG, ...overrides };
}

describe('ExplosionImpactSystem', () => {
  it('produces full intensity at point blank', () => {
    const system = new ExplosionImpactSystem(makeConfig());
    const result = system.trigger(ORIGIN, ORIGIN, 0);

    expect(result.impulse).toBeCloseTo(DEFAULT_EXPLOSION_IMPACT_CONFIG.maxImpulse);
    expect(result.shakeAmplitude).toBeCloseTo(DEFAULT_EXPLOSION_IMPACT_CONFIG.maxShakeAmplitude);
    expect(result.tinnitus).toBe(true);
    expect(result.dust).toBe(true);
    expect(result.degraded).toHaveLength(0);
  });

  it('produces nothing beyond the radius', () => {
    const system = new ExplosionImpactSystem(makeConfig({ radius: 10 }));
    const result = system.trigger(ORIGIN, { x: 30, y: 0, z: 0 }, 0);

    expect(result.impulse).toBe(0);
    expect(result.shakeAmplitude).toBe(0);
    expect(result.tinnitus).toBe(false);
    expect(result.dust).toBe(false);
    expect(result.shakeDurationMs).toBe(0);
  });

  it('falls off quadratically with distance', () => {
    const system = new ExplosionImpactSystem(makeConfig({ radius: 12, maxImpulse: 40 }));
    const result = system.trigger(ORIGIN, { x: 6, y: 0, z: 0 }, 0);

    // falloff = 1 - 6/12 = 0.5，intensity = 0.25
    expect(result.impulse).toBeCloseTo(10);
    expect(result.shakeAmplitude).toBeCloseTo(0.25);
  });

  it('only triggers tinnitus within its radius factor', () => {
    const system = new ExplosionImpactSystem(makeConfig({ radius: 12, tinnitusRadiusFactor: 0.5 }));
    const near = system.trigger(ORIGIN, { x: 5, y: 0, z: 0 }, 0);
    expect(near.tinnitus).toBe(true);

    const far = system.trigger(ORIGIN, { x: 8, y: 0, z: 0 }, 0);
    expect(far.tinnitus).toBe(false);
  });

  it('degrades channels independently when budgets run out', () => {
    const system = new ExplosionImpactSystem(makeConfig({ budgets: { shockwave: 60, camera_shake: 6, tinnitus: 4, dust: 8 } }));

    // 近距离一次消耗 maxImpulse(40) + shake(1) + tinnitus(1) + dust(1)
    system.trigger(ORIGIN, ORIGIN, 0);
    const second = system.trigger(ORIGIN, ORIGIN, 0);

    // shockwave 40+40 > 60 → 降级；camera_shake 1+1 <= 6 → 仍可用
    expect(second.degraded).toContain('shockwave');
    expect(second.impulse).toBe(0);
    expect(second.shakeAmplitude).toBeCloseTo(1);
    expect(second.degraded).not.toContain('camera_shake');
  });

  it('resets budgets every second', () => {
    const system = new ExplosionImpactSystem(makeConfig());
    system.trigger(ORIGIN, ORIGIN, 0);
    const degraded = system.trigger(ORIGIN, ORIGIN, 100);
    expect(degraded.degraded).toContain('shockwave');

    const recovered = system.trigger(ORIGIN, ORIGIN, 1000);
    expect(recovered.degraded).not.toContain('shockwave');
    expect(recovered.impulse).toBeCloseTo(DEFAULT_EXPLOSION_IMPACT_CONFIG.maxImpulse);
  });

  it('reports budget usage for debugging', () => {
    const system = new ExplosionImpactSystem(makeConfig());
    system.trigger(ORIGIN, ORIGIN, 0);
    const usage = system.getBudgetUsage();
    expect(usage.shockwave).toBeGreaterThan(0);
    expect(usage.tinnitus).toBeGreaterThan(0);
  });
});
