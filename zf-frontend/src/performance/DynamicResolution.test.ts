import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DYNAMIC_RESOLUTION_OPTIONS,
  DynamicResolution,
  type DynamicResolutionOptions,
} from './DynamicResolution';

function makeOptions(overrides: Partial<DynamicResolutionOptions> = {}): DynamicResolutionOptions {
  return { ...DEFAULT_DYNAMIC_RESOLUTION_OPTIONS, minIntervalMs: 0, ...overrides };
}

describe('DynamicResolution', () => {
  it('starts at the maximum scale', () => {
    const dr = new DynamicResolution(makeOptions());
    expect(dr.getScale()).toBe(1);
  });

  it('lowers scale while frame time stays above threshold', () => {
    const dr = new DynamicResolution(makeOptions());
    // 16.7 + 2 + 3 = 21.7
    let scale = dr.update(25, 0);
    expect(scale).toBeCloseTo(0.95);
    scale = dr.update(25, 1);
    expect(scale).toBeCloseTo(0.9);
  });

  it('never goes below the minimum scale', () => {
    const dr = new DynamicResolution(makeOptions({ minScale: 0.5 }));
    let scale = 1;
    for (let i = 0; i < 20; i++) {
      scale = dr.update(40, i);
    }
    expect(scale).toBeCloseTo(0.5);
  });

  it('stays still inside the dead zone', () => {
    const dr = new DynamicResolution(makeOptions());
    const scale = dr.update(16.7, 0);
    expect(scale).toBeCloseTo(1);
  });

  it('recovers scale after sustained good frame times', () => {
    const dr = new DynamicResolution(makeOptions());
    dr.update(30, 0);
    dr.update(30, 1);
    expect(dr.getScale()).toBeCloseTo(0.9);

    const scale = dr.update(10, 2);
    expect(scale).toBeCloseTo(0.95);
  });

  it('applies a cooldown between adjustments', () => {
    const dr = new DynamicResolution(makeOptions({ minIntervalMs: 100 }));
    dr.update(30, 0);
    expect(dr.getScale()).toBeCloseTo(0.95);

    // 冷却期内即使帧时间极低也不立即回升
    const scale = dr.update(8, 50);
    expect(scale).toBeCloseTo(0.95);

    const recovered = dr.update(8, 150);
    expect(recovered).toBeCloseTo(1);
  });

  it('resets to the maximum scale', () => {
    const dr = new DynamicResolution(makeOptions());
    dr.update(30, 0);
    expect(dr.getScale()).toBeLessThan(1);
    dr.reset();
    expect(dr.getScale()).toBe(1);
  });
});
