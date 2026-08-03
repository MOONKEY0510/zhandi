export interface GameSettings {
  volume: number;
  sensitivity: number;
  adsSensitivityMultiplier: number;
  fov: number;
  invertY: boolean;
  graphics: 'low' | 'medium' | 'high';
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  volume: 80,
  sensitivity: 50,
  adsSensitivityMultiplier: 0.8,
  fov: 75,
  invertY: false,
  graphics: 'medium',
};

const STORAGE_KEY = 'zhandi.game-settings.v1';

export function loadGameSettings(storage: Pick<Storage, 'getItem'> = localStorage): GameSettings {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) return { ...DEFAULT_GAME_SETTINGS };
    return sanitizeSettings(JSON.parse(value) as Partial<GameSettings>);
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function saveGameSettings(
  settings: GameSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): GameSettings {
  const sanitized = sanitizeSettings(settings);
  storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function sanitizeSettings(settings: Partial<GameSettings>): GameSettings {
  return {
    volume: clamp(settings.volume ?? DEFAULT_GAME_SETTINGS.volume, 0, 100),
    sensitivity: clamp(settings.sensitivity ?? DEFAULT_GAME_SETTINGS.sensitivity, 1, 100),
    adsSensitivityMultiplier: clamp(
      settings.adsSensitivityMultiplier ?? DEFAULT_GAME_SETTINGS.adsSensitivityMultiplier,
      0.1,
      1,
    ),
    fov: clamp(settings.fov ?? DEFAULT_GAME_SETTINGS.fov, 60, 100),
    invertY: settings.invertY ?? DEFAULT_GAME_SETTINGS.invertY,
    graphics: ['low', 'medium', 'high'].includes(settings.graphics ?? '')
      ? (settings.graphics as GameSettings['graphics'])
      : DEFAULT_GAME_SETTINGS.graphics,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
