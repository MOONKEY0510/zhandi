import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS, loadGameSettings, sanitizeSettings, saveGameSettings } from './GameSettings';

describe('GameSettings', () => {
  it('sanitizes persisted values into supported ranges', () => {
    expect(
      sanitizeSettings({
        volume: 200,
        sensitivity: 0,
        adsSensitivityMultiplier: 2,
        fov: 120,
        invertY: true,
        graphics: 'high',
      }),
    ).toEqual({
      volume: 100,
      sensitivity: 1,
      adsSensitivityMultiplier: 1,
      fov: 100,
      invertY: true,
      graphics: 'high',
    });
  });

  it('falls back to defaults for malformed storage', () => {
    expect(loadGameSettings({ getItem: () => '{bad json' })).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('persists a sanitized versioned settings payload', () => {
    const setItem = vi.fn();
    const saved = saveGameSettings(
      { ...DEFAULT_GAME_SETTINGS, sensitivity: 75 },
      { setItem },
    );

    expect(saved.sensitivity).toBe(75);
    expect(setItem).toHaveBeenCalledWith('zhandi.game-settings.v1', JSON.stringify(saved));
  });
});
