import * as THREE from 'three';
import { PerformanceMonitor } from '../performance/PerformanceMonitor';
import { PerformanceBudgetManager } from '../performance/PerformanceBudget';
import { FrameBudget } from '../performance/FrameBudget';

export class PerformanceOptimizer {
  private monitor: PerformanceMonitor;
  private budgetManager: PerformanceBudgetManager;
  private renderer: THREE.WebGLRenderer;
  private optimizationLevel: 'low' | 'medium' | 'high' = 'medium';
  /** 阶段 9：CPU 各阶段帧预算采集（埋点由 GameScene 帧循环调用 begin/end） */
  readonly frameBudget: FrameBudget;

  constructor(
    renderer: THREE.WebGLRenderer,
    budgetManager: PerformanceBudgetManager,
    frameBudget: FrameBudget = new FrameBudget(),
  ) {
    this.renderer = renderer;
    this.monitor = new PerformanceMonitor();
    this.budgetManager = budgetManager;
    this.frameBudget = frameBudget;
  }

  setOptimizationLevel(level: 'low' | 'medium' | 'high'): void {
    this.optimizationLevel = level;

    switch (level) {
      case 'low':
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        break;
      case 'medium':
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        break;
      case 'high':
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        break;
    }
  }

  optimizeScene(scene: THREE.Scene): void {
    const optimization = this.getOptimizationSettings();

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.frustumCulled = true;
      if (optimization.lod && object.userData.lodGroup) {
        object.userData.lodEnabled = true;
      }
    });
  }

  private getOptimizationSettings() {
    switch (this.optimizationLevel) {
      case 'low':
        return { lod: false, instancing: false };
      case 'medium':
        return { lod: true, instancing: false };
      case 'high':
        return { lod: true, instancing: true };
    }
  }

  update(): void {
    this.monitor.update();
    this.budgetManager.updateStats(this.renderer);
    this.budgetManager.setFrameTime(this.monitor.getFrameTime());
  }

  getStats() {
    return {
      monitor: this.monitor.getStats(),
      budget: this.budgetManager.getCurrentStats(),
      budgetManager: this.budgetManager.getBudget(),
      frameBudget: this.frameBudget.allStats(),
    };
  }

  isWithinBudget(): boolean {
    return this.budgetManager.checkBudget().withinBudget && this.frameBudget.isWithinBudget();
  }
}
