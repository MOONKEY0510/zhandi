import { describe, expect, it } from 'vitest';
import { VISUAL_PROFILES, colorTemperatureToRGB, resolveVisualProfileId } from './VisualProfile';
import { WeatherType } from './WeatherSystem';

describe('VisualProfile', () => {
  it('defines the three art baselines with sane parameters', () => {
    expect(Object.keys(VISUAL_PROFILES)).toHaveLength(3);
    expect(VISUAL_PROFILES.day_clear.exposure).toBeGreaterThan(VISUAL_PROFILES.dusk.exposure);
    expect(VISUAL_PROFILES.dusk.directionalColorTemperatureK).toBeLessThan(
      VISUAL_PROFILES.day_clear.directionalColorTemperatureK,
    );
    expect(VISUAL_PROFILES.day_clear.shadowStrength).toBeGreaterThan(VISUAL_PROFILES.day_overcast.shadowStrength);
    expect(VISUAL_PROFILES.day_clear.fogDensity).toBeLessThan(VISUAL_PROFILES.day_overcast.fogDensity);
  });

  it('keeps weather compatibility consistent', () => {
    expect(VISUAL_PROFILES.day_clear.compatibleWeather).toContain(WeatherType.CLEAR);
    expect(VISUAL_PROFILES.day_clear.compatibleWeather).not.toContain(WeatherType.RAIN);
    expect(VISUAL_PROFILES.day_overcast.compatibleWeather).toContain(WeatherType.RAIN);
    expect(VISUAL_PROFILES.day_overcast.compatibleWeather).not.toContain(WeatherType.CLEAR);
    expect(VISUAL_PROFILES.dusk.compatibleWeather).toContain(WeatherType.CLEAR);
    expect(VISUAL_PROFILES.dusk.compatibleWeather).toContain(WeatherType.SANDSTORM);
  });

  it('resolves profile by weather and time of day', () => {
    expect(resolveVisualProfileId(WeatherType.CLEAR, 0.5)).toBe('day_clear');
    expect(resolveVisualProfileId(WeatherType.RAIN, 0.5)).toBe('day_overcast');
    expect(resolveVisualProfileId(WeatherType.SNOW, 0.5)).toBe('day_overcast');
    expect(resolveVisualProfileId(WeatherType.FOG, 0.5)).toBe('day_overcast');
    expect(resolveVisualProfileId(WeatherType.CLEAR, 0.75)).toBe('dusk');
    expect(resolveVisualProfileId(WeatherType.RAIN, 0.25)).toBe('dusk');
    expect(resolveVisualProfileId(WeatherType.FOG, 0.9)).toBe('day_overcast');
  });

  it('approximates color temperature', () => {
    const warm = colorTemperatureToRGB(3000);
    expect(warm.r).toBeGreaterThan(warm.g);
    expect(warm.g).toBeGreaterThan(warm.b);

    const cold = colorTemperatureToRGB(8000);
    expect(cold.b).toBeGreaterThan(cold.r);

    const clamped = colorTemperatureToRGB(100);
    expect(clamped.b).toBe(0);
    expect(clamped.r).toBeLessThanOrEqual(1);
    expect(clamped.r).toBeGreaterThanOrEqual(0);
  });
});
