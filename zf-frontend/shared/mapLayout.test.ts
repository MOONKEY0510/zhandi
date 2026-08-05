import { describe, it, expect } from 'vitest';
import {
  generateBerlinLayout,
  layoutToStaticObstacles,
  BERLIN_BUILDING_COUNT,
  BERLIN_MAP_SIZE,
  BERLIN_LAYOUT_SEED,
  STATIC_OBSTACLE_ID_BASE,
} from './mapLayout';

describe('mapLayout（阶段 9：静态遮挡地图确定性化）', () => {
  it('同种子生成完全相同的布局（确定性）', () => {
    const a = generateBerlinLayout(BERLIN_LAYOUT_SEED);
    const b = generateBerlinLayout(BERLIN_LAYOUT_SEED);
    expect(a).toEqual(b);
    expect(a.length).toBe(BERLIN_BUILDING_COUNT);
  });

  it('不同种子生成不同布局', () => {
    const a = generateBerlinLayout(1);
    const b = generateBerlinLayout(2);
    expect(a).not.toEqual(b);
  });

  it('建筑数量、尺寸与窗户数符合约束', () => {
    const layouts = generateBerlinLayout();
    expect(layouts.length).toBe(20);
    for (const b of layouts) {
      expect(b.width).toBeGreaterThanOrEqual(8);
      expect(b.width).toBeLessThanOrEqual(20);
      expect(b.depth).toBeGreaterThanOrEqual(8);
      expect(b.depth).toBeLessThanOrEqual(20);
      expect(b.height).toBeGreaterThanOrEqual(5);
      expect(b.height).toBeLessThanOrEqual(20);
      expect(b.colorIndex).toBeGreaterThanOrEqual(0);
      expect(b.colorIndex).toBeLessThan(5);
      expect(b.windows.length).toBe(3);
      // 窗户贴在建筑 z+ 面外侧
      for (const w of b.windows) {
        expect(Math.abs(w.z - (b.z + b.width / 2 + 0.1))).toBeLessThan(1e-9);
        expect(w.y).toBeGreaterThanOrEqual(2);
        expect(w.y).toBeLessThanOrEqual(b.height);
      }
    }
  });

  it('全部建筑位于地图边界内', () => {
    const half = BERLIN_MAP_SIZE / 2;
    for (const b of generateBerlinLayout()) {
      expect(Math.abs(b.x) + b.width / 2).toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(b.z) + b.depth / 2).toBeLessThanOrEqual(half + 1e-9);
    }
  });

  it('layoutToStaticObstacles：轴对齐矩形、id 基址偏移、不可破坏', () => {
    const obstacles = layoutToStaticObstacles(generateBerlinLayout());
    expect(obstacles.length).toBe(20);
    obstacles.forEach((ob, i) => {
      expect(ob.id).toBe(STATIC_OBSTACLE_ID_BASE + i);
      expect(ob.rotationY).toBe(0);
      expect(ob.destroyed).toBe(false);
      expect(ob.halfWidth).toBeGreaterThan(0);
      expect(ob.halfHeight).toBeGreaterThan(0);
    });
  });
});
