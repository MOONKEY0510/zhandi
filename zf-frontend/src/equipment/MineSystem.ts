import * as THREE from 'three';
import { TeamId } from '../game/ConquestMode';
import type { Vehicle } from '../vehicle/VehicleSystem';

/**
 * 反坦克地雷（阶段 7 P1）。
 * 玩家按 Q 切换到地雷后放置在脚下；敌方载具进入触发半径即爆炸。
 * 爆炸复用 GameScene.applyExplosion（AoE 伤害 + 四通道冲击 + 特效 + 破坏物联动），
 * 本模块只负责放置、触发检测与回收。
 */

export interface MineTriggerTarget {
  /** 载具中心位置 */ position: THREE.Vector3;
  /** 是否仍可触发（未摧毁） */ alive: boolean;
  /** 阵营：与地雷同阵营不触发 */ team: TeamId;
  /** 触发的载具（供上层在爆炸时使用） */
  vehicle?: Vehicle | null;
}

export interface Mine {
  id: number;
  mesh: THREE.Group;
  position: THREE.Vector3;
  team: TeamId;
  triggered: boolean;
  triggerRadius: number;
  explosionRadius: number;
  damage: number;
  vehicleMultiplier: number;
}

export interface MineSystemOptions {
  /** 每队同时存在的地雷上限 */
  maxPerTeam?: number;
  /** 触发半径（m） */
  triggerRadius?: number;
  /** 爆炸半径（m） */
  explosionRadius?: number;
  /** AoE 基准伤害 */
  damage?: number;
  /** 对载具伤害倍率 */
  vehicleMultiplier?: number;
}

export class MineSystem {
  private scene: THREE.Scene;
  private mines: Mine[] = [];
  private nextId = 1;
  private readonly options: Required<MineSystemOptions>;
  /** 地雷被触发后的回调（GameScene 注入：applyExplosion + 特效 + 移除） */
  onTrigger: ((mine: Mine, target: MineTriggerTarget) => void) | null = null;

  constructor(scene: THREE.Scene, options: MineSystemOptions = {}) {
    this.scene = scene;
    this.options = {
      maxPerTeam: options.maxPerTeam ?? 3,
      triggerRadius: options.triggerRadius ?? 1.8,
      explosionRadius: options.explosionRadius ?? 4.5,
      damage: options.damage ?? 130,
      vehicleMultiplier: options.vehicleMultiplier ?? 3.2,
    };
  }

  /** 当前某队已放置且未触发的地雷数 */
  getActiveCount(team: TeamId): number {
    return this.mines.filter((m) => m.team === team && !m.triggered).length;
  }

  /** 放置地雷：超过每队上限返回 null */
  place(position: THREE.Vector3, team: TeamId): Mine | null {
    if (this.getActiveCount(team) >= this.options.maxPerTeam) return null;

    const mine: Mine = {
      id: this.nextId++,
      mesh: this.createMesh(),
      position: position.clone(),
      team,
      triggered: false,
      triggerRadius: this.options.triggerRadius,
      explosionRadius: this.options.explosionRadius,
      damage: this.options.damage,
      vehicleMultiplier: this.options.vehicleMultiplier,
    };
    mine.mesh.position.copy(mine.position);
    this.mines.push(mine);
    this.scene.add(mine.mesh);
    return mine;
  }

  /** 移除地雷（触发后由回调调用） */
  remove(mine: Mine): void {
    const index = this.mines.indexOf(mine);
    if (index >= 0) {
      this.scene.remove(mine.mesh);
      disposeGroup(mine.mesh);
      this.mines.splice(index, 1);
    }
  }

  /** 每帧触发检测：敌方载具进入触发半径 → 爆炸（回调由 GameScene 提供） */
  update(_deltaTime: number, targets: readonly MineTriggerTarget[]): void {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      if (mine.triggered) continue;
      for (const target of targets) {
        if (!target.alive) continue;
        if (target.team === TeamId.NEUTRAL || target.team === mine.team) continue;
        const dx = target.position.x - mine.position.x;
        const dz = target.position.z - mine.position.z;
        if (Math.sqrt(dx * dx + dz * dz) > mine.triggerRadius) continue;
        mine.triggered = true;
        this.onTrigger?.(mine, target);
        break;
      }
    }
    // 已触发的地雷由 onTrigger 负责 remove；这里兜底清理漏网
    this.mines = this.mines.filter((m) => !m.triggered || this.scene.getObjectById(m.mesh.id));
  }

  getMines(): readonly Mine[] {
    return this.mines;
  }

  dispose(): void {
    for (const mine of this.mines) {
      this.scene.remove(mine.mesh);
      disposeGroup(mine.mesh);
    }
    this.mines = [];
  }

  private createMesh(): THREE.Group {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0x3a3a2a, roughness: 0.8 }),
    );
    disc.castShadow = true;
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0xaa2222, emissive: 0x551111, emissiveIntensity: 0.4 }),
    );
    top.position.y = 0.08;
    group.add(disc, top);
    return group;
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) m.dispose();
    }
  });
}
