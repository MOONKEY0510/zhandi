/**
 * Interest Management（阶段 8 P0：按距离/数量裁剪快照实体）。
 * 纯函数：给定观察者与完整玩家列表，返回该观察者应收到的快照子集。
 * 规则：
 *  - 观察者本人始终可见（本地预测校正需要自己的权威位置）；
 *  - 视野半径内按距离升序，最多 maxEntities 个（半径内超出则取最近）；
 *  - 排序稳定，避免同一玩家在相邻快照间的集合抖动。
 */

import type { SnapshotPlayer } from './protocol.ts';

export interface InterestOptions {
  /** 视野半径（米），半径外的远端实体不进快照 */
  viewRadius?: number;
  /** 单份快照最多实体数（含观察者本人） */
  maxEntities?: number;
}

export interface InterestInput {
  observerId: string;
  observerX: number;
  observerZ: number;
  players: SnapshotPlayer[];
}

export const INTEREST_VIEW_RADIUS = 120 as const;
export const INTEREST_MAX_ENTITIES = 24 as const;

/** 水平距离（米） */
export function horizontalDistance(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x2 - x1, z2 - z1);
}

export function computeVisiblePlayers(input: InterestInput, options: InterestOptions = {}): SnapshotPlayer[] {
  const viewRadius = options.viewRadius ?? INTEREST_VIEW_RADIUS;
  const maxEntities = options.maxEntities ?? INTEREST_MAX_ENTITIES;

  let self: SnapshotPlayer | null = null;
  const others: { player: SnapshotPlayer; dist: number }[] = [];

  for (const p of input.players) {
    if (p.id === input.observerId) {
      self = p;
      continue;
    }
    const dist = horizontalDistance(input.observerX, input.observerZ, p.x, p.z);
    if (dist <= viewRadius) {
      others.push({ player: p, dist });
    }
  }

  // 距离升序，稳定排序（保持原始列表相对顺序）
  others.sort((a, b) => a.dist - b.dist);

  const result: SnapshotPlayer[] = [];
  if (self) result.push(self);
  for (const { player } of others) {
    if (result.length >= maxEntities) break;
    result.push(player);
  }
  return result;
}
