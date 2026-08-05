import { describe, it, expect } from 'vitest';
import { RemotePlayerView, type RemotePose } from './RemotePlayerView.ts';
import type { InterpolatedPlayer } from './SnapshotBuffer.ts';

function pose(id: string, x: number, yaw: number, alive = true): InterpolatedPlayer {
  return { id, x, y: 0, z: 0, yaw, pitch: 0, health: 100, alive, fromTick: 1, toTick: 2 };
}

describe('RemotePlayerView（阶段 8 第九批：远端渲染视图）', () => {
  it('apply 将快照插值结果写入渲染姿势集合', () => {
    const view = new RemotePlayerView();
    const players = new Map<string, InterpolatedPlayer>([
      ['p9', pose('p9', 1.5, 0.2)],
      ['p10', pose('p10', -3, 1.1)],
    ]);
    view.apply(players);
    expect(view.size).toBe(2);
    expect(view.get('p9')).toMatchObject({ x: 1.5, yaw: 0.2, fromTick: 1, toTick: 2 });
  });

  it('apply 覆盖同名玩家的最新姿势', () => {
    const view = new RemotePlayerView();
    view.apply(new Map([['p9', pose('p9', 1, 0)]]));
    view.apply(new Map([['p9', pose('p9', 5, 0.9)]]));
    const p = view.get('p9')!;
    expect(p.x).toBe(5);
    expect(p.yaw).toBe(0.9);
    expect(view.size).toBe(1);
  });

  it('apply 移除快照中消失的玩家（离开/被服务端移除）', () => {
    const view = new RemotePlayerView();
    view.apply(new Map([['p9', pose('p9', 1, 0)], ['p10', pose('p10', 2, 0)]]));
    view.apply(new Map([['p9', pose('p9', 3, 0)]]));
    expect(view.size).toBe(1);
    expect(view.get('p10')).toBeUndefined();
  });

  it('remove 显式移除单个玩家（player_leave 立即消失）', () => {
    const view = new RemotePlayerView();
    view.apply(new Map([['p9', pose('p9', 1, 0)]]));
    view.remove('p9');
    expect(view.size).toBe(0);
  });

  it('clear 清空全部姿势', () => {
    const view = new RemotePlayerView();
    view.apply(new Map([['p9', pose('p9', 1, 0)], ['p10', pose('p10', 2, 0)]]));
    view.clear();
    expect(view.size).toBe(0);
    expect(view.getPoses().size).toBe(0);
  });

  it('保留死亡/外推标记供渲染层使用', () => {
    const view = new RemotePlayerView();
    const dead: InterpolatedPlayer = { ...pose('p9', 1, 0, false), health: 0, extrapolated: true };
    view.apply(new Map([['p9', dead]]));
    const p = view.get('p9') as RemotePose;
    expect(p.alive).toBe(false);
    expect(p.health).toBe(0);
    expect(p.extrapolated).toBe(true);
  });
});
