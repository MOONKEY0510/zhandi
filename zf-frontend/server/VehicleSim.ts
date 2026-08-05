/**
 * 服务端权威载具模拟（阶段 8：游戏内容权威化第二步）。
 * 纯逻辑运动学模型（无物理引擎，与 PlayerSim 同风格）：
 *   - 载具由 shared 权威 VEHICLE_SPAWN_DEFS 同源布局生成；
 *   - drive(forward, turn)：速度向目标速度逼近（加速度钳制）、按 turnSpeed 转向、解析积分；
 *   - enter/exit：司机位占用（enter 校验玩家距离）；
 *   - takeDamage：血量扣减 → 摧毁 → 重生计时 → 复位（位置/血量/清空司机）。
 * 纯逻辑、无 I/O，可单测；ServerApp 每 tick 推进并随快照周期广播 vehicle_state。
 */

import {
  MAP_BOUND,
  VEHICLE_SPAWN_DEFS,
  VEHICLE_SIM_CONFIGS,
  type VehicleSpawnDef,
  type VehicleStateMsg,
  type VehicleTypeNet,
} from '../shared/protocol.ts';

export const VEHICLE_RESPAWN_DELAY_SECONDS = 15;

/** 空车惯性衰减系数（每秒速度保留比例，趋向静止） */
const IDLE_DECAY_PER_SECOND = 0.5;

