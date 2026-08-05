/**
 * 联网载具视觉管理器（阶段 8 第十五批）。
 * 服务端权威载具（VehicleSim）的位置/生命/归属经 vehicle_state（15Hz）广播，
 * 本类只做纯视觉：按广播创建/更新/移除载具 mesh，并做平滑插值（15Hz → 60fps 渲染）。
 * 不跑本地物理模拟（客户端无载具权威）；单机模式仍使用 VehicleSystem（Rapier 物理）。
 */

import * as THREE from 'three';
import type { VehicleStateMsg, VehicleStateEntry, VehicleTypeNet } from '../../shared/protocol';
import { VEHICLE_CONFIGS, VehicleType } from './VehicleSystem';

/** 网络类型编号 → 本地 VehicleType（0=jeep 1=tank 2=truck 3=motorcycle，与协议对齐） */
const NET_TO_LOCAL: VehicleType[] = [
  VehicleType.JEEP,
  VehicleType.TANK,
  VehicleType.TRUCK,
  VehicleType.MOTORCYCLE,
];

/** 归属色：0=红(AXIS) 1=蓝(ALLIES) 2=灰(中立)，与据点视觉色系一致 */
const TEAM_COLORS = [0x8b1a1a, 0x1a3a8b, 0x888888] as const;
const DESTROYED_COLOR = 0x333333;

/** 插值收敛系数：每帧向目标位置/朝向收敛的比例（15Hz 广播 → 平滑跟随） */
const LERP_GAIN = 10;

interface NetVehicle {
  id: string;
  type: VehicleTypeNet;
  mesh: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  driverId: string | null;
  destroyed: boolean;
  team: 0 | 1 | 2;
  health: number;
  maxHealth: number;
  /** 服务端目标状态 */
  tx: number;
  tz: number;
  tyaw: number;
  /** 渲染当前状态 */
  x: number;
  z: number;
  yaw: number;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class NetworkVehicles {
  private readonly scene: THREE.Scene;
  private readonly vehicles = new Map<string, NetVehicle>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 应用一帧服务端载具广播：创建缺失 / 更新目标 / 移除已消失 */
  applyState(state: VehicleStateMsg): void {
    const seen = new Set<string>();
    for (const entry of state.vehicles) {
      seen.add(entry.id);
      let v = this.vehicles.get(entry.id);
      if (!v) {
        v = this.createVisual(entry);
        this.vehicles.set(entry.id, v);
        this.scene.add(v.mesh);
      }
      this.updateTarget(v, entry);
    }
    // 移除广播中不存在的载具
    for (const [id, v] of this.vehicles) {
      if (!seen.has(id)) {
        this.scene.remove(v.mesh);
        this.vehicles.delete(id);
      }
    }
  }

  /** 每帧平滑插值到服务端目标（渲染层调用） */
  update(dt: number): void {
    const k = 1 - Math.exp(-LERP_GAIN * dt);
    for (const v of this.vehicles.values()) {
      v.x += (v.tx - v.x) * k;
      v.z += (v.tz - v.z) * k;
      v.yaw += normalizeAngle(v.tyaw - v.yaw) * k;
      v.mesh.position.set(v.x, 0.6, v.z);
      v.mesh.rotation.y = v.yaw;
    }
  }

  /** 按 id 查询（交互/驾驶用） */
  getById(id: string): { id: string; mesh: THREE.Group; destroyed: boolean; driverId: string | null } | null {
    const v = this.vehicles.get(id);
    if (!v) return null;
    return { id: v.id, mesh: v.mesh, destroyed: v.destroyed, driverId: v.driverId };
  }

  /** 查找 (x,z) 半径内的可用（未摧毁）载具 */
  findNear(x: number, z: number, radius: number): string | null {
    let best: NetVehicle | null = null;
    let bestDist = radius;
    for (const v of this.vehicles.values()) {
      if (v.destroyed) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d <= bestDist) {
        best = v;
        bestDist = d;
      }
    }
    return best ? best.id : null;
  }

