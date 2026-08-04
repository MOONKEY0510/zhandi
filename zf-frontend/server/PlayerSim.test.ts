import { describe, it, expect } from 'vitest';
import { PlayerSim, type PlayerSimInput } from './PlayerSim.ts';

const spawn = { x: 0, y: 0, z: 0 };

function input(partial: Partial<PlayerSimInput> = {}): PlayerSimInput {
  return {
    moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
    sprint: false, fire: false, aimYaw: 0, aimPitch: 0,
    ...partial,
  };
}

describe('PlayerSim（阶段 8 权威移动模拟）', () => {
  it('前进位移 = 步行速度 × 帧时间', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    sim.step(input({ moveForward: true }), 1, 0);
    expect(sim.state.z).toBeCloseTo(-5.2, 5); // 服务端坐标系 z 轴为前（负方向）
  });

  it('斜向移动归一化（无对角线加速）', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    sim.step(input({ moveForward: true, moveRight: true }), 1, 0);
    const dist = Math.hypot(sim.state.x, sim.state.z);
    expect(dist).toBeCloseTo(5.2, 5);
  });

  it('冲刺速度上限（sprint > walk）', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    sim.step(input({ moveForward: true, sprint: true }), 1, 0);
    expect(Math.abs(sim.state.z)).toBeCloseTo(7.4, 5);
  });

  it('朝向钳制：非法角度被修正并计数', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    const result = sim.step(input({ aimYaw: Number.NaN, aimPitch: 999 }), 1, 0);
    expect(result.corrected).toBe(true);
    expect(sim.state.yaw).toBe(0);
    expect(sim.state.pitch).toBeCloseTo(Math.PI / 2 - 0.01, 5);
    expect(sim.speedCorrections).toBe(1);
  });

  it('边界钳制：超界位置被拉回', () => {
    const sim = new PlayerSim('p1', 0, { x: 159, y: 0, z: 159 });
    const result = sim.step(input({ moveRight: true, sprint: true }), 1, 0);
    expect(result.corrected).toBe(true);
    expect(Math.abs(sim.state.x)).toBeLessThanOrEqual(160);
    expect(Math.abs(sim.state.z)).toBeLessThanOrEqual(160);
  });

  it('射速裁决：冷却内重复开火被拒绝', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    const first = sim.step(input({ fire: true }), 1, 1000);
    expect(first.fired).toBe(true);
    // 冷却内（120ms）再开火 → 拒绝
    const second = sim.step(input({ fire: true }), 1, 1050);
    expect(second.fired).toBe(false);
    expect(second.corrected).toBe(true);
    // 冷却后恢复
    const third = sim.step(input({ fire: true }), 1, 1200);
    expect(third.fired).toBe(true);
  });

  it('死亡后不响应输入', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    expect(sim.takeDamage(100)).toBe(true);
    expect(sim.state.alive).toBe(false);
    const result = sim.step(input({ moveForward: true, fire: true }), 1, 0);
    expect(result.fired).toBe(false);
    expect(sim.state.x).toBe(0);
  });

  it('重生复位血量与位置', () => {
    const sim = new PlayerSim('p1', 0, spawn);
    sim.takeDamage(60);
    sim.respawn(10, 20);
    expect(sim.state.alive).toBe(true);
    expect(sim.state.health).toBe(100);
    expect(sim.state.x).toBe(10);
    expect(sim.state.z).toBe(20);
  });

  it('toSnapshot 输出快照字段', () => {
    const sim = new PlayerSim('p1', 1, spawn);
    sim.step(input({ moveForward: true }), 1, 0);
    const snap = sim.toSnapshot();
    expect(snap.id).toBe('p1');
    expect(snap.health).toBe(100);
    expect(snap.alive).toBe(true);
    expect(snap.z).toBeCloseTo(-5.2, 5);
  });
});
