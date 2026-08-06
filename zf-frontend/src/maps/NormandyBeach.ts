import * as THREE from 'three';
import { gameplayRandom } from '../core/Random';

/**
 * 诺曼底海滩（阶段 10+ 新特性：第三张地图）。
 * 开阔滩头 + 防御工事 + 海面，与柏林废墟/阿登森林形成地形对比。
 * InstancedMesh 优化：沙袋/反坦克障碍/碎木桩 → 3 个 draw call。
 */

export interface NormandyConfig {
  size: number;
  bunkerCount: number;
  sandbagCount: number;
  hedgehogCount: number;
  wreckCount: number;
}

export const DEFAULT_NORMANDY_CONFIG: NormandyConfig = {
  size: 120,
  bunkerCount: 8,
  sandbagCount: 60,
  hedgehogCount: 40,
  wreckCount: 10,
};

export class NormandyBeach {
  scene: THREE.Scene;
  config: NormandyConfig;
  ground: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  collisionObjects: THREE.Object3D[] = [];
  private sandbagInstances: THREE.InstancedMesh | null = null;
  private hedgehogInstances: THREE.InstancedMesh | null = null;
  private wreckInstances: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene, config: NormandyConfig = DEFAULT_NORMANDY_CONFIG) {
    this.scene = scene;
    this.config = config;
  }

  generate(): void {
    this.createGround();
    this.createWater();
    this.createBunkers();
    this.createSandbags();
    this.createHedgehogs();
    this.createWrecks();
    this.createAtmosphere();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(this.config.size, this.config.size);
    const material = new THREE.MeshStandardMaterial({
      color: 0xcbbd9e, // 沙滩米色
      roughness: 0.95,
      metalness: 0.0,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.collisionObjects.push(this.ground);
  }

  private createWater(): void {
    // 海面：半透明蓝色平面，覆盖地图北侧
    const geometry = new THREE.PlaneGeometry(this.config.size, this.config.size * 0.45);
    const material = new THREE.MeshStandardMaterial({
      color: 0x3a6ea5,
      roughness: 0.3,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.water = new THREE.Mesh(geometry, material);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.z = -(this.config.size * 0.275); // 北侧
    this.water.position.y = 0.15;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  private createBunkers(): void {
    // 碉堡：混凝土大盒子，分散在滩头后方
    const bodyGeometry = new THREE.BoxGeometry(4, 2.5, 5);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8a8a,
      roughness: 0.9,
      metalness: 0.05,
    });
    const roofGeometry = new THREE.BoxGeometry(4.4, 0.3, 5.4);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      roughness: 0.95,
    });

    const half = this.config.size / 2;
    for (let i = 0; i < this.config.bunkerCount; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = 1.25;
      group.add(body);

      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.y = 2.65;
      group.add(roof);

      // 碉堡分布在滩头后方 20-50m 区域
      const x = (gameplayRandom() - 0.5) * (this.config.size - 20);
      const z = -half * 0.5 + gameplayRandom() * 30;
      group.position.set(x, 0, z);
      group.rotation.y = Math.PI * 0.5; // 面向海滩
      this.scene.add(group);
      this.collisionObjects.push(group);
    }
  }

  private createSandbags(): void {
    const count = this.config.sandbagCount;
    const geometry = new THREE.BoxGeometry(0.6, 0.35, 0.25);
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0a070,
      roughness: 1.0,
      metalness: 0.0,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();

    // 沙袋沿滩头排列 + 散落各处
    for (let i = 0; i < count; i++) {
      const x = (gameplayRandom() - 0.5) * (this.config.size - 16);
      const z = (gameplayRandom() - 0.5) * (this.config.size - 16);
      quat.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        gameplayRandom() * Math.PI * 0.3 + (i < count * 0.4 ? 0 : gameplayRandom() * Math.PI),
      );
      pos.set(x, 0.18, z);
      matrix.compose(pos, quat, new THREE.Vector3(1, 1, 1));
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.sandbagInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createHedgehogs(): void {
    // 反坦克障碍（"捷克刺猬"）：三根交叉钢管
    const count = this.config.hedgehogCount;
    const barGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
    const material = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.85,
      metalness: 0.7,
    });
    const instances = new THREE.InstancedMesh(barGeometry, material, count * 3);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const half = this.config.size / 2;

    for (let i = 0; i < count; i++) {
      const x = (gameplayRandom() - 0.5) * (this.config.size - 20);
      const z = -half * 0.4 + gameplayRandom() * 35;
      const baseY = 0.55;

      for (let bar = 0; bar < 3; bar++) {
        const idx = i * 3 + bar;
        // 三根钢管不同角度交叉
        euler.set(
          (bar === 2 ? Math.PI / 2 : 0) + gameplayRandom() * 0.2,
          (bar * Math.PI / 3) + gameplayRandom() * 0.3,
          bar === 0 ? Math.PI / 2 : 0,
        );
        quat.setFromEuler(euler);
        pos.set(x, baseY, z);
        matrix.compose(pos, quat, new THREE.Vector3(1, 1, 1));
        instances.setMatrixAt(idx, matrix);
      }
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.hedgehogInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createWrecks(): void {
    // 损毁的登陆艇/木箱/残骸
    const count = this.config.wreckCount;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7a6a4a,
      roughness: 0.95,
      metalness: 0.1,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const half = this.config.size / 2;

    for (let i = 0; i < count; i++) {
      const x = (gameplayRandom() - 0.5) * (this.config.size - 30);
      const z = -half * 0.35 + gameplayRandom() * 20;
      euler.set(
        gameplayRandom() * 0.3,
        gameplayRandom() * Math.PI,
        (gameplayRandom() - 0.5) * 0.4,
      );
      quat.setFromEuler(euler);
      scale.set(
        2 + gameplayRandom() * 3,
        0.4 + gameplayRandom() * 0.8,
        1 + gameplayRandom() * 1.5,
      );
      pos.set(x, scale.y * 0.5, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.wreckInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createAtmosphere(): void {
    // 诺曼底清晨：灰蓝雾 + 暖色阳光
    const fogColor = new THREE.Color(0xc0c8d0);
    this.scene.fog = new THREE.Fog(fogColor, 40, 130);
    this.scene.background = new THREE.Color(0xa8b4c0);

    const ambientLight = new THREE.AmbientLight(0x8899aa, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffeedd, 0.9);
    directionalLight.position.set(60, 80, 40);
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
    const half = this.config.size / 2;
    // 8 个出生点：南侧"盟军"滩头 + 北侧"轴心"后方
    for (let i = 0; i < 4; i++) {
      const offset = (i - 1.5) * 20;
      spawnPoints.push(
        { x: offset, y: 1.7, z: half - 12 },
        { x: offset, y: 1.7, z: -half + 12 },
      );
    }
    return spawnPoints;
  }

  dispose(): void {
    const meshes = [this.sandbagInstances, this.hedgehogInstances, this.wreckInstances];
    for (const mesh of meshes) {
      if (mesh) this.scene.remove(mesh);
    }
    if (this.ground) this.scene.remove(this.ground);
    if (this.water) this.scene.remove(this.water);
    this.sandbagInstances = null;
    this.hedgehogInstances = null;
    this.wreckInstances = null;
    this.ground = null;
    this.water = null;
    this.collisionObjects = [];
  }
}