/**
 * 服务端弹道与命中裁决（阶段 8 P0：安全/一致性）。
 * 玩家开火 → 服务器创建弹丸（方向由 yaw/pitch 计算，与服务端坐标系一致），
 * 每 tick 直线推进，对活着的敌方目标做圆柱相交判定（水平距离 + 垂直范围）；
 * 命中/射程/寿命均由服务器裁决 —— 客户端无法伪造击杀。
 * 纯逻辑、可单测。
 */

import {
  BULLET_DAMAGE,
  BULLET_HEIGHT_HALF,
  BULLET_HIT_RADIUS,
  BULLET_LIFE_MS,
  BULLET_MAX_RANGE,
  BULLET_SPEED_MPS,
} from '../shared/protocol.ts';

export interface ProjectileTarget {
  id: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  /** 命中判定半径 m（默认 BULLET_HIT_RADIUS；载具等大型目标用更大的半径） */
  radius?: number;
}

export interface ServerProjectile {
  id: number;
  ownerId: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  /** 武器显示名（击杀事件用：步枪/机枪/主炮） */
  label: string;
  traveled: number;
  maxRange: number;
  lifeMs: number;
}

export interface ProjectileHit {
  projectileId: number;
  ownerId: string;
  targetId: string;
  damage: number;
  /** 武器显示名（击杀事件用） */
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface ProjectileSimStats {
  spawned: number;
  hits: number;
  expired: number;
}

export interface SpawnProjectileInput {
  ownerId: string;
  team: 0 | 1;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speedMps?: number;
  damage?: number;
  maxRange?: number;
  lifeMs?: number;
  /** 武器显示名（击杀事件用，默认「步枪」） */
  label?: string;
}

export class ProjectileSim {
  private projectiles: ServerProjectile[] = [];
  private nextId = 0;
  readonly stats: ProjectileSimStats = { spawned: 0, hits: 0, expired: 0 };

  /** 创建弹丸（方向 = yaw 水平旋转 + pitch 俯仰，世界前方向为 sin(yaw), -cos(yaw)） */
  spawn(input: SpawnProjectileInput): ServerProjectile {
    const speed = input.speedMps ?? BULLET_SPEED_MPS;
    const cosPitch = Math.cos(input.pitch);
    const projectile: ServerProjectile = {
      id: this.nextId++,
      ownerId: input.ownerId,
      team: input.team,
      x: input.x,
      y: input.y,
      z: input.z,
      vx: Math.sin(input.yaw) * cosPitch * speed,
      vy: Math.sin(input.pitch) * speed,
      vz: -Math.cos(input.yaw) * cosPitch * speed,
      damage: input.damage ?? BULLET_DAMAGE,
      label: input.label ?? '步枪',
      traveled: 0,
      maxRange: input.maxRange ?? BULLET_MAX_RANGE,
      lifeMs: input.lifeMs ?? BULLET_LIFE_MS,
    };
    this.projectiles.push(projectile);
    this.stats.spawned += 1;
    return projectile;
  }

  /** 每 tick 推进：子步进直线弹道（防隧穿）→ 寿命/射程到期 → 命中裁决（一弹最多命中一个目标） */
  step(deltaSeconds: number, targets: ProjectileTarget[], onHit?: (hit: ProjectileHit) => void): ProjectileHit[] {
    const hits: ProjectileHit[] = [];
    const consumed = new Set<number>();
    for (const p of this.projectiles) {
      if (consumed.has(p.id)) continue;

      p.lifeMs -= deltaSeconds * 1000;
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const stepLen = speed * deltaSeconds;

      // 子步进：子步长 ≤ 命中半径一半，保证弹道不会跳过目标带
      const subSteps = Math.max(1, Math.ceil(stepLen / (BULLET_HIT_RADIUS * 0.5)));
      const subLen = stepLen / subSteps;
      const nx = p.vx / speed;
      const ny = p.vy / speed;
      const nz = p.vz / speed;

      let hit: ProjectileHit | null = null;
      for (let s = 0; s < subSteps && !hit; s++) {
        // 射程精确钳制：剩余距离不足一个子步长时直接置满（避免浮点累计差 1 ulp）
        const remaining = p.maxRange - p.traveled;
        if (remaining <= 1e-9) {
          p.traveled = p.maxRange;
          break;
        }
        const move = Math.min(subLen, remaining);
        p.x += nx * move;
        p.y += ny * move;
        p.z += nz * move;
        p.traveled += move;

        // 命中判定：活着的敌方目标，水平距离 ≤ 命中半径 且 垂直偏差 ≤ 半高
        for (const t of targets) {
          if (t.id === p.ownerId || t.team === p.team || !t.alive) continue;
          const hitRadius = t.radius ?? BULLET_HIT_RADIUS;
          if (Math.hypot(p.x - t.x, p.z - t.z) <= hitRadius && Math.abs(p.y - t.y) <= BULLET_HEIGHT_HALF) {
            hit = {
              projectileId: p.id,
              ownerId: p.ownerId,
              targetId: t.id,
              damage: p.damage,
              label: p.label,
              x: p.x,
              y: p.y,
              z: p.z,
            };
            break;
          }
        }
      }

      if (hit) {
        hits.push(hit);
        this.stats.hits += 1;
        consumed.add(p.id);
        onHit?.(hit);
      } else if (p.lifeMs <= 0 || p.traveled >= p.maxRange - 1e-6) {
        // 浮点累计差 ≤ 1e-6 视为已到射程
        this.stats.expired += 1;
        consumed.add(p.id);
      }
    }
    if (consumed.size > 0) {
      this.projectiles = this.projectiles.filter((p) => !consumed.has(p.id));
    }
    return hits;
  }

  get count(): number {
    return this.projectiles.length;
  }

  clear(): void {
    this.projectiles = [];
  }
}
