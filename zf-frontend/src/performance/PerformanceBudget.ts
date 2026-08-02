import * as THREE from 'three';

export interface PerformanceBudget {
  targetFPS: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxTextureMemoryMB: number;
  maxFrameTime: number;
}

export const DEFAULT_BUDGET: PerformanceBudget = {
  targetFPS: 60,
  maxDrawCalls: 100,
  maxTriangles: 100000,
  maxTextureMemoryMB: 50,
  maxFrameTime: 16.67,
};

export class PerformanceBudgetManager {
  private budget: PerformanceBudget;
  private currentStats = {
    drawCalls: 0,
    triangles: 0,
    textureMemoryMB: 0,
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

    if (this.currentStats.textureMemoryMB > this.budget.maxTextureMemoryMB) {
      violations.push(
        `Texture memory: ${this.currentStats.textureMemoryMB.toFixed(2)}MB > ${this.budget.maxTextureMemoryMB}MB`
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

  updateStats(renderer: THREE.WebGLRenderer): void {
    const info = renderer.info;
    this.currentStats.drawCalls = info.render.calls;
    this.currentStats.triangles = info.render.triangles;

    let textureMemory = 0;
    const textures = renderer.info.memory.textures as number;
    textureMemory = textures * 4 / (1024 * 1024);
    this.currentStats.textureMemoryMB = textureMemory;
  }

  setFrameTime(frameTime: number): void {
    this.currentStats.frameTime = frameTime;
  }

  getCurrentStats() {
    return { ...this.currentStats };
  }

  getBudget() {
    return { ...this.budget };
  }
}
