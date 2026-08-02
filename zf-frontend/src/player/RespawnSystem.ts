import * as THREE from 'three';

export interface SpawnPoint {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  isOccupied: boolean;
  lastUsedTime: number;
  cooldown: number;
}

export class RespawnSystem {
  spawnPoints: SpawnPoint[] = [];
  defaultSpawnPoint: SpawnPoint;
  respawnDelay: number = 3000;
  lastDeathTime: number = 0;

  constructor() {
    this.defaultSpawnPoint = {
      position: new THREE.Vector3(0, 1.7, 0),
      rotation: new THREE.Euler(0, 0, 0),
      isOccupied: false,
      lastUsedTime: 0,
      cooldown: 5000,
    };
  }

  addSpawnPoint(position: THREE.Vector3, rotation?: THREE.Euler): void {
    this.spawnPoints.push({
      position: position.clone(),
      rotation: rotation || new THREE.Euler(0, 0, 0),
      isOccupied: false,
      lastUsedTime: 0,
      cooldown: 5000,
    });
  }

  setSpawnPoints(points: { position: THREE.Vector3; rotation?: THREE.Euler }[]): void {
    this.spawnPoints = points.map(point => ({
      position: point.position.clone(),
      rotation: point.rotation || new THREE.Euler(0, 0, 0),
      isOccupied: false,
      lastUsedTime: 0,
      cooldown: 5000,
    }));
  }

  getSpawnPoint(currentTime: number): SpawnPoint {
    if (this.spawnPoints.length === 0) {
      return this.defaultSpawnPoint;
    }

    const availablePoints = this.spawnPoints.filter(
      point => !point.isOccupied && currentTime - point.lastUsedTime >= point.cooldown
    );

    if (availablePoints.length === 0) {
      const randomPoint = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
      return randomPoint;
    }

    const randomIndex = Math.floor(Math.random() * availablePoints.length);
    const selectedPoint = availablePoints[randomIndex];
    selectedPoint.isOccupied = true;
    selectedPoint.lastUsedTime = currentTime;

    return selectedPoint;
  }

  releaseSpawnPoint(point: SpawnPoint): void {
    point.isOccupied = false;
  }

  canRespawn(currentTime: number): boolean {
    return currentTime - this.lastDeathTime >= this.respawnDelay;
  }

  recordDeath(currentTime: number): void {
    this.lastDeathTime = currentTime;
  }

  update(currentTime: number): void {
    for (const point of this.spawnPoints) {
      if (point.isOccupied && currentTime - point.lastUsedTime >= point.cooldown) {
        point.isOccupied = false;
      }
    }
  }

  getSpawnPointCount(): number {
    return this.spawnPoints.length;
  }

  getAvailableSpawnPointCount(currentTime: number): number {
    return this.spawnPoints.filter(
      point => !point.isOccupied && currentTime - point.lastUsedTime >= point.cooldown
    ).length;
  }
}
