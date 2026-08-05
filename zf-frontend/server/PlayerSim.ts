/**
 * 权威玩家移动模拟（阶段 8 P0：安全/一致性）。
 * 服务端以输入驱动位置，速度钳制 + 边界钳制 + 射速裁决 —— 非法输入被服务器修正/忽略。
 */

import {
  PLAYER_WALK_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_MAX_HEALTH,
  PLAYER_PITCH_CLAMP,
  MAP_BOUND,
  SERVER_FIRE_COOLDOWN_MS,
} from '../shared/protocol.ts';

export interface PlayerSimState {
  id: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
  /** 服务端记录的最后一次开火时间（ms，射速裁决） */
  lastFireServerMs: number;
  /** 死亡时刻（ms，重生计时基准；alive 时无意义） */
  deathTimeMs: number;
}

export interface PlayerSimInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  sprint: boolean;
  fire: boolean;
  aimYaw: number;
  aimPitch: number;
}

export interface StepResult {
  /** 本 tick 是否发生有效开火（射速裁决通过） */
  fired: boolean;
  /** 输入是否被修正（超速等异常） */
  corrected: boolean;
}

const PITCH_CLAMP = PLAYER_PITCH_CLAMP;

export class PlayerSim {
  readonly state: PlayerSimState;
  /** 累计超速修正次数（监控/审计用） */
  speedCorrections = 0;

  constructor(id: string, team: 0 | 1, spawn: { x: number; y: number; z: number }) {
    this.state = {
      id,
      team,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: 0,
      pitch: 0,
      health: PLAYER_MAX_HEALTH,
      alive: true,
      lastFireServerMs: Number.NEGATIVE_INFINITY,
      deathTimeMs: 0,
    };
  }

  /** 服务端权威推进：输入 → 位移（带速度上限钳制） */
  step(input: PlayerSimInput, deltaSeconds: number, nowMs: number): StepResult {
    const s = this.state;
    if (!s.alive) return { fired: false, corrected: false };

    let corrected = false;

    // 速度钳制：理论最大速度 = sprint，超过视为异常输入
    const speed = input.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
    let dx = (input.moveRight ? 1 : 0) - (input.moveLeft ? 1 : 0);
    let dz = (input.moveBackward ? 1 : 0) - (input.moveForward ? 1 : 0);
    if (dx !== 0 && dz !== 0) {
      // 斜向移动归一化，避免对角线加速
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dz *= inv;
    }
    // 移动方向以 yaw 为基准旋转（服务端坐标系：z 轴为前）
    const sinYaw = Math.sin(s.yaw);
    const cosYaw = Math.cos(s.yaw);
    const moveX = dx * cosYaw - dz * sinYaw;
    const moveZ = dx * sinYaw + dz * cosYaw;

    const nextX = s.x + moveX * speed * deltaSeconds;
    const nextZ = s.z + moveZ * speed * deltaSeconds;

    // 边界钳制：超界修正（异常移动检测的兜底）
    if (Math.abs(nextX) > MAP_BOUND || Math.abs(nextZ) > MAP_BOUND) {
      s.x = clamp(nextX, -MAP_BOUND, MAP_BOUND);
      s.z = clamp(nextZ, -MAP_BOUND, MAP_BOUND);
      corrected = true;
    } else {
      s.x = nextX;
      s.z = nextZ;
    }

    // 朝向钳制（防 NaN/越界角度）；非法输入记为修正
    if (!Number.isFinite(input.aimYaw) || !Number.isFinite(input.aimPitch) || Math.abs(input.aimPitch) > PITCH_CLAMP) {
      corrected = true;
    }
    s.yaw = clampAngle(input.aimYaw);
    s.pitch = clamp(input.aimPitch, -PITCH_CLAMP, PITCH_CLAMP);

    // 射速裁决：超过冷却的开火才被接受
    let fired = false;
    if (input.fire && nowMs - s.lastFireServerMs >= SERVER_FIRE_COOLDOWN_MS) {
      s.lastFireServerMs = nowMs;
      fired = true;
    } else if (input.fire) {
      corrected = true; // 非法射速（客户端多报）
    }

    if (corrected) this.speedCorrections += 1;
    return { fired, corrected };
  }

  takeDamage(amount: number, nowMs = 0): boolean {
    const s = this.state;
    if (!s.alive) return false;
    s.health = Math.max(0, s.health - amount);
    if (s.health <= 0) {
      s.alive = false;
      s.deathTimeMs = nowMs;
      return true;
    }
    return false;
  }

  respawn(x: number, z: number): void {
    const s = this.state;
    s.x = x;
    s.z = z;
    s.health = PLAYER_MAX_HEALTH;
    s.alive = true;
    s.deathTimeMs = 0;
  }

  toSnapshot(): { id: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; alive: boolean } {
    const s = this.state;
    return { id: s.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, health: s.health, alive: s.alive };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clampAngle(v: number): number {
  if (!Number.isFinite(v)) return 0;
  let a = v % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
