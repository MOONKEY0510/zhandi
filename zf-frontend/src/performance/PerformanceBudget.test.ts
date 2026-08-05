import { describe, it, expect } from 'vitest';
import { PerformanceBudgetManager, DEFAULT_BUDGET } from './PerformanceBudget';

describe('PerformanceBudgetManager（阶段 9：真实预算数据）', () => {
  it('默认预算无超限（空统计）', () => {
    const manager = new PerformanceBudgetManager();
    const result = manager.checkBudget();
    expect(result.withinBudget).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('drawCalls / triangles 超限被检出', () => {
    const manager = new PerformanceBudgetManager();
    manager.setRendererStats({
      drawCalls: DEFAULT_BUDGET.maxDrawCalls + 10,
      triangles: DEFAULT_BUDGET.maxTriangles + 1000,
      textures: 0,
      geometries: 0,
    });
    const result = manager.checkBudget();
    expect(result.withinBudget).toBe(false);
    expect(result.violations.some((v) => v.startsWith('Draw calls:'))).toBe(true);
    expect(result.violations.some((v) => v.startsWith('Triangles:'))).toBe(true);
  });

  it('纹理/几何体数量超限被检出（旧版字节估算已移除，改真实计数）', () => {
    const manager = new PerformanceBudgetManager();
    manager.setRendererStats({
      drawCalls: 0,
      triangles: 0,
      textures: DEFAULT_BUDGET.maxTextures + 1,
      geometries: DEFAULT_BUDGET.maxGeometries + 1,
    });
    const result = manager.checkBudget();
    expect(result.withinBudget).toBe(false);
    expect(result.violations.some((v) => v.startsWith('Textures:'))).toBe(true);
    expect(result.violations.some((v) => v.startsWith('Geometries:'))).toBe(true);
  });

  it('frameTime 超限被检出，且 stats 完整返回真实计数', () => {
    const manager = new PerformanceBudgetManager();
    manager.setRendererStats({ drawCalls: 12, triangles: 34, textures: 5, geometries: 6 });
    manager.setFrameTime(20); // > 16.67
    const result = manager.checkBudget();
    expect(result.withinBudget).toBe(false);
    expect(result.violations.some((v) => v.startsWith('Frame time:'))).toBe(true);

    const stats = manager.getCurrentStats();
    expect(stats.drawCalls).toBe(12);
    expect(stats.textures).toBe(5);
    expect(stats.geometries).toBe(6);
    expect(stats.frameTime).toBe(20);
  });

  it('setRendererStats 不清空 frameTime（渲染统计与帧耗时独立更新）', () => {
    const manager = new PerformanceBudgetManager();
    manager.setFrameTime(8);
    manager.setRendererStats({ drawCalls: 1, triangles: 2, textures: 3, geometries: 4 });
    expect(manager.getCurrentStats().frameTime).toBe(8);
  });
});
