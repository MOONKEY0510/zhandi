/**
 * 联网载具视觉管理器单测（阶段 8 第十五批）。
 * 纯 Three.js 场景（无 Rapier 依赖）：验证 vehicle_state 广播 → 创建/更新/移除视觉、
 * 平滑插值、交互查询（findNear/getByDriver）、归属/摧毁变色。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NetworkVehicles } from './NetworkVehicles.ts';
import type { VehicleStateMsg } from '../../shared/protocol.ts';

function state(vehicles: VehicleStateMsg['vehicles']): VehicleStateMsg {
  return { kind: 'vehicle_state', roomId: 'r1', tick: 1, vehicles };
}

describe('NetworkVehicles（阶段 8 第十五批：联网载具视觉）', () => {
  it('applyState 按广播创建视觉（车身 + 轮子 + 顶置武器）', () => {
    const scene = new THREE.Scene();
    const nv = new NetworkVehicles(scene);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 10, z: -5, yaw: 0.5, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    expect(nv.count).toBe(1);
    const v = nv.getById('v1')!;
    expect(v.mesh.position.x).toBe(10);
    expect(v.mesh.position.z).toBe(-5);
    expect(v.mesh.children.length).toBeGreaterThan(3); // 车身 + 轮子 + 武器
    nv.clear();
  });

  it('update 平滑插值向服务端目标收敛（15Hz 广播 → 60fps 渲染）', () => {
    const scene = new THREE.Scene();
    const nv = new NetworkVehicles(scene);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    // 服务端新位置 (10, 10)
    nv.applyState(state([
      { id: 'v1', type: 0, x: 10, z: 10, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    nv.update(1 / 60);
    const v = nv.getById('v1')!;
    expect(v.mesh.position.x).toBeGreaterThan(0);
    expect(v.mesh.position.x).toBeLessThan(10);
    // 多帧收敛到目标
    for (let i = 0; i < 120; i += 1) nv.update(1 / 60);
    expect(v.mesh.position.x).toBeCloseTo(10, 1);
    expect(v.mesh.position.z).toBeCloseTo(10, 1);
    nv.clear();
  });

  it('广播移除消失的载具（applyState 差集清理）', () => {
    const scene = new THREE.Scene();
    const nv = new NetworkVehicles(scene);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
      { id: 'v2', type: 1, x: 5, z: 5, yaw: 0, health: 500, maxHealth: 500, team: 1, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    expect(nv.count).toBe(2);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    expect(nv.count).toBe(1);
    expect(nv.getById('v2')).toBeNull();
    nv.clear();
  });

  it('findNear 只返回未摧毁载具；getByDriver 匹配司机', () => {
    const scene = new THREE.Scene();
    const nv = new NetworkVehicles(scene);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
      { id: 'v2', type: 1, x: 20, z: 20, yaw: 0, health: 500, maxHealth: 500, team: 1, destroyed: true, respawnIn: 5, driverId: null },
    ]));
    expect(nv.findNear(1, 1, 4)).toBe('v1');
    expect(nv.findNear(1, 1, 4)).not.toBe('v2'); // 摧毁的不可上
    expect(nv.findNear(30, 30, 4)).toBeNull(); // 距离外
    // v2 被司机 p9 占用
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
      { id: 'v2', type: 1, x: 20, z: 20, yaw: 0, health: 500, maxHealth: 500, team: 1, destroyed: false, respawnIn: 0, driverId: 'p9' },
    ]));
    expect(nv.getByDriver('p9')?.id).toBe('v2');
    expect(nv.getByDriver('nobody')).toBeNull();
    nv.clear();
  });

  it('归属色随 team 变化；摧毁后车身变暗', () => {
    const scene = new THREE.Scene();
    const nv = new NetworkVehicles(scene);
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    const v = nv.getById('v1')!;
    const bodyMat = v.mesh.children[0] as THREE.Mesh;
    const mat = bodyMat.material as THREE.MeshStandardMaterial;
    const team0Color = mat.color.getHex();
    expect(team0Color).not.toBe(0x888888); // 非中立灰
    // 归属切到队 1（蓝）
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 200, maxHealth: 200, team: 1, destroyed: false, respawnIn: 0, driverId: null },
    ]));
    expect(mat.color.getHex()).not.toBe(team0Color);
    // 摧毁 → 变暗
    nv.applyState(state([
      { id: 'v1', type: 0, x: 0, z: 0, yaw: 0, health: 0, maxHealth: 200, team: 1, destroyed: true, respawnIn: 10, driverId: null },
    ]));
    expect(mat.color.getHex()).toBe(0x333333);
    nv.clear();
  });
});
