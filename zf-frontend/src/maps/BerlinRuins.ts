import * as THREE from 'three';
import { gameplayRandom } from '../core/Random';
import { generateBerlinLayout, BERLIN_LAYOUT_SEED } from '../../shared/mapLayout';

export interface MapConfig {
  size: number;
  cellSize: number;
  wallHeight: number;
  debrisDensity: number;
  rubbleCount: number;
  buildingCount: number;
  streetWidth: number;
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  size: 120,
  cellSize: 4,
  wallHeight: 3,
  debrisDensity: 0.3,
  rubbleCount: 50,
  buildingCount: 20,
  streetWidth: 6,
};

export class BerlinRuins {
  scene: THREE.Scene;
  config: MapConfig;
  ground: THREE.Mesh | null = null;
  buildings: THREE.Group[] = [];
  rubble: THREE.Group[] = [];
  collisionObjects: THREE.Object3D[] = [];
  /** 阶段 9：装饰物实例化——碎片/废墟由独立 Mesh 合并为 InstancedMesh（draw call 150+ → 2） */
  debrisInstances: THREE.InstancedMesh | null = null;
  rubbleInstances: THREE.InstancedMesh | null = null;
  /** 阶段 9：建筑本体 + 窗户实例化（20 + 60 → 2 draw call，建筑用 per-instance 颜色） */
  buildingInstances: THREE.InstancedMesh | null = null;
  windowInstances: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene, config: MapConfig = DEFAULT_MAP_CONFIG) {
    this.scene = scene;
    this.config = config;
  }

  generate(): void {
    this.createGround();
    this.createBuildings();
    this.createRubble();
    this.createDebris();
    this.createStreets();
    this.createAtmosphere();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(this.config.size, this.config.size);
    const material = new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 0.9,
      metalness: 0.1,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.collisionObjects.push(this.ground);
  }

  private createBuildings(): void {
    // 阶段 9：20 建筑（随机尺寸/颜色）+ 60 窗户 → 两个 InstancedMesh；建筑实例用 instanceColor 还原配色
    // 布局来自 shared/mapLayout 确定性生成（同源：服务端弹道挡弹裁决用同一布局）
    const buildingColors = [0x4a4a4a, 0x3a3a3a, 0x5a5a5a, 0x2a2a2a, 0x6a6a6a];
    const layouts = generateBerlinLayout(BERLIN_LAYOUT_SEED);
    const buildingCount = layouts.length;

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1); // 单位立方体 + per-instance 缩放
    const boxMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.2,
    });
    const buildingInstances = new THREE.InstancedMesh(boxGeometry, boxMaterial, buildingCount);

    const windowGeometry = new THREE.PlaneGeometry(1.5, 2);
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a3a,
      emissive: 0x0a0a1a,
      emissiveIntensity: 0.3,
    });
    const windowInstances = new THREE.InstancedMesh(windowGeometry, windowMaterial, buildingCount * 3);

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const color = new THREE.Color();
    let windowIndex = 0;

    // 布局随机调用顺序与 shared/mapLayout 一致（同一种子下地图布局不变）
    for (let i = 0; i < buildingCount; i++) {
      const { x, z, width, depth, height, colorIndex, windows } = layouts[i];

      // 建筑本体
      scale.set(width, height, depth);
      pos.set(x, height / 2, z);
      quat.identity();
      matrix.compose(pos, quat, scale);
      buildingInstances.setMatrixAt(i, matrix);
      color.setHex(buildingColors[colorIndex]);
      buildingInstances.setColorAt(i, color);

      // 窗户（布局自带，贴在建筑 z+ 面）
      for (const w of windows) {
        pos.set(w.x, w.y, w.z);
        quat.identity();
        scale.set(1, 1, 1);
        matrix.compose(pos, quat, scale);
        windowInstances.setMatrixAt(windowIndex++, matrix);
      }
    }

    buildingInstances.instanceMatrix.needsUpdate = true;
    if (buildingInstances.instanceColor) buildingInstances.instanceColor.needsUpdate = true;
    buildingInstances.castShadow = true;
    buildingInstances.receiveShadow = true;
    buildingInstances.computeBoundingSphere();
    windowInstances.instanceMatrix.needsUpdate = true;
    windowInstances.computeBoundingSphere();

    this.scene.add(buildingInstances);
    this.scene.add(windowInstances);
    this.buildingInstances = buildingInstances;
    this.windowInstances = windowInstances;
    // 碰撞保留：建筑本体原在 collisionObjects（弹道/AI 视线/交互射线共用），实例化后以 InstancedMesh 顶替
    this.collisionObjects.push(buildingInstances);
  }

  private createRubble(): void {
    // 阶段 9：50 个独立 Box Mesh → 单个 InstancedMesh（单位立方体 + per-instance 矩阵缩放/旋转/位移）
    // 碰撞保留：InstancedMesh 原生支持 Raycaster 命中（world 坐标 hit.point），直接加入 collisionObjects
    const count = this.config.rubbleCount;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.9,
      metalness: 0.1,
    });
    const instances = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    // 随机调用顺序与原实现一致（同一种子下布局不变）
    for (let i = 0; i < count; i++) {
      const size = 0.5 + gameplayRandom() * 2;
      const x = (gameplayRandom() - 0.5) * (this.config.size - 10);
      const z = (gameplayRandom() - 0.5) * (this.config.size - 10);
      euler.set(
        gameplayRandom() * Math.PI,
        gameplayRandom() * Math.PI,
        gameplayRandom() * Math.PI
      );
      quat.setFromEuler(euler);
      scale.set(size, size, size);
      pos.set(x, size / 2, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    // Raycaster 对 InstancedMesh 依赖 boundingSphere 裁剪，必须计算
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.rubbleInstances = instances;
    this.collisionObjects.push(instances);
  }

  private createDebris(): void {
    // 阶段 9：100 个共享几何/材质的独立 Dodecahedron → 单个 InstancedMesh（纯装饰，不参与碰撞）
    const debrisGeometry = new THREE.DodecahedronGeometry(0.3, 0);
    const debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.9,
    });
    const count = 100;
    const instances = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const x = (gameplayRandom() - 0.5) * this.config.size;
      const z = (gameplayRandom() - 0.5) * this.config.size;
      euler.set(gameplayRandom() * Math.PI, gameplayRandom() * Math.PI, 0);
      quat.setFromEuler(euler);
      pos.set(x, 0.15, z);
      matrix.compose(pos, quat, scale);
      instances.setMatrixAt(i, matrix);
    }

    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.computeBoundingSphere();
    this.scene.add(instances);
    this.debrisInstances = instances;
  }

  private createStreets(): void {
    const streetGeometry = new THREE.PlaneGeometry(this.config.streetWidth, this.config.size);
    const streetMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.95,
      metalness: 0.05,
    });

    const street1 = new THREE.Mesh(streetGeometry, streetMaterial);
    street1.rotation.x = -Math.PI / 2;
    street1.position.set(0, .01, 0);
    street1.receiveShadow = true;
    this.scene.add(street1);

    const street2 = new THREE.Mesh(streetGeometry, streetMaterial);
    street2.rotation.x = -Math.PI / 2;
    street2.rotation.z = Math.PI / 2;
    street2.position.set(0, .01, 0);
    street2.receiveShadow = true;
    this.scene.add(street2);
  }

  private createAtmosphere(): void {
    const fogColor = new THREE.Color(0x7a7a7a);
    this.scene.fog = new THREE.Fog(fogColor, 20, 80);
    this.scene.background = new THREE.Color(0x5a5a5a);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -60;
    directionalLight.shadow.camera.right = 60;
    directionalLight.shadow.camera.top = 60;
    directionalLight.shadow.camera.bottom = -60;
    this.scene.add(directionalLight);

    for (let i = 0; i < 5; i++) {
      const pointLight = new THREE.PointLight(0xffaa00, 0.5, 20);
      pointLight.position.set(
        (gameplayRandom() - 0.5) * this.config.size,
        3,
        (gameplayRandom() - 0.5) * this.config.size
      );
      this.scene.add(pointLight);
    }
  }

  getCollisionObjects(): THREE.Object3D[] {
    return this.collisionObjects;
  }

  getSpawnPoints(): { x: number; y: number; z: number }[] {
    const spawnPoints: { x: number; y: number; z: number }[] = [];
    const radius = this.config.size / 2 - 10;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      spawnPoints.push({
        x: Math.cos(angle) * radius,
        y: 1.7,
        z: Math.sin(angle) * radius,
      });
    }

    return spawnPoints;
  }

  dispose(): void {
    if (this.debrisInstances) {
      this.scene.remove(this.debrisInstances);
      this.debrisInstances = null;
    }
    if (this.rubbleInstances) {
      this.scene.remove(this.rubbleInstances);
      this.rubbleInstances = null;
    }
    if (this.buildingInstances) {
      this.scene.remove(this.buildingInstances);
      this.buildingInstances = null;
    }
    if (this.windowInstances) {
      this.scene.remove(this.windowInstances);
      this.windowInstances = null;
    }
    this.buildings.forEach(building => {
      this.scene.remove(building);
    });
    this.rubble.forEach(rubble => {
      this.scene.remove(rubble);
    });
    if (this.ground) {
      this.scene.remove(this.ground);
    }
    this.buildings = [];
    this.rubble = [];
    this.collisionObjects = [];
  }
}
