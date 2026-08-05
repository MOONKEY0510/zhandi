import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BerlinRuins, DEFAULT_MAP_CONFIG } from './BerlinRuins';

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

describe('BerlinRuins（阶段 9 P0：地图装饰物实例化）', () => {
  it('碎片与废墟实例化为 InstancedMesh（独立装饰 Mesh 归零）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();

    expect(map.debrisInstances).not.toBeNull();
    expect(map.debrisInstances!.count).toBe(100);
    expect(map.rubbleInstances).not.toBeNull();
    expect(map.rubbleInstances!.count).toBe(DEFAULT_MAP_CONFIG.rubbleCount);

    // 独立 Mesh 数：地面 1 + 街道 2 + 建筑 20 + 建筑窗口 60 = 83；碎片/废墟不再有独立 Mesh
    let standaloneMeshes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) standaloneMeshes += 1;
    });
    expect(standaloneMeshes).toBe(83);

    map.dispose();
  });

  it('废墟实例可被 Raycaster 命中（碰撞保留，world 坐标命中点）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();
    const instances = map.rubbleInstances!;

    // 取第一个实例的世界位置
    const matrix = new THREE.Matrix4();
    instances.getMatrixAt(0, matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);

    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(pos.x, pos.y + 10, pos.z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 20;
    const hits = raycaster.intersectObject(instances, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeGreaterThan(pos.y - 2);
    expect(hits[0].point.y).toBeLessThan(pos.y + 2);

    map.dispose();
  });

  it('collisionObjects 包含废墟实例（弹道/AI 视线共用碰撞列表）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();
    expect(map.getCollisionObjects()).toContain(map.rubbleInstances);
    map.dispose();
  });

  it('dispose 移除全部 InstancedMesh', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();
    map.dispose();

    let instances = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) instances += 1;
    });
    expect(instances).toBe(0);
  });
});
