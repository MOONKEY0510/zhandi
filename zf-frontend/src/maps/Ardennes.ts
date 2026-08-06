import * as THREE from 'three';
import { gameplayRandom } from '../core/Random';

/**
 * 阿登森林（阶段 10+ 新特性：第二张地图）。
 * 与柏林废墟形成对比：雪地 + 松树林 + 冷雾，开阔地形以树木/岩石/雪堆为掩体。
 * 沿用柏林地图的 InstancedMesh 优化模式（树冠/树干/岩石/雪堆 → 4 个 draw call）。
 */

export interface ArdennesConfig {
  size: number;
  treeCount: number;
  rockCount: number;
  snowMoundCount: number;
  logCount: number;
}

export const DEFAULT_ARDENNES_CONFIG: ArdennesConfig = {
  size: 120,
  treeCount: 120,
  rockCount: 40,
  snowMoundCount: 30,
  logCount: 20,
};

export class Ardennes {
  scene: THREE.Scene;
  config: ArdennesConfig;
  ground: THREE.Mesh | null = null;
  collisionObjects: THREE.Object3D[] = [];
  private canopyInstances: THREE.InstancedMesh | null = null;
  private trunkInstances: THREE.InstancedMesh | null = null;
  private rockInstances: THREE.InstancedMesh | null = null;
  private moundInstances: THREE.InstancedMesh | null = null;
  private logInstances: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene, config: ArdennesConfig = DEFAULT_ARDENNES_CONFIG) {
    this.scene = scene;
    this.config = config;
  }

  generate(): void {
    this.createGround();
    this.createTrees();
    this.createRocks();
    this.createSnowMounds();
    this.createLogs();
    this.createAtmosphere();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(this.config.size, this.config.size);
    const material = new THREE.MeshStandardMaterial({
      color: 0xdfe6df,
      roughness: 1.0,
      metalness: 0.0,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.collisionObjects.push(this.ground);
  }

  private createTrees(): void {
    const treeCount = this.config.treeCount;
    const canopyGeometry = new THREE.ConeGeometry(1, 1, 8);
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e4a2a,
      roughness: 0.9,
    });
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3524,
      roughness: 0.95,
    });

    const canopies = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, treeCount);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const color = new THREE.Color();

    // 森林分区：中央空地（据点区），树木分布在半径 25–55m 环带
    const half = this.config.size / 2;
    for (let i = 0; i < treeCount; i++) {
      const radius = 25 + gameplayRandom() * (half - 30);
      const angle = gameplayRandom() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const height = 3.5 + gameplayRandom() * 3;
      const canopyRadius = 1.2 + gameplayRandom() * 0.8;

      // 树干
      quat.identity();
      scale.set(1, height * 0.45, 1);
      pos.set(x, height * 0.45 / 2, z);
      matrix.compose(pos, quat, scale);
      trunks.setMatrixAt(i, matrix);

      // 树冠（两层锥叠出松树轮廓）
      quat.identity();
      scale.set(canopyRadius, height, canopyRadius);
      pos.set(x, height * 0.45 + height * 0.55, z);
      matrix.compose(pos, quat, scale);
      canopies.setMatrixAt(i, matrix);
      // 雪覆盖树冠：随机挑一部分染浅色
      color.setHex(gameplayRandom() < 0.35 ? 0x4a5a4a : 0x2e4a2a);
      canopies.setColorAt(i, color);
    }

    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    canopies.castShadow = true;
    canopies.computeBoundingSphere();
    trunks.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    trunks.computeBoundingSphere();

    this.scene.add(canopies);
    this.scene.add(trunks);
    this.canopyInstances = canopies;
    this.trunkInstances = trunks;
    // 树冠参与碰撞（射击/视线/移动碰撞共用，树冠底部约 1.6m 高，玩家可穿过树干底部空隙）
    this.collisionObjects.push(canopies);
  }

  private createRocks(): void {
    const count = this.config.rockCount;
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8a8f96,
      roughness: 0.95,
      metalness: 0.05,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const size = 0.6 + gameplayRandom() * 1.8;
      const x = (gameplayRandom() - 0.5) * (this.config.size - 12);
      const z = (gameplayRandom() - 0.5) * (this.config.size - 12);
      euler.set(gameplayRandom() * Math.PI, gameplayRandom() * Math.PI, gameplayRandom() * Math.PI);
      quat.setFromEuler(euler);
      scale.set(size, size * (0.5 + gameplayRandom() * 0.5), size);
      pos.set(x, size * 0.35, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.rockInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createSnowMounds(): void {
    const count = this.config.snowMoundCount;
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshStandardMaterial({
      color: 0xf0f4f0,
      roughness: 1.0,
      metalness: 0.0,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const radius = 0.8 + gameplayRandom() * 1.5;
      const x = (gameplayRandom() - 0.5) * (this.config.size - 16);
      const z = (gameplayRandom() - 0.5) * (this.config.size - 16);
      quat.identity();
      scale.set(radius * 1.6, radius * 0.6, radius);
      pos.set(x, radius * 0.3, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.moundInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createLogs(): void {
    const count = this.config.logCount;
    const geometry = new THREE.CylinderGeometry(0.35, 0.35, 1, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0x5a4632,
      roughness: 0.95,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const length = 2 + gameplayRandom() * 3;
      const x = (gameplayRandom() - 0.5) * (this.config.size - 14);
      const z = (gameplayRandom() - 0.5) * (this.config.size - 14);
      euler.set(0, gameplayRandom() * Math.PI, Math.PI / 2);
      quat.setFromEuler(euler);
      scale.set(length, 1, 1);
      pos.set(x, 0.35, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.logInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createAtmosphere(): void {
    // 冷色薄雾（阿登清晨）
    const fogColor = new THREE.Color(0xc8d4d8);
    this.scene.fog = new THREE.Fog(fogColor, 30, 110);
    this.scene.background = new THREE.Color(0xb8c6cc);

    const ambientLight = new THREE.AmbientLight(0xaabbcc, 0.55);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xfff4e0, 0.85);
    directionalLight.position.set(40, 90, 60);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 220;
    directionalLight.shadow.camera.left = -70;
    directionalLight.shadow.camera.right = 70;
    directionalLight.shadow.camera.top = 70;
    directionalLight.shadow.camera.bottom = -70;
    this.scene.add(directionalLight);
  }

  getCollisionObjects(): THREE.Object3D[] {
    return this.collisionObjects;
  }

  getSpawnPoints(): { x: number; y: number; z: number }[] {
    const spawnPoints: { x: number; y: number; z: number }[] = [];
    const radius = this.config.size / 2 - 12;
    // 八个方位出生点（避开中央空地）
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.2;
      spawnPoints.push({
        x: Math.cos(angle) * radius,
        y: 1.7,
        z: Math.sin(angle) * radius,
      });
    }
    return spawnPoints;
  }

  dispose(): void {
    const meshes = [
      this.canopyInstances,
      this.trunkInstances,
      this.rockInstances,
      this.moundInstances,
      this.logInstances,
    ];
    for (const mesh of meshes) {
      if (mesh) this.scene.remove(mesh);
    }
    if (this.ground) this.scene.remove(this.ground);
    this.canopyInstances = null;
    this.trunkInstances = null;
    this.rockInstances = null;
    this.moundInstances = null;
    this.logInstances = null;
    this.ground = null;
    this.collisionObjects = [];
  }
}
