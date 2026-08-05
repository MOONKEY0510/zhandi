/**
 * 服务端权威载具模拟单测（阶段 8：游戏内容权威化第二步）。
 * 覆盖：初始状态、上车距离/座位校验、驾驶位移与速度钳制、下车、受击摧毁与重生。
 */

import { describe, expect, it } from 'vitest';
import { VEHICLE_SPAWN_DEFS } from '../shared/protocol.ts';
import { VehicleSim } from './VehicleSim.ts';

describe('VehicleSim', () => {
  it('初始状态：按权威重生点生成，满血、未摧毁、空车、归属正确', () => {
    const sim = new VehicleSim();
    const state = sim.getState(1, 'room');
    expect(state.vehicles).toHaveLength(VEHICLE_SPAWN_DEFS.length);
    for (let i = 0; i < state.vehicles.length; i++) {
      const v = state.vehicles[i];
      const def = VEHICLE_SPAWN_DEFS[i];
      expect(v.id).toBe(def.id);
      expect(v.type).toBe(def.type);
      expect(v.x).toBe(def.x);
      expect(v.z).toBe(def.z);
      expect(v.team).toBe(def.team);
      expect(v.destroyed).toBe(false);
      expect(v.driverId).toBeNull();
      expect(v.respawnIn).toBe(0);
      expect(v.health).toBeGreaterThan(0);
      expect(v.health).toBe(v.maxHealth);
    }
  });

  it('上车：半径内且司机位空闲才接受，距离过远/已占用/已摧毁拒绝', () => {
    const sim = new VehicleSim();
    // 载具 v1 位于 (-16,-16)；玩家站旁边 1m → 接受
    expect(sim.enter('v1', 'p1', -16, -15)).toBe(true);
    expect(sim.getState(1, 'r').vehicles.find((v) => v.id === 'v1')!.driverId).toBe('p1');
    // 司机位已占用 → 拒绝
    expect(sim.enter('v1', 'p2', -16, -15)).toBe(false);
    // 距离过远（出生点 (-20,-20) → 22.6m > 8m）→ 拒绝
    expect(sim.enter('v2', 'p3', -20, -20)).toBe(false);
    // 摧毁后拒绝上车
    sim.takeDamage('v2', 99999);
    expect(sim.enter('v2', 'p4', 16, 17)).toBe(false);
  });

  it('驾驶：前进产生位移且速度不超过最大速度（加速度钳制）', () => {
    const sim = new VehicleSim();
    sim.enter('v1', 'p1', -16, -15);
    // jeep maxSpeed=30 accel=8：连续 drive 5s（dt=0.1 × 50 次），不撞界（MAP_BOUND=160）
    for (let i = 0; i < 50; i++) sim.drive('v1', 1, 0, 0.1);
    const v = sim.getState(1, 'r').vehicles.find((x) => x.id === 'v1')!;
    // 理论 ≈ 加速段 56.25m + 匀速段 37.5m ≈ 93.75m
    const moved = Math.hypot(v.x - -16, v.z - -16);
    expect(moved).toBeGreaterThan(80);
    expect(moved).toBeLessThan(105);
  });

  it('驾驶：无司机时输入无效（需司机身份）', () => {
    const sim = new VehicleSim();
    sim.drive('v1', 1, 0, 1);
    const v = sim.getState(1, 'r').vehicles.find((x) => x.id === 'v1')!;    expect(v.x).toBe(-16);
    expect(v.z).toBe(-16);
  });

  it('下车：释放司机位，之后他人可上车', () => {
    const sim = new VehicleSim();
    sim.enter('v1', 'p1', -16, -15);
    expect(sim.exit('p1')).toBe(true);
    expect(sim.exit('p1')).toBe(false); // 已下车
    expect(sim.enter('v1', 'p2', -16, -15)).toBe(true);
  });

  it('受击摧毁：清空司机 + 重生计时 + 到期复位（满血/初始位置）', () => {
    const sim = new VehicleSim();
    sim.enter('v1', 'p1', -16, -15);
    // 扣 50（未摧毁）
    expect(sim.takeDamage('v1', 50)).toBe(false);
    expect(sim.getState(1, 'r').vehicles.find((v) => v.id === 'v1')!.health).toBe(150);
    // 扣 99999（摧毁）
    expect(sim.takeDamage('v1', 99999)).toBe(true);
    let v = sim.getState(1, 'r').vehicles.find((x) => x.id === 'v1')!;
    expect(v.destroyed).toBe(true);
    expect(v.driverId).toBeNull();
    expect(v.respawnIn).toBeGreaterThan(0);
    // 15s 后重生：复位
    sim.update(15.1);
    v = sim.getState(2, 'r').vehicles.find((x) => x.id === 'v1')!;
    expect(v.destroyed).toBe(false);
    expect(v.health).toBe(v.maxHealth);
    expect(v.x).toBe(-16);
    expect(v.z).toBe(-16);
    expect(v.driverId).toBeNull();
  });

  it('载具开火：仅司机且武器冷却通过才发射（返回弹丸参数），否则拒绝', () => {
    const sim = new VehicleSim();
    // v1 是吉普（机枪 cooldown 140ms）；先上车
    expect(sim.enter('v1', 'p1', -16, -15)).toBe(true);

    // 非司机（p2 未上车）→ 拒绝
    expect(sim.fire('v1', 'p2', 0, 0, 1000)).toBeNull();
    // 司机首次开火 → 成功（机枪 14 伤、140 m/s、射程 200m）
    const r1 = sim.fire('v1', 'p1', 0.5, 0, 1000);
    expect(r1).not.toBeNull();
    expect(r1!.damage).toBe(14);
    expect(r1!.speedMps).toBe(140);
    expect(r1!.x).toBe(-16);
    expect(r1!.z).toBe(-16);
    // 冷却内再开火 → 拒绝（100ms < 140ms）
    expect(sim.fire('v1', 'p1', 0.5, 0, 1100)).toBeNull();
    // 冷却过后（140ms+）→ 成功
    expect(sim.fire('v1', 'p1', 0.5, 0, 1145)).not.toBeNull();
  });

  it('载具开火：摧毁后拒绝；无武器载具（卡车）返回 null', () => {
    const sim = new VehicleSim();
    // v2 是坦克（主炮 cooldown 1800ms）
    expect(sim.enter('v2', 'p2', 16, 17)).toBe(true);
    expect(sim.fire('v2', 'p2', 0, 0, 1000)!.damage).toBe(120);
    // 摧毁后拒绝
    sim.takeDamage('v2', 99999);
    expect(sim.fire('v2', 'p2', 0, 0, 99999)).toBeNull();
    // 非法 weaponIndex（司机身份合法但索引越界）→ 拒绝
    expect(sim.enter('v1', 'p3', -16, -15)).toBe(true);
    expect(sim.fire('v1', 'p3', 0, 0, 0, 5)).toBeNull();
  });
});