  /** 本人驾驶的载具（driverId 匹配） */
  getByDriver(driverId: string): { id: string; mesh: THREE.Group; destroyed: boolean } | null {
    for (const v of this.vehicles.values()) {
      if (v.driverId === driverId) {
        return { id: v.id, mesh: v.mesh, destroyed: v.destroyed };
      }
    }
    return null;
  }

  /** 断线/退出对局时清空全部视觉 */
  clear(): void {
    for (const v of this.vehicles.values()) this.scene.remove(v.mesh);
    this.vehicles.clear();
  }

  get count(): number {
    return this.vehicles.size;
  }

  // ===== 内部 =====

  private createVisual(entry: VehicleStateEntry): NetVehicle {
    const group = this.buildMesh(entry.type);
    group.position.set(entry.x, 0.6, entry.z);
    group.rotation.y = entry.yaw;
    const bodyMat = group.userData.bodyMat as THREE.MeshStandardMaterial;
    // 首次创建即按归属/摧毁状态上色（updateTarget 只在变化时改色）
    bodyMat.color.setHex(entry.destroyed ? DESTROYED_COLOR : TEAM_COLORS[entry.team] ?? TEAM_COLORS[2]);
    return {
      id: entry.id,
      type: entry.type,
      mesh: group,
      bodyMat,
      driverId: entry.driverId,
      destroyed: entry.destroyed,
      team: entry.team,
      health: entry.health,
      maxHealth: entry.maxHealth,
      tx: entry.x,
      tz: entry.z,
      tyaw: entry.yaw,
      x: entry.x,
      z: entry.z,
      yaw: entry.yaw,
    };
  }

  private updateTarget(v: NetVehicle, entry: VehicleStateEntry): void {
    v.tx = entry.x;
    v.tz = entry.z;
    v.tyaw = entry.yaw;
    v.driverId = entry.driverId;
    v.health = entry.health;
    v.maxHealth = entry.maxHealth;
    if (v.destroyed !== entry.destroyed || v.team !== entry.team) {
      v.destroyed = entry.destroyed;
      v.team = entry.team;
      const base = v.destroyed ? DESTROYED_COLOR : TEAM_COLORS[v.team] ?? TEAM_COLORS[2];
      v.bodyMat.color.setHex(base);
    }
  }

  private buildMesh(type: VehicleTypeNet): THREE.Group {
    const cfg = VEHICLE_CONFIGS[NET_TO_LOCAL[type] ?? VehicleType.JEEP];
    const group = new THREE.Group();
    const w = cfg.dimensions.width;
    const h = cfg.dimensions.height;
    const l = cfg.dimensions.length;

    // 车身（归属色由 updateTarget 设置）
    const bodyMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[2] });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, l), bodyMat);
    body.position.y = h * 0.35;
    group.add(body);
    group.userData.bodyMat = bodyMat;

    // 顶置武器：坦克主炮塔 + 炮管；其余机枪座
    const turretMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
    if (type === 1) {
      const turret = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.35, l * 0.45), turretMat);
      turret.position.y = h * 0.7;
      group.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, l * 0.85, 8), turretMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, h * 0.7, l * 0.55);
      group.add(barrel);
    } else {
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), turretMat);
      mount.position.y = h * 0.8;
      group.add(mount);
    }

    // 轮子（简化：四角圆柱）
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10);
    const corners: [number, number][] = [
      [-w / 2 + 0.35, -l / 2 + 0.45],
      [w / 2 - 0.35, -l / 2 + 0.45],
      [-w / 2 + 0.35, l / 2 - 0.45],
      [w / 2 - 0.35, l / 2 - 0.45],
    ];
    for (const [wx, wz] of corners) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.35, wz);
      group.add(wheel);
    }
    return group;
  }
}
