/**
 * 服务端权威局部破坏模拟（阶段 8：破坏状态网络同步）。
 * 与客户端 DestructibleSystem 共用 shared 布局（DESTRUCTIBLE_SPAWN_DEFS/KIND_CONFIGS），
 * 服务端裁决血量与摧毁，弹道命中（挡弹）与状态变化广播均由 ServerApp 驱动。
 * 纯逻辑、无 I/O、可单测。
 */

import {
  DESTRUCTIBLE_KIND_CONFIGS,
  DESTRUCTIBLE_SPAWN_DEFS,
  type DestructibleKindNet,
} from '../shared/protocol.ts';

export interface DestructibleSimObject {
  /** 稳定 ID = DESTRUCTIBLE_SPAWN_DEFS 数组索引（bitset 位序） */
  id: number;
  kind: DestructibleKindNet;
  x: number;
  z: number;
  rotationY: number;
  health: number;
  maxHealth: number;
  destroyed: boolean;
}

/** 弹道挡弹判定用（旋转矩形：局部 x 半宽 / 局部 z 半深 + 垂直范围） */
export interface DestructibleObstacle {
  id: number;
  x: number;
  z: number;
  rotationY: number;
  halfWidth: number;
  halfDepth: number;
  /** 中心高度（地面以上，供弹丸垂直范围判定） */
  centerY: number;
  halfHeight: number;
  destroyed: boolean;
}

export class DestructibleSim {
  private objects: DestructibleSimObject[];

  constructor(defs: readonly { id: number; kind: DestructibleKindNet; x: number; z: number; rotationY: number }[] = DESTRUCTIBLE_SPAWN_DEFS) {
    this.objects = defs.map((d) => {
      const config = DESTRUCTIBLE_KIND_CONFIGS[d.kind];
      return {
        id: d.id,
        kind: d.kind,
        x: d.x,
        z: d.z,
        rotationY: d.rotationY,
        health: config.health,
        maxHealth: config.health,
        destroyed: false,
      };
    });
  }

  get count(): number {
    return this.objects.length;
  }

  getById(id: number): DestructibleSimObject | null {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  getAll(): readonly DestructibleSimObject[] {
    return this.objects;
  }

  /** 受击：返回是否因此被摧毁 */
  damage(id: number, amount: number): boolean {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj || obj.destroyed) return false;
    obj.health = Math.max(0, obj.health - amount);
    if (obj.health <= 0) {
      obj.destroyed = true;
      return true;
    }
    return false;
  }

  /** 破坏状态 → bitset 字符串（'1'=已破坏，位序 = 对象 id） */
  getBitset(): string {
    let bits = '';
    for (const o of this.objects) bits += o.destroyed ? '1' : '0';
    return bits;
  }

  /** 回合重置：全部恢复完整 */
  reset(): void {
    for (const o of this.objects) {
      o.health = o.maxHealth;
      o.destroyed = false;
    }
  }

  /** 弹道挡弹判定列表（含存活对象；已破坏对象不挡弹） */
  obstacles(): DestructibleObstacle[] {
    const list: DestructibleObstacle[] = [];
    for (const o of this.objects) {
      if (o.destroyed) continue;
      const config = DESTRUCTIBLE_KIND_CONFIGS[o.kind];
      const { width, height, depth } = config.dimensions;
      list.push({
        id: o.id,
        x: o.x,
        z: o.z,
        rotationY: o.rotationY,
        // 旋转矩形取局部轴半宽/半深
        halfWidth: width / 2,
        halfDepth: depth / 2,
        centerY: height / 2,
        halfHeight: height / 2,
        destroyed: false,
      });
    }
    return list;
  }
}
