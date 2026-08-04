import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEATHER_MATERIAL_OVERRIDES, WeatherMaterialLink } from './WeatherMaterialLink';
import { WeatherType } from './WeatherSystem';

describe('WeatherMaterialLink', () => {
  it('provides per-weather overrides for all weather types', () => {
    for (const type of Object.values(WeatherType)) {
      const overrides = WEATHER_MATERIAL_OVERRIDES[type];
      expect(overrides.roughnessMultiplier).toBeGreaterThan(0);
      expect(overrides.brightnessScale).toBeGreaterThan(0);
      expect(overrides.tintStrength).toBeGreaterThanOrEqual(0);
    }
  });

  it('applies rain wetness to standard materials', () => {
    const link = new WeatherMaterialLink();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0xaaaaaa });
    const originalColor = material.color.getHex();

    link.apply(WeatherType.RAIN, [material]);

    expect(material.roughness).toBeCloseTo(0.9 * WEATHER_MATERIAL_OVERRIDES[WeatherType.RAIN].roughnessMultiplier);
    expect(material.color.getHex()).not.toBe(originalColor);
    expect(link.currentWeather).toBe(WeatherType.RAIN);
  });

  it('tints materials without roughness but leaves roughness untouched', () => {
    const link = new WeatherMaterialLink();
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff });

    link.apply(WeatherType.SNOW, [basic]);

    expect(basic.color.getHex()).not.toBe(0xffffff);
  });

  it('restores original material state', () => {
    const link = new WeatherMaterialLink();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x445566 });
    const expectedRoughness = material.roughness;
    const expectedColor = material.color.getHex();

    link.apply(WeatherType.RAIN, [material]);
    expect(material.roughness).not.toBe(expectedRoughness);
    expect(material.color.getHex()).not.toBe(expectedColor);

    link.restore();

    expect(material.roughness).toBe(expectedRoughness);
    expect(material.color.getHex()).toBe(expectedColor);
    expect(link.currentWeather).toBeNull();
  });

  it('snapshots each material only once', () => {
    const link = new WeatherMaterialLink();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.5 });

    link.apply(WeatherType.RAIN, [material]);
    link.apply(WeatherType.SNOW, [material]);

    expect(link.getLinkedCount()).toBe(1);
  });

  it('supports clearing state and releasing references', () => {
    const link = new WeatherMaterialLink();
    const material = new THREE.MeshStandardMaterial();

    link.apply(WeatherType.RAIN, [material]);
    link.clear();

    expect(link.getLinkedCount()).toBe(0);
    expect(link.currentWeather).toBeNull();
  });
});
