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
      if (object instanceof THREE.Mesh) {
        if (optimization.lod) {
          this.applyLOD(object);
        }
        if (optimization.instancing) {
          this.applyInstancing(object);
        }
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

  private applyLOD(mesh: THREE.Mesh): void {
    const distance = 50;
    const lod = new THREE.LOD();

    lod.addLevel(mesh.clone(), 0);
    lod.addLevel(mesh.clone(), distance);
    lod.addLevel(mesh.clone(), distance * 2);

    mesh.parent?.remove(mesh);
    lod.add(mesh);
  }

  private applyInstancing(mesh: THREE.Mesh): void {
    if (mesh.geometry && mesh.geometry.isBufferGeometry) {
      const instancedMesh = new THREE.InstancedMesh(
        mesh.geometry,
        mesh.material,
        100
      );
      instancedMesh.castShadow = mesh.castShadow;
      instancedMesh.receiveShadow = mesh.receiveShadow;

      mesh.parent?.remove(mesh);
      mesh.parent?.add(instancedMesh);
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
