import * as THREE from 'three';
import { DEFAULT_GAME_CONFIG } from '../config';

export interface PerformanceBudget {
  targetFPS: number;
  maxDrawCalls: number;
  maxTriangles: number;
  /** 纹理数量上限（renderer.info.memory.textures 真实计数；旧版 maxTextureMemoryMB 字节估算无真实数据源，已停用） */
  maxTextures: number;
  /** 几何体数量上限（renderer.info.memory.geometries） */
  maxGeometries: number;
  maxFrameTime: number;
}

export const DEFAULT_BUDGET: PerformanceBudget = {
  targetFPS: DEFAULT_GAME_CONFIG.performance.targetFps,
  maxDrawCalls: DEFAULT_GAME_CONFIG.performance.maxDrawCalls,
  maxTriangles: DEFAULT_GAME_CONFIG.performance.maxTriangles,
  maxTextures: 512,
  maxGeometries: 1024,
  maxFrameTime: DEFAULT_GAME_CONFIG.performance.maxFrameTimeMs,
};

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

export class PerformanceBudgetManager {
  private budget: PerformanceBudget;
  private currentStats: RendererStats & { frameTime: number } = {
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    geometries: 0,
    frameTime: 0,
  };

  constructor(budget: PerformanceBudget = DEFAULT_BUDGET) {
    this.budget = budget;
  }

  checkBudget(): {
    withinBudget: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    if (this.currentStats.drawCalls > this.budget.maxDrawCalls) {
      violations.push(
        `Draw calls: ${this.currentStats.drawCalls} > ${this.budget.maxDrawCalls}`
      );
    }

    if (this.currentStats.triangles > this.budget.maxTriangles) {
      violations.push(
        `Triangles: ${this.currentStats.triangles} > ${this.budget.maxTriangles}`
      );
    }

    if (this.currentStats.textures > this.budget.maxTextures) {
      violations.push(
        `Textures: ${this.currentStats.textures} > ${this.budget.maxTextures}`
      );
    }

    if (this.currentStats.geometries > this.budget.maxGeometries) {
      violations.push(
        `Geometries: ${this.currentStats.geometries} > ${this.budget.maxGeometries}`
      );
    }

    if (this.currentStats.frameTime > this.budget.maxFrameTime) {
      violations.push(
        `Frame time: ${this.currentStats.frameTime.toFixed(2)}ms > ${this.budget.maxFrameTime}ms`
      );
    }

    return {
      withinBudget: violations.length === 0,
      violations,
    };
  }

  /**
   * 从 renderer.info 提取真实渲染统计（textures/geometries 为计数。
   * 旧实现把纹理数量 × 4 字节冒充 MB 是虚构数据——three.js 不暴露纹理字节数，
   * 改为数量型预算，避免"有预算无数据"）。
   */
  updateStats(renderer: THREE.WebGLRenderer): void {
    const info = renderer.info;
    this.setRendererStats({
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    });
  }

  /** 纯数据入口（测试/非 WebGL 环境注入） */
  setRendererStats(stats: RendererStats): void {
    this.currentStats = { ...stats, frameTime: this.currentStats.frameTime };
  }

  setFrameTime(frameTime: number): void {
    this.currentStats.frameTime = frameTime;
  }

  getCurrentStats(): RendererStats & { frameTime: number } {
    return { ...this.currentStats };
  }

  getBudget(): PerformanceBudget {
    return { ...this.budget };
  }
}
