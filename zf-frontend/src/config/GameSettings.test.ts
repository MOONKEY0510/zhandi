import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS, loadGameSettings, sanitizeSettings, saveGameSettings, migrateV1Settings } from './GameSettings';

describe('GameSettings', () => {
  it('sanitizes persisted values into supported ranges', () => {
    expect(
      sanitizeSettings({
        volumeMaster: 200,
        volumeSfx: -5,
        volumeMusic: 150,
        volumeVoice: 50,
        sensitivity: 0,
        adsSensitivityMultiplier: 2,
        fov: 120,
        invertY: true,
        graphics: 'high',
        resolutionScale: 3,
        reduceScreenShake: true,
        colorBlindMode: 'deuteranopia',
        crosshairStyle: 'dot',
        crosshairColor: '#00ff00',
        crosshairScale: 2.5,
        showSubtitles: false,
      }),
    ).toEqual({
      volumeMaster: 100,
      volumeSfx: 0,
      volumeMusic: 100,
      volumeVoice: 50,
      sensitivity: 1,
      adsSensitivityMultiplier: 1,
      fov: 100,
      invertY: true,
      graphics: 'high',
      resolutionScale: 1.5,
      reduceScreenShake: true,
      colorBlindMode: 'deuteranopia',
      crosshairStyle: 'dot',
      crosshairColor: '#00ff00',
      crosshairScale: 2,
      showSubtitles: false,
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
    expect(setItem).toHaveBeenCalledWith('zhandi.game-settings.v2', JSON.stringify(saved));
  });

  it('阶段 10：v1 volume 字段迁移到 volumeMaster，其余分组取默认', () => {
    const migrated = migrateV1Settings({ volume: 65, sensitivity: 40 });
    expect(migrated.volumeMaster).toBe(65);
    expect(migrated.volume).toBeUndefined();
    expect(migrated.sensitivity).toBe(40);
  });

  it('阶段 10：sanitize 对 v1 存档自动迁移（旧 volume → volumeMaster）', () => {
    const s = sanitizeSettings({ volume: 70 } as Partial<typeof DEFAULT_GAME_SETTINGS>);
    expect(s.volumeMaster).toBe(70);
    expect(s.volumeSfx).toBe(DEFAULT_GAME_SETTINGS.volumeSfx);
    expect(s.volumeMusic).toBe(DEFAULT_GAME_SETTINGS.volumeMusic);
  });

  it('阶段 10：分辨率比例与震动开关默认值 + 边界钳制', () => {
    expect(DEFAULT_GAME_SETTINGS.resolutionScale).toBe(1);
    expect(DEFAULT_GAME_SETTINGS.reduceScreenShake).toBe(false);
    expect(sanitizeSettings({ resolutionScale: 0.2 }).resolutionScale).toBe(0.5);
    expect(sanitizeSettings({ resolutionScale: 2 }).resolutionScale).toBe(1.5);
  });

  it('阶段 10：可访问性字段默认值与非法值回退', () => {
    expect(DEFAULT_GAME_SETTINGS.colorBlindMode).toBe('none');
    expect(DEFAULT_GAME_SETTINGS.crosshairStyle).toBe('default');
    expect(DEFAULT_GAME_SETTINGS.crosshairColor).toBe('#ffffff');
    expect(DEFAULT_GAME_SETTINGS.crosshairScale).toBe(1);
    // 非法枚举/颜色/范围 → 默认
    expect(sanitizeSettings({ colorBlindMode: 'sepia' as never }).colorBlindMode).toBe('none');
    expect(sanitizeSettings({ crosshairStyle: 'fancy' as never }).crosshairStyle).toBe('default');
    expect(sanitizeSettings({ crosshairColor: 'red' }).crosshairColor).toBe('#ffffff');
    expect(sanitizeSettings({ crosshairScale: 9 }).crosshairScale).toBe(2);
    expect(sanitizeSettings({ crosshairScale: 0.1 }).crosshairScale).toBe(0.5);
  });

  it('阶段 10：字幕开关默认开启，缺省补默认，显式 false 保留', () => {
    expect(DEFAULT_GAME_SETTINGS.showSubtitles).toBe(true);
    // 旧存档缺字段 → 默认开启
    expect(sanitizeSettings({ volumeMaster: 50 }).showSubtitles).toBe(true);
    expect(loadGameSettings({ getItem: () => JSON.stringify({ volumeMaster: 50 }) }).showSubtitles).toBe(true);
    // 显式 false 保留（用户关闭字幕）
    expect(sanitizeSettings({ showSubtitles: false }).showSubtitles).toBe(false);
  });
});
