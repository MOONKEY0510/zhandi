import * as THREE from 'three';
import { BerlinRuins } from './BerlinRuins';

export interface SpawnPoint {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

export class MapManager {
  scene: THREE.Scene;
  currentMap: BerlinRuins | null = null;
  spawnPoints: SpawnPoint[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  loadMap(mapName: string): void {
    if (this.currentMap) {
      this.currentMap.dispose();
    }

    switch (mapName) {
      case 'berlin_ruins':
        this.currentMap = new BerlinRuins(this.scene);
        break;
      default:
        this.currentMap = new BerlinRuins(this.scene);
    }

    this.currentMap.generate();
    this.spawnPoints = this.currentMap.getSpawnPoints().map(p => ({
      position: new THREE.Vector3(p.x, p.y, p.z),
      rotation: new THREE.Euler(0, 0, 0),
      isOccupied: false,
      lastUsedTime: 0,
      cooldown: 5000,
    }));
  }

  getSpawnPoints(): SpawnPoint[] {
    return this.spawnPoints;
  }

  getRandomSpawnPoint(): SpawnPoint | null {
    if (this.spawnPoints.length === 0) return null;
    const index = Math.floor(Math.random() * this.spawnPoints.length);
    return this.spawnPoints[index];
  }

  getCollisionObjects(): THREE.Object3D[] {
    return this.currentMap?.getCollisionObjects() || [];
  }

  dispose(): void {
    this.currentMap?.dispose();
    this.currentMap = null;
    this.spawnPoints = [];
  }
}
