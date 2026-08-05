import { describe, it, expect } from 'vitest';
import { shouldRedrawMinimap, MINIMAP_REFRESH_MS } from './HUD';

describe('HUD 小地图降频（阶段 9 P0：低频 UI 只在数据变化时写 Canvas）', () => {
  it('初始（lastDraw=0）立即重绘', () => {
    expect(shouldRedrawMinimap(0, 0)).toBe(true);
    expect(shouldRedrawMinimap(0, 10)).toBe(true);
  });

  it('间隔未满不重绘，满间隔重绘（默认 100ms = 10Hz）', () => {
    expect(shouldRedrawMinimap(1000, 1099)).toBe(false);
    expect(shouldRedrawMinimap(1000, 1100)).toBe(true); // 边界：≥ 间隔
    expect(shouldRedrawMinimap(1000, 1500)).toBe(true);
  });

  it('MINIMAP_REFRESH_MS 常量与默认一致', () => {
    expect(MINIMAP_REFRESH_MS).toBe(100);
    expect(shouldRedrawMinimap(1000, 1000 + MINIMAP_REFRESH_MS - 1)).toBe(false);
  });

  it('可自定义间隔（其他低频 UI 复用）', () => {
    expect(shouldRedrawMinimap(0, 0, 500)).toBe(true);
    expect(shouldRedrawMinimap(1000, 1499, 500)).toBe(false);
    expect(shouldRedrawMinimap(1000, 1500, 500)).toBe(true);
  });
});
