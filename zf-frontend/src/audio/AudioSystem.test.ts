import { describe, expect, it } from 'vitest';
import { AudioSystem, SOUND_CONFIGS, SoundType } from './AudioSystem';

describe('AudioSystem（阶段 10：音量分组）', () => {
  it('每个音效都映射到合法分组', () => {
    for (const type of Object.values(SoundType)) {
      const cfg = SOUND_CONFIGS[type];
      expect(['sfx', 'music', 'voice']).toContain(cfg.category);
    }
  });

  it('环境音乐归 music 组，UI 提示音归 voice 组，战斗音效归 sfx 组', () => {
    expect(SOUND_CONFIGS[SoundType.AMBIENT].category).toBe('music');
    expect(SOUND_CONFIGS[SoundType.UI_CLICK].category).toBe('voice');
    expect(SOUND_CONFIGS[SoundType.UI_HOVER].category).toBe('voice');
    expect(SOUND_CONFIGS[SoundType.GUNSHOT].category).toBe('sfx');
    expect(SOUND_CONFIGS[SoundType.EXPLOSION].category).toBe('sfx');
  });

  it('setGroupVolume 独立设置各组音量并钳制 0-1', () => {
    const audio = new AudioSystem();
    audio.setGroupVolume('sfx', 0.5);
    audio.setGroupVolume('music', 2);
    audio.setGroupVolume('voice', -1);
    expect(audio.getGroupVolume('sfx')).toBe(0.5);
    expect(audio.getGroupVolume('music')).toBe(1);
    expect(audio.getGroupVolume('voice')).toBe(0);
  });

  it('分组音量与主音量互不影响', () => {
    const audio = new AudioSystem();
    audio.setVolume(0.8);
    audio.setGroupVolume('sfx', 0.5);
    expect(audio.masterVolume).toBe(0.8);
    expect(audio.sfxVolume).toBe(0.5);
  });
});
