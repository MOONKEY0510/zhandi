import * as THREE from 'three';
import { Ardennes } from './Ardennes';
import { BerlinRuins } from './BerlinRuins';
import { buildMapFromDefinition, type BuiltMapData, type MapDefinition } from './MapDefinition';
import { TrainingRange } from './TrainingRange';

export interface SpawnPoint {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

export type MapId = 'berlin_ruins' | 'ardennes' | 'training_range';

export class MapManager {
  scene: THREE.Scene;
  currentMap: BerlinRuins | TrainingRange | Ardennes | null = null;
  spawnPoints: SpawnPoint[] = [];
  private builtDefinition: BuiltMapData | null = null;

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
      case 'ardennes':
        this.currentMap = new Ardennes(this.scene);
        break;
      case 'training_range':
        this.currentMap = new TrainingRange(this.scene);
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

  loadDefinition(definition: MapDefinition): void {
    this.dispose();
    this.builtDefinition = buildMapFromDefinition(definition);
    this.scene.add(this.builtDefinition.root);
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
    return this.builtDefinition?.collisionObjects ?? this.currentMap?.getCollisionObjects() ?? [];
  }

  getNavigationObjects() {
    return this.builtDefinition?.navigationObjects ?? [];
  }

  getSoundZones() {
    return this.builtDefinition?.soundZones ?? [];
  }

  /** 训练场靶子网格（训练射击计数用）；非训练场返回空数组 */
  getTrainingTargets(): THREE.Object3D[] {
    if (this.currentMap instanceof TrainingRange) return this.currentMap.getTargetMeshes();
    return [];
  }

  dispose(): void {
    if (this.builtDefinition) {
      this.scene.remove(this.builtDefinition.root);
      this.builtDefinition = null;
    }
    this.currentMap?.dispose();
    this.currentMap = null;
    this.spawnPoints = [];
  }
}
