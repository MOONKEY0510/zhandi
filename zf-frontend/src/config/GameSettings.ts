export interface GameSettings {
  /** 主音量 0-100（v2 起替代旧 volume 字段，旧存档自动迁移） */
  volumeMaster: number;
  /** 战斗音效音量 0-100（枪声/脚步/爆炸/命中/换弹/耳鸣/死亡） */
  volumeSfx: number;
  /** 音乐音量 0-100（环境氛围） */
  volumeMusic: number;
  /** 语音/UI 音量 0-100（界面提示音；未来语音播报复用此组） */
  volumeVoice: number;
  sensitivity: number;
  adsSensitivityMultiplier: number;
  fov: number;
  invertY: boolean;
  graphics: 'low' | 'medium' | 'high';
  /** 渲染分辨率比例 0.5-1.5（乘到像素比；与动态分辨率协同，低画质固定 1） */
  resolutionScale: number;
  /** 可访问性：减少屏幕震动（震动幅度乘 0.3） */
  reduceScreenShake: boolean;
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  volumeMaster: 80,
  volumeSfx: 80,
  volumeMusic: 60,
  volumeVoice: 80,
  sensitivity: 50,
  adsSensitivityMultiplier: 0.8,
  fov: 75,
  invertY: false,
  graphics: 'medium',
  resolutionScale: 1,
  reduceScreenShake: false,
};

const STORAGE_KEY = 'zhandi.game-settings.v2';

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

/** 阶段 10：v1 → v2 迁移。旧 volume 字段并入 volumeMaster（其余分组取默认），
 * 旧存档（zhandi.game-settings.v1）读不到时回退默认，不阻塞升级。 */
export function migrateV1Settings(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...raw };
  if (migrated.volume !== undefined && migrated.volumeMaster === undefined) {
    migrated.volumeMaster = migrated.volume;
  }
  delete migrated.volume;
  return migrated;
}

export function sanitizeSettings(settings: Partial<GameSettings>): GameSettings {
  const migrated = migrateV1Settings(settings as Record<string, unknown>);
  const s = migrated as Partial<GameSettings>;
  return {
    volumeMaster: clamp(s.volumeMaster ?? DEFAULT_GAME_SETTINGS.volumeMaster, 0, 100),
    volumeSfx: clamp(s.volumeSfx ?? DEFAULT_GAME_SETTINGS.volumeSfx, 0, 100),
    volumeMusic: clamp(s.volumeMusic ?? DEFAULT_GAME_SETTINGS.volumeMusic, 0, 100),
    volumeVoice: clamp(s.volumeVoice ?? DEFAULT_GAME_SETTINGS.volumeVoice, 0, 100),
    sensitivity: clamp(s.sensitivity ?? DEFAULT_GAME_SETTINGS.sensitivity, 1, 100),
    adsSensitivityMultiplier: clamp(
      s.adsSensitivityMultiplier ?? DEFAULT_GAME_SETTINGS.adsSensitivityMultiplier,
      0.1,
      1,
    ),
    fov: clamp(s.fov ?? DEFAULT_GAME_SETTINGS.fov, 60, 100),
    invertY: s.invertY ?? DEFAULT_GAME_SETTINGS.invertY,
    graphics: ['low', 'medium', 'high'].includes(s.graphics ?? '')
      ? (s.graphics as GameSettings['graphics'])
      : DEFAULT_GAME_SETTINGS.graphics,
    resolutionScale: clamp(s.resolutionScale ?? DEFAULT_GAME_SETTINGS.resolutionScale, 0.5, 1.5),
    reduceScreenShake: s.reduceScreenShake ?? DEFAULT_GAME_SETTINGS.reduceScreenShake,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
