import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TrainingRange, TRAINING_LAYOUT, TRAINING_TARGET_FLAG } from './TrainingRange';

describe('TrainingRange（阶段 10 P1：新手训练场地图）', () => {
  let scene: THREE.Scene;
  let range: TrainingRange;

  beforeEach(() => {
    scene = new THREE.Scene();
    range = new TrainingRange(scene);
    range.generate();
  });

  it('生成地面、5 个靶子、6 个障碍与 2 个标记', () => {
    expect(range.ground).not.toBeNull();
    expect(range.targets.length).toBe(5);
    expect(range.obstacles.length).toBe(6);
    // 碰撞对象 = 靶子×5 + 靶架×5 + 障碍×6（地面不入环境碰撞集，由物理地面承载）
    expect(range.collisionObjects.length).toBe(16);
  });

  it('靶子带 trainingTarget 标记，位置在靶子排 z 线上', () => {
    for (const target of range.targets) {
      expect(target.userData[TRAINING_TARGET_FLAG]).toBe(true);
      expect(target.position.z).toBe(TRAINING_LAYOUT.targetRowZ);
    }
  });

  it('出生点与布局常量一致', () => {
    const spawns = range.getSpawnPoints();
    expect(spawns.length).toBe(1);
    expect(spawns[0].x).toBe(TRAINING_LAYOUT.spawn.x);
    expect(spawns[0].z).toBe(TRAINING_LAYOUT.spawn.z);
  });

  it('从出生点朝靶子方向发射射线可命中靶子（碰撞保留）', () => {
    // 普通 Mesh 的 raycast 依赖 matrixWorld，需手动更新（无 renderer 环境）
    scene.updateMatrixWorld();
    const origin = new THREE.Vector3(TRAINING_LAYOUT.spawn.x, 1.5, TRAINING_LAYOUT.spawn.z);
    const direction = new THREE.Vector3(0, 0, -1).normalize();
    const raycaster = new THREE.Raycaster(origin, direction, 0, 40);
    const hits = raycaster.intersectObjects(range.getCollisionObjects(), false);
    expect(hits.length).toBeGreaterThan(0);
    const hasTarget = hits.some((hit) => {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData[TRAINING_TARGET_FLAG]) return true;
        obj = obj.parent;
      }
      return false;
    });
    expect(hasTarget).toBe(true);
  });

  it('dispose 清空场景与引用', () => {
    range.dispose();
    expect(range.targets.length).toBe(0);
    expect(range.obstacles.length).toBe(0);
    expect(range.collisionObjects.length).toBe(0);
    expect(range.ground).toBeNull();
    // 场景中不再有靶子网格
    let targetCount = 0;
    scene.traverse((obj) => {
      if (obj.userData[TRAINING_TARGET_FLAG]) targetCount++;
    });
    expect(targetCount).toBe(0);
  });
});