interface SimVehicle {
  id: string;
  type: VehicleTypeNet;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  health: number;
  team: VehicleStateMsg['vehicles'][number]['team'];
  destroyed: boolean;
  respawnTimer: number;
  driverId: string | null;
  /** 每武器上次开火时间（ms），冷却裁决用 */
  lastFireAt: number[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 载具开火结果：发射参数（ServerApp 据此生成弹丸）或 null（被裁决拒绝） */
export interface VehicleFireResult {
  damage: number;
  speedMps: number;
  maxRange: number;
  lifeMs: number;
  /** 弹丸起点（载具位置 + 炮口高度） */
  x: number;
  y: number;
  z: number;
}

export class VehicleSim {
  readonly respawnDelaySeconds = VEHICLE_RESPAWN_DELAY_SECONDS;
  private vehicles: SimVehicle[];

  constructor(defs: readonly VehicleSpawnDef[] = VEHICLE_SPAWN_DEFS) {
    this.vehicles = defs.map((d) => ({
      id: d.id,
      type: d.type,
      x: d.x,
      z: d.z,
      yaw: 0,
      speed: 0,
      health: VEHICLE_SIM_CONFIGS[d.type].health,
      team: d.team,
      destroyed: false,
      respawnTimer: 0,
      driverId: null,
      lastFireAt: VEHICLE_SIM_CONFIGS[d.type].weapons.map(() => Number.NEGATIVE_INFINITY),
    }));
  }

  getVehicle(vehicleId: string): SimVehicle | null {
    return this.vehicles.find((v) => v.id === vehicleId) ?? null;
  }

  /** 某玩家当前驾驶的载具 */
  getVehicleByDriver(playerId: string): SimVehicle | null {
    return this.vehicles.find((v) => v.driverId === playerId) ?? null;
  }

  /** 司机驾驶输入：速度逼近（加速度钳制）+ 转向 + 解析积分（与服务端坐标系一致：z 负为前） */
  drive(vehicleId: string, forward: number, turn: number, deltaSeconds: number): void {
    const v = this.getVehicle(vehicleId);
    if (!v || v.destroyed || !v.driverId || deltaSeconds <= 0) return;

    const cfg = VEHICLE_SIM_CONFIGS[v.type];
    const targetSpeed = clamp(forward, -1, 1) * cfg.maxSpeed;
    const maxDelta = cfg.acceleration * deltaSeconds;
    v.speed += clamp(targetSpeed - v.speed, -maxDelta, maxDelta);

    v.yaw += clamp(turn, -1, 1) * cfg.turnSpeed * deltaSeconds;

    const fx = Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    const nextX = v.x + fx * v.speed * deltaSeconds;
    const nextZ = v.z + fz * v.speed * deltaSeconds;
    if (Math.abs(nextX) > MAP_BOUND || Math.abs(nextZ) > MAP_BOUND) {
      v.x = clamp(nextX, -MAP_BOUND, MAP_BOUND);
      v.z = clamp(nextZ, -MAP_BOUND, MAP_BOUND);
      v.speed = 0; // 撞界即停（简化碰撞）
    } else {
      v.x = nextX;
      v.z = nextZ;
    }
  }

  /** 每 tick：无司机惯性减速 + 摧毁载具重生计时 */
  update(deltaSeconds: number): void {
    for (const v of this.vehicles) {
      if (v.destroyed) {
        v.respawnTimer -= deltaSeconds;
        if (v.respawnTimer <= 0) this.respawn(v);
        continue;
      }
      if (!v.driverId) {
        // 空车无驱动：速度指数衰减
        v.speed *= Math.pow(IDLE_DECAY_PER_SECOND, deltaSeconds);
        if (Math.abs(v.speed) < 0.05) v.speed = 0;
      }
    }
  }

  /** 上车：玩家必须在载具半径内且司机位空闲（未摧毁） */
  enter(vehicleId: string, playerId: string, playerX: number, playerZ: number, radius = 8): boolean {
    const v = this.getVehicle(vehicleId);
    if (!v || v.destroyed || v.driverId !== null) return false;
    if (v.driverId === playerId) return true;
    const dist = Math.hypot(v.x - playerX, v.z - playerZ);
    if (dist > radius) return false;
    v.driverId = playerId;
    return true;
  }

  /** 下车：清空司机位（位置同步由接入层处理） */
  exit(playerId: string): boolean {
    const v = this.getVehicleByDriver(playerId);
    if (!v) return false;
    v.driverId = null;
    return true;
  }

  /** 受击：扣血 → 摧毁（清空司机 + 开始重生计时）；返回是否摧毁 */
  takeDamage(vehicleId: string, amount: number): boolean {
    const v = this.getVehicle(vehicleId);
    if (!v || v.destroyed) return false;
    v.health = Math.max(0, v.health - amount);
    if (v.health <= 0) {
      v.health = 0;
      v.destroyed = true;
      v.respawnTimer = this.respawnDelaySeconds;
      v.driverId = null;
      v.speed = 0;
      return true;
    }
    return false;
  }

  /**
   * 载具开火（仅司机；服务端裁决武器存在/冷却 → 返回弹丸发射参数）。
   * 弹道方向由客户端 aimYaw/aimPitch 决定（世界坐标系，与玩家弹丸一致）。
   */
  fire(
    vehicleId: string,
    playerId: string,
    aimYaw: number,
    aimPitch: number,
    nowMs: number,
    weaponIndex = 0,
  ): VehicleFireResult | null {
    const v = this.getVehicle(vehicleId);
    if (!v || v.destroyed || v.driverId !== playerId) return null;
    const weapons = VEHICLE_SIM_CONFIGS[v.type].weapons;
    const weapon = weapons[weaponIndex];
    if (!weapon) return null;
    const last = v.lastFireAt[weaponIndex] ?? Number.NEGATIVE_INFINITY;
    if (nowMs - last < weapon.cooldownMs) return null;

    v.lastFireAt[weaponIndex] = nowMs;
    // 炮口高度：按车体中心略上（弹道圆柱判定对载具高度敏感度低于玩家）
    return {
      damage: weapon.damage,
      speedMps: weapon.speedMps,
      maxRange: weapon.maxRange,
      lifeMs: weapon.lifeMs,
      x: v.x,
      y: 0.8,
      z: v.z,
    };
  }

  /** 载具列表（ServerApp 组装弹道目标与命中裁决用） */
  list(): ReadonlyArray<{
    id: string;
    type: VehicleTypeNet;
    x: number;
    z: number;
    health: number;
    team: SimVehicle['team'];
    destroyed: boolean;
    driverId: string | null;
    hitRadius: number;
  }> {
    return this.vehicles.map((v) => ({
      id: v.id,
      type: v.type,
      x: v.x,
      z: v.z,
      health: v.health,
      team: v.team,
      destroyed: v.destroyed,
      driverId: v.driverId,
      hitRadius: VEHICLE_SIM_CONFIGS[v.type].hitRadius,
    }));
  }

  private respawn(v: SimVehicle): void {
    const def = VEHICLE_SPAWN_DEFS.find((d) => d.id === v.id);
    v.destroyed = false;
    v.health = VEHICLE_SIM_CONFIGS[v.type].health;
    v.x = def?.x ?? 0;
    v.z = def?.z ?? 0;
    v.yaw = 0;
    v.speed = 0;
    v.respawnTimer = 0;
    v.driverId = null;
    v.lastFireAt = VEHICLE_SIM_CONFIGS[v.type].weapons.map(() => Number.NEGATIVE_INFINITY);
  }

  getState(tick: number, roomId: string): VehicleStateMsg {
    return {
      kind: 'vehicle_state',
      roomId,
      tick,
      vehicles: this.vehicles.map((v) => ({
        id: v.id,
        type: v.type,
        x: v.x,
        z: v.z,
        yaw: v.yaw,
        health: v.health,
        maxHealth: VEHICLE_SIM_CONFIGS[v.type].health,
        team: v.team,
        destroyed: v.destroyed,
        respawnIn: v.destroyed ? Math.max(0, Math.ceil(v.respawnTimer)) : 0,
        driverId: v.driverId,
      })),
    };
  }
}
