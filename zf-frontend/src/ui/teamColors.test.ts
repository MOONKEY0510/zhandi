import { describe, it, expect } from 'vitest';
import {
  TEAM_COLOR_SCHEMES,
  getTeamColors,
  isColorBlindMode,
  hexToRgba,
} from './teamColors';

describe('teamColors（阶段 10 P0：色觉模式阵营配色）', () => {
  it('正常模式：德军红 / 苏军蓝', () => {
    expect(getTeamColors('none').axis).toBe('#ff4444');
    expect(getTeamColors('none').allies).toBe('#4488ff');
  });

  it('红绿色弱模式：德军红改橙（提高与蓝的对比），苏军保持蓝系', () => {
    const d = getTeamColors('deuteranopia');
    expect(d.axis).toBe('#ff8800');
    expect(d.axis).not.toBe(TEAM_COLOR_SCHEMES.none.axis);
    expect(d.allies.startsWith('#')).toBe(true);
  });

  it('蓝色弱模式：苏军蓝改青绿，德军保留红', () => {
    const t = getTeamColors('tritanopia');
    expect(t.allies).toBe('#22c8a8');
    expect(t.axis).toBe('#ff5555');
  });

  it('非法模式回退正常配色', () => {
    expect(getTeamColors('unknown' as never)).toBe(TEAM_COLOR_SCHEMES.none);
  });

  it('模式校验：合法/非法', () => {
    expect(isColorBlindMode('none')).toBe(true);
    expect(isColorBlindMode('protanopia')).toBe(true);
    expect(isColorBlindMode('sepia')).toBe(false);
    expect(isColorBlindMode(42)).toBe(false);
  });

  it('hexToRgba：合法 hex 转 rgba，非法回退灰', () => {
    expect(hexToRgba('#ff4444', 0.6)).toBe('rgba(255,68,68,0.6)');
    expect(hexToRgba('#4488ff', 0.3)).toBe('rgba(68,136,255,0.3)');
    expect(hexToRgba('nope', 0.5)).toBe('rgba(128,128,128,0.5)');
  });
});
