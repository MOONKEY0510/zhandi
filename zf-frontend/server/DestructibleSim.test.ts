/**
 * 服务端权威破坏模拟（阶段 8：破坏状态网络同步）。
 * 验证：受击扣血/摧毁、bitset 表达、回合重置、弹道挡弹障碍尺寸。
 */

import { describe, it, expect } from 'vitest';
import { DestructibleSim } from './DestructibleSim.ts';
import { DESTRUCTIBLE_KIND_CONFIGS, DESTRUCTIBLE_SPAWN_DEFS } from '../shared/protocol.ts';

describe('DestructibleSim（阶段 8 权威破坏模拟）', () => {
  it('布局与 shared 点位一致：对象数 = 定义数，id 稳定', () => {
    const sim = new DestructibleSim();
    expect(sim.count).toBe(DESTRUCTIBLE_SPAWN_DEFS.length);
    expect(sim.getAll().map((o) => o.id)).toEqual(DESTRUCTIBLE_SPAWN_DEFS.map((d) => d.id));
    expect(sim.getBitset()).toBe('0'.repeat(DESTRUCTIBLE_SPAWN_DEFS.length));
  });

  it('受击扣血：未达阈值不摧毁，超过阈值摧毁并翻转 bitset', () => {
    const sim = new DestructibleSim();
    const sandbag = sim.getById(0)!;
    const health = sandbag.maxHealth;
    expect(sim.damage(0, health - 1)).toBe(false);
    expect(sandbag.health).toBe(1);
    expect(sandbag.destroyed).toBe(false);
    expect(sim.getBitset()[0]).toBe('0');

    expect(sim.damage(0, 1)).toBe(true);
    expect(sandbag.destroyed).toBe(true);
    expect(sim.getBitset()).toBe('1' + '0'.repeat(DESTRUCTIBLE_SPAWN_DEFS.length - 1));
  });

  it('已破坏对象不重复受击', () => {
    const sim = new DestructibleSim();
    sim.damage(0, sim.getById(0)!.maxHealth);
    expect(sim.damage(0, 100)).toBe(false);
  });

  it('非法 id 忽略', () => {
    const sim = new DestructibleSim();
    expect(sim.damage(999, 100)).toBe(false);
    expect(sim.getById(999)).toBeNull();
  });

  it('回合重置：全部恢复完整，bitset 归零', () => {
    const sim = new DestructibleSim();
    sim.damage(0, sim.getById(0)!.maxHealth);
    sim.damage(2, sim.getById(2)!.maxHealth);
    sim.damage(7, sim.getById(7)!.maxHealth);
    expect(sim.getBitset().split('').filter((b) => b === '1')).toHaveLength(3);
    sim.reset();
    expect(sim.getBitset()).toBe('0'.repeat(DESTRUCTIBLE_SPAWN_DEFS.length));
    expect(sim.getAll().every((o) => o.health === o.maxHealth && !o.destroyed)).toBe(true);
  });

  it('弹道挡弹障碍：按类型尺寸生成旋转矩形（半宽/半深/中心高）', () => {
    const sim = new DestructibleSim();
    const obs = sim.obstacles();
    expect(obs).toHaveLength(DESTRUCTIBLE_SPAWN_DEFS.length);

    const door = obs.find((o) => o.id === 6)!;
    const doorCfg = DESTRUCTIBLE_KIND_CONFIGS.door;
    expect(door.halfWidth).toBeCloseTo(doorCfg.dimensions.width / 2, 5);
    expect(door.halfDepth).toBeCloseTo(doorCfg.dimensions.depth / 2, 5);
    expect(door.centerY).toBeCloseTo(doorCfg.dimensions.height / 2, 5);
    expect(door.halfHeight).toBeCloseTo(doorCfg.dimensions.height / 2, 5);
    expect(door.rotationY).toBeCloseTo(DESTRUCTIBLE_SPAWN_DEFS[6].rotationY, 5);
  });

  it('已破坏对象不出现在挡弹障碍列表', () => {
    const sim = new DestructibleSim();
    sim.damage(0, sim.getById(0)!.maxHealth);
    const obs = sim.obstacles();
    expect(obs.find((o) => o.id === 0)).toBeUndefined();
  });
});
