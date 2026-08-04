import { describe, expect, it } from 'vitest';
import { GUNSHOT_LAYERS, computeLayerGain, resolveAudibleLayers } from './GunshotLayers';

describe('GunshotLayers', () => {
  it('defines all four layers with sane parameters', () => {
    expect(Object.keys(GUNSHOT_LAYERS)).toHaveLength(4);
    expect(GUNSHOT_LAYERS.muzzle.baseVolume).toBeGreaterThan(GUNSHOT_LAYERS.casing.baseVolume);
    expect(GUNSHOT_LAYERS.tail.maxDistance).toBeGreaterThan(GUNSHOT_LAYERS.muzzle.maxDistance);
  });

  it('hears all layers at close range', () => {
    const layers = resolveAudibleLayers(0);
    expect(layers).toHaveLength(4);
    for (const layer of layers) {
      expect(computeLayerGain(layer, 0)).toBeGreaterThan(0);
    }
  });

  it('drops mechanical and casing layers at medium range', () => {
    const layers = resolveAudibleLayers(25);
    const names = layers.map((layer) => layer.name);
    expect(names).toContain('muzzle');
    expect(names).toContain('tail');
    expect(names).not.toContain('mechanism');
    expect(names).not.toContain('casing');
  });

  it('keeps only the tail at long range', () => {
    const layers = resolveAudibleLayers(100);
    expect(layers.map((layer) => layer.name)).toEqual(['tail']);
  });

  it('hears nothing beyond the tail distance', () => {
    expect(resolveAudibleLayers(300)).toHaveLength(0);
    expect(computeLayerGain(GUNSHOT_LAYERS.tail, 300)).toBe(0);
  });

  it('applies quadratic distance falloff', () => {
    // 10m / 60m → (1 - 1/6)^2 = 0.6944，乘以基准音量 0.9
    const gain = computeLayerGain(GUNSHOT_LAYERS.muzzle, 10);
    expect(gain).toBeCloseTo(0.9 * (1 - 10 / 60) * (1 - 10 / 60), 5);
  });
});
