import { describe, it, expect } from 'vitest';
import { ConquestSim, CONQUEST_DEFAULTS } from './ConquestSim.ts';
import type { ConquestPlayerRef } from './ConquestSim.ts';

function player(id: string, team: 0 | 1, x: number, z: number, alive = true): ConquestPlayerRef {
  return { id, team, x, z, alive };
}

describe('ConquestSim（阶段 8 服务端权威征服规则）', () => {
  it('初始状态：双方满兵力、据点中立、无胜者', () => {
    const sim = new ConquestSim();
    expect(sim.tickets).toEqual([CONQUEST_DEFAULTS.maxTickets, CONQUEST_DEFAULTS.maxTickets]);
    expect(sim.kills).toEqual([0, 0]);
    expect(sim.objectives).toHaveLength(3);
    for (const o of sim.objectives) {
      expect(o.owner).toBe(2);
      expect(o.progress).toBe(0);
    }
    expect(sim.winner).toBeNull();
  });

  it('队 0 玩家进入据点 → 捕获进度上升 → 归属翻转为队 0', () => {
    const sim = new ConquestSim({ captureRadius: 8, captureSpeed: 15 });
    const alpha = sim.objectives.find((o) => o.id === 'alpha')!;
    // alpha 位于 (15, 15)：队 0 玩家站在其上持续 6.7s（15/s → 100 进度翻转）
    const p = player('p0', 0, alpha.x, alpha.z);
    for (let i = 0; i < 30 * 7; i += 1) sim.update(1 / 30, [p]);
    expect(alpha.owner).toBe(0);
    // 翻转后进度清零并继续累积（0.3s × 15 = 5），但远未到二次翻转
    expect(alpha.progress).toBeGreaterThanOrEqual(0);
    expect(alpha.progress).toBeLessThan(15);
  });

  it('队 1 夺回已属队 0 的据点 → 归属翻转回队 1', () => {
    const sim = new ConquestSim({ captureRadius: 8, captureSpeed: 15 });
    const alpha = sim.objectives.find((o) => o.id === 'alpha')!;
    const p0 = player('p0', 0, alpha.x, alpha.z);
    for (let i = 0; i < 7 * 30; i += 1) sim.update(1 / 30, [p0]);
    expect(alpha.owner).toBe(0);
    // 队 1 玩家进入争夺：进度从 0 反向推进，需 7 秒
    const p1 = player('p1', 1, alpha.x, alpha.z);
    for (let i = 0; i < 7 * 30; i += 1) sim.update(1 / 30, [p1]);
    expect(alpha.owner).toBe(1);
  });

  it('无据点队伍每秒流失兵力（中立据点不算拥有）', () => {
    const sim = new ConquestSim({ captureRadius: 8, captureSpeed: 15, drainPerSecond: 2 });
    // 队 0 占全部 3 个据点（先 10s 完成占领）
    const players = [
      player('p0', 0, 15, 15),
      player('p1', 0, 0, 0),
      player('p2', 0, -15, -15),
    ];
    for (let i = 0; i < 30 * 10; i += 1) sim.update(1 / 30, players);
    expect(sim.objectives.every((o) => o.owner === 0)).toBe(true);
    const t0AfterCapture = sim.tickets[0];
    const t1AfterCapture = sim.tickets[1];
    // 再 5 秒：队 1 无据点持续流失 2/s；队 0 保有据点不流失
    for (let i = 0; i < 30 * 5; i += 1) sim.update(1 / 30, players);
    expect(sim.tickets[1]).toBeCloseTo(t1AfterCapture - 2 * 5, 0);
    expect(sim.tickets[0]).toBe(t0AfterCapture);
  });

  it('击杀：死亡方扣 1 兵力，击杀方 +1 击杀', () => {
    const sim = new ConquestSim();
    sim.onPlayerKilled(1, 0);
    expect(sim.tickets[1]).toBe(CONQUEST_DEFAULTS.maxTickets - 1);
    expect(sim.tickets[0]).toBe(CONQUEST_DEFAULTS.maxTickets);
    expect(sim.kills[0]).toBe(1);
    expect(sim.kills[1]).toBe(0);
  });

  it('兵力归零 → 判定对方胜利', () => {
    const sim = new ConquestSim();
    for (let i = 0; i < CONQUEST_DEFAULTS.maxTickets; i += 1) {
      sim.onPlayerKilled(0, 1);
    }
    expect(sim.tickets[0]).toBe(0);
    expect(sim.winner).toBe(1);
    // 结束后击杀事件不再影响状态
    sim.onPlayerKilled(1, 0);
    expect(sim.tickets[1]).toBe(CONQUEST_DEFAULTS.maxTickets);
  });

  it('getState 输出协议形态（含房间/阶段/时间戳）', () => {
    const sim = new ConquestSim();
    sim.onPlayerKilled(1, 0);
    const state = sim.getState('room-1', 'started', 42, 123456);
    expect(state.kind).toBe('game_state');
    expect(state.roomId).toBe('room-1');
    expect(state.phase).toBe('started');
    expect(state.tick).toBe(42);
    expect(state.serverTime).toBe(123456);
    expect(state.tickets).toEqual([300, 299]);
    expect(state.kills).toEqual([1, 0]);
    expect(state.objectives).toHaveLength(3);
    expect(state.winner).toBeNull();
  });
});
