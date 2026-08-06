import * as THREE from 'three';

/** 靶子 userData 标记：射线命中靶子供训练计数（阶段 10 P1 新手训练场） */
export const TRAINING_TARGET_FLAG = 'trainingTarget';

/** 训练场布局常量：出生点/标记点/靶子排/训练据点/载具点（GameScene 与 ConquestMode 共用，保持同一坐标系） */
export const TRAINING_LAYOUT = {
  spawn: { x: 0, y: 1.7, z: 22 },
  moveMarker: { x: 0, z: 10 },
  mobilityMarker: { x: 0, z: -2 },
  targetRowZ: -10,
  capturePoint: { x: 0, z: -22 },
  vehiclePoint: { x: 10, z: -10 },
} as const;

const TARGET_XS = [-8, -4, 0, 4, 8];

/**
 * 新手训练场地图（阶段 10 P1）：平坦靶场——靶子排 + 矮障碍区 + 金色标记点。
 * 接口与 BerlinRuins 对齐（generate/getSpawnPoints/getCollisionObjects/dispose），由 MapManager 加载。
 */
export class TrainingRange {
  scene: THREE.Scene;
  ground: THREE.Mesh | null = null;
  targets: THREE.Mesh[] = [];
  obstacles: THREE.Mesh[] = [];
  collisionObjects: THREE.Object3D[] = [];
  private markers: THREE.Mesh[] = [];
  /** 阶段 10+ 扩展：移动靶数据（靶子 + 靶架） */
  private movingTargets: { board: THREE.Mesh; stand: THREE.Mesh; baseX: number; baseZ: number; amplitude: number; speed: number; phase: number }[] = [];
  private disposables: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  generate(): void {
    this.createGround();
    this.createTargets();
    this.createObstacles();
    this.createMarkers();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(60, 60);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6a6a5a,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // 地面仅视觉——物理碰撞由 PhysicsWorld.createGround 提供，不入环境碰撞集（避免射线误命中地面遮挡靶子）
    this.disposables.push({ geometry, material });
  }

  /** 靶子排：5 个木色靶板，面向玩家出生方向（z+）。x=-4,4 为移动靶，其余静态。 */
  private createTargets(): void {
    const MOVING_XS = new Set([-4, 4]);
    for (const x of TARGET_XS) {
      const boardGeo = new THREE.BoxGeometry(1.2, 1.8, 0.15);
      const boardMat = new THREE.MeshStandardMaterial({
        color: MOVING_XS.has(x) ? 0xd8a050 : 0xd8c9a3,
        roughness: 0.7,
        metalness: 0.1,
      });
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(x, 0.9, TRAINING_LAYOUT.targetRowZ);
      board.castShadow = true;
      board.userData[TRAINING_TARGET_FLAG] = true;
      this.scene.add(board);
      this.targets.push(board);
      this.collisionObjects.push(board);
      this.disposables.push({ geometry: boardGeo, material: boardMat });

      // 靶架
      const standGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6);
      const standMat = new THREE.MeshStandardMaterial({ color: 0x4a4a3a, roughness: 0.8 });
      const stand = new THREE.Mesh(standGeo, standMat);
      stand.position.set(x, 0.2, TRAINING_LAYOUT.targetRowZ + 0.3);
      this.scene.add(stand);
      this.collisionObjects.push(stand);
      this.disposables.push({ geometry: standGeo, material: standMat });

      // 阶段 10+ 扩展：移动靶（x=-4,4 沿 X 轴摆动 ±3m）
      if (MOVING_XS.has(x)) {
        this.movingTargets.push({
          board, stand,
          baseX: x, baseZ: TRAINING_LAYOUT.targetRowZ,
          amplitude: 3, speed: 0.8, phase: x > 0 ? 0 : Math.PI,
        });
      }
    }
  }

  /** 阶段 10+ 扩展：更新移动靶位置（由 GameScene 每帧调用） */
  updateTargets(time: number): void {
    for (const mt of this.movingTargets) {
      const offset = Math.sin(time * mt.speed + mt.phase) * mt.amplitude;
      mt.board.position.x = mt.baseX + offset;
      mt.stand.position.x = mt.baseX + offset;
    }
  }

  /** 矮障碍区：4 沙袋（z=2）+ 2 矮墙（z=-2），可跳过/翻越，练习冲刺与跳跃 */
  private createObstacles(): void {
    const sandbagXs = [-4, -1.5, 1.5, 4];
    for (const x of sandbagXs) {
      const geo = new THREE.BoxGeometry(2, 0.8, 0.8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.4, 2);
      mesh.rotation.y = 0.2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.obstacles.push(mesh);
      this.collisionObjects.push(mesh);
      this.disposables.push({ geometry: geo, material: mat });
    }

    const wallXs = [-2, 2];
    for (const x of wallXs) {
      const geo = new THREE.BoxGeometry(2.4, 1.0, 0.4);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.5, TRAINING_LAYOUT.mobilityMarker.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.obstacles.push(mesh);
      this.collisionObjects.push(mesh);
      this.disposables.push({ geometry: geo, material: mat });
    }
  }

  /** 金色标记点：移动标记（z=10）与载具点（x=10,z=-10）——仅视觉提示，不参与碰撞 */
  private createMarkers(): void {
    this.addMarker(TRAINING_LAYOUT.moveMarker.x, TRAINING_LAYOUT.moveMarker.z);
    this.addMarker(TRAINING_LAYOUT.vehiclePoint.x, TRAINING_LAYOUT.vehiclePoint.z);
  }

  private addMarker(x: number, z: number): void {
    const geo = new THREE.RingGeometry(1.6, 2, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const marker = new THREE.Mesh(geo, mat);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, 0.12, z);
    this.scene.add(marker);
    this.markers.push(marker);
    this.disposables.push({ geometry: geo, material: mat });
  }

  getSpawnPoints(): { x: number; y: number; z: number }[] {
    return [{ ...TRAINING_LAYOUT.spawn }];
  }

  getCollisionObjects(): THREE.Object3D[] {
    return this.collisionObjects;
  }

  getTargetMeshes(): THREE.Mesh[] {
    return this.targets;
  }

  dispose(): void {
    for (const obj of [this.ground, ...this.targets, ...this.obstacles, ...this.markers]) {
      if (obj) this.scene.remove(obj);
    }
    for (const d of this.disposables) {
      d.geometry.dispose();
      d.material.dispose();
    }
    this.targets = [];
    this.obstacles = [];
    this.markers = [];
    this.collisionObjects = [];
    this.disposables = [];
    this.ground = null;
  }
}
