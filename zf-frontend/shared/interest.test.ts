import { describe, it, expect } from 'vitest';
import {
  computeVisiblePlayers,
  horizontalDistance,
  INTEREST_VIEW_RADIUS,
  INTEREST_MAX_ENTITIES,
} from './interest.ts';
import type { SnapshotPlayer } from './protocol.ts';

function player(id: string, x: number, z: number): SnapshotPlayer {
  return { id, x, y: 0, z, yaw: 0, pitch: 0, health: 100, alive: true };
}

describe('interest（阶段 8 Interest Management）', () => {
  it('半径内实体可见，半径外裁剪', () => {
    const players = [
      player('me', 0, 0),
      player('near', 10, 0),
      player('far', 200, 0),
      player('edge', 120, 0), // 半径边界内
    ];
    const visible = computeVisiblePlayers({ observerId: 'me', observerX: 0, observerZ: 0, players });
    const ids = visible.map((p) => p.id);
    expect(ids).toContain('me');
    expect(ids).toContain('near');
    expect(ids).toContain('edge');
    expect(ids).not.toContain('far');
  });

  it('观察者本人始终可见（即使超半径/不在玩家列表则忽略）', () => {
    const players = [player('me', 300, 300), player('other', 310, 300)];
    const visible = computeVisiblePlayers({ observerId: 'me', observerX: 300, observerZ: 300, players });
    expect(visible.map((p) => p.id)).toEqual(['me', 'other']);
    // 观察者不在列表中：不虚构
    const none = computeVisiblePlayers({ observerId: 'ghost', observerX: 0, observerZ: 0, players });
    expect(none.some((p) => p.id === 'ghost')).toBe(false);
  });

  it('maxEntities 截断：半径内超限时取最近', () => {
    const players = [
      player('me', 0, 0),
      player('d1', 1, 0),
      player('d2', 2, 0),
      player('d3', 3, 0),
      player('d4', 4, 0),
    ];
    const visible = computeVisiblePlayers(
      { observerId: 'me', observerX: 0, observerZ: 0, players },
      { maxEntities: 3 },
    );
    expect(visible.map((p) => p.id)).toEqual(['me', 'd1', 'd2']);
  });

  it('按距离升序排列（稳定排序）', () => {
    const players = [player('me', 0, 0), player('b', 30, 0), player('a', 10, 0), player('c', 20, 0)];
    const visible = computeVisiblePlayers({ observerId: 'me', observerX: 0, observerZ: 0, players });
    expect(visible.map((p) => p.id)).toEqual(['me', 'a', 'c', 'b']);
  });

  it('水平距离计算正确', () => {
    expect(horizontalDistance(0, 0, 3, 4)).toBeCloseTo(5, 10);
    expect(horizontalDistance(10, 10, 10, 10)).toBe(0);
  });

  it('默认参数导出可用（常量配置）', () => {
    expect(INTEREST_VIEW_RADIUS).toBe(120);
    expect(INTEREST_MAX_ENTITIES).toBe(24);
    // 空列表
    expect(computeVisiblePlayers({ observerId: 'me', observerX: 0, observerZ: 0, players: [] })).toEqual([]);
  });
});
