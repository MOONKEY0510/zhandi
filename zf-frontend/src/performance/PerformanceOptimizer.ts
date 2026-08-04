import * as THREE from 'three';
import { PerformanceMonitor } from '../performance/PerformanceMonitor';
import { PerformanceBudgetManager } from '../performance/PerformanceBudget';

export class PerformanceOptimizer {
  private monitor: PerformanceMonitor;
  private budgetManager: PerformanceBudgetManager;
  private renderer: THREE.WebGLRenderer;
  private optimizationLevel: 'low' | 'medium' | 'high' = 'medium';

  constructor(renderer: THREE.WebGLRenderer, budgetManager: PerformanceBudgetManager) {
    this.renderer = renderer;
    this.monitor = new PerformanceMonitor();
    this.budgetManager = budgetManager;
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
    };
  }

  isWithinBudget(): boolean {
    return this.budgetManager.checkBudget().withinBudget;
  }
}
