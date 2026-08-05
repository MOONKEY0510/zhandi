import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BerlinRuins, DEFAULT_MAP_CONFIG } from './BerlinRuins';

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

/** 独立 Mesh（非 InstancedMesh）计数 */
function countStandaloneMeshes(scene: THREE.Scene): number {
  let n = 0;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) n += 1;
  });
  return n;
}

describe('BerlinRuins（阶段 9 P0：地图实例化）', () => {
  it('碎片/废墟/建筑/窗户全部实例化为 InstancedMesh（独立装饰 Mesh 归零）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();

    expect(map.debrisInstances).not.toBeNull();
    expect(map.debrisInstances!.count).toBe(100);
    expect(map.rubbleInstances).not.toBeNull();
    expect(map.rubbleInstances!.count).toBe(DEFAULT_MAP_CONFIG.rubbleCount);
    expect(map.buildingInstances).not.toBeNull();
    expect(map.buildingInstances!.count).toBe(DEFAULT_MAP_CONFIG.buildingCount);
    expect(map.windowInstances).not.toBeNull();
    expect(map.windowInstances!.count).toBe(DEFAULT_MAP_CONFIG.buildingCount * 3);

    // 独立 Mesh 只剩地面 1 + 街道 2 = 3；建筑/窗口/碎片/废墟不再有独立 Mesh
    expect(countStandaloneMeshes(scene)).toBe(3);

    map.dispose();
  });

  it('建筑实例带 per-instance 颜色（还原随机配色）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();
    const instances = map.buildingInstances!;
    const validColors = ['4a4a4a', '3a3a3a', '5a5a5a', '2a2a2a', '6a6a6a'];
    const color = new THREE.Color();
    for (let i = 0; i < instances.count; i++) {
      instances.getColorAt(i, color);
      const hex = color.getHexString();
      expect(validColors).toContain(hex);
    }
    map.dispose();
  });

  it('建筑与废墟实例可被 Raycaster 命中（碰撞保留，world 坐标命中点）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();

    // 废墟第一个实例
    const rubble = map.rubbleInstances!;
    const matrix = new THREE.Matrix4();
    rubble.getMatrixAt(0, matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);

    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(pos.x, pos.y + 10, pos.z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 20;
    const hits = raycaster.intersectObject(rubble, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeGreaterThan(pos.y - 2);
    expect(hits[0].point.y).toBeLessThan(pos.y + 2);

    // 建筑第一个实例（从上方射入必中实心盒）
    const buildings = map.buildingInstances!;
    buildings.getMatrixAt(0, matrix);
    const bpos = new THREE.Vector3().setFromMatrixPosition(matrix);
    const ray2 = new THREE.Raycaster();
    ray2.set(new THREE.Vector3(bpos.x, bpos.y + 50, bpos.z), new THREE.Vector3(0, -1, 0));
    ray2.far = 100;
    const hits2 = ray2.intersectObject(buildings, false);
    expect(hits2.length).toBeGreaterThan(0);

    map.dispose();
  });

  it('collisionObjects 包含建筑与废墟实例（弹道/AI 视线共用碰撞列表）', () => {
    const scene = makeScene();
    const map = new BerlinRuins(scene);
    map.generate();
    expect(map.getCollisionObjects()).toContain(map.rubbleInstances);
    expect(map.getCollisionObjects()).toContain(map.buildingInstances);
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
    expect(map.getCollisionObjects().length).toBe(0);
  });
});
