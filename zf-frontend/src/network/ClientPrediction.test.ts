import { describe, it, expect } from 'vitest';
import { ClientPrediction, type PredictionInput } from './ClientPrediction.ts';
import { MAP_BOUND, PLAYER_PITCH_CLAMP, PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from '../../shared/protocol.ts';

function idle(seq: number, overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    seq,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    sprint: false,
    fire: false,
    aimYaw: 0,
    aimPitch: 0,
    ...overrides,
  };
}

/** 与服务端 tick 一致：每输入一帧 = 一个服务端 tick */
const DT = 1 / 30;

function atOrigin(): ConstructorParameters<typeof ClientPrediction>[0] {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true };
}

describe('ClientPrediction（阶段 8 客户端预测/校正）', () => {
  it('预测推进：向前移动 = 步行速度 × dt（yaw=0 朝 -z，与服务端模型一致）', () => {
    const p = new ClientPrediction(atOrigin());
    p.pushInput(idle(1, { moveForward: true }), DT);
    expect(p.state.z).toBeCloseTo(-PLAYER_WALK_SPEED * DT, 10);
    expect(p.state.x).toBeCloseTo(0, 10);
  });

  it('冲刺速度更快', () => {
    const p = new ClientPrediction(atOrigin());
    p.pushInput(idle(1, { moveForward: true, sprint: true }), DT);
    expect(p.state.z).toBeCloseTo(-PLAYER_SPRINT_SPEED * DT, 10);
  });

  it('斜向移动归一化（无对角线加速）', () => {
    const p = new ClientPrediction(atOrigin());
    p.pushInput(idle(1, { moveForward: true, moveRight: true }), DT);
    expect(Math.hypot(p.state.x, p.state.z)).toBeCloseTo(PLAYER_WALK_SPEED * DT, 10);
  });

  it('朝向跟随 aimYaw（yaw=π/2 向前 → +x）', () => {
    const p = new ClientPrediction({ ...atOrigin(), yaw: Math.PI / 2 });
    p.pushInput(idle(1, { moveForward: true, aimYaw: Math.PI / 2 }), DT);
    expect(p.state.x).toBeCloseTo(PLAYER_WALK_SPEED * DT, 10);
    expect(p.state.z).toBeCloseTo(0, 10);
  });

  it('俯仰角钳制：aimPitch 超限被收敛到 ±PLAYER_PITCH_CLAMP', () => {
    const p = new ClientPrediction(atOrigin());
    p.pushInput(idle(1, { aimPitch: 10 }), DT);
    expect(p.state.pitch).toBeCloseTo(PLAYER_PITCH_CLAMP, 10);
    p.pushInput(idle(2, { aimPitch: -10 }), DT);
    expect(p.state.pitch).toBeCloseTo(-PLAYER_PITCH_CLAMP, 10);
  });

  it('边界钳制：持续向前最终停在 MAP_BOUND', () => {
    const p = new ClientPrediction({ ...atOrigin(), z: -MAP_BOUND + 0.1 });
    p.pushInput(idle(1, { moveForward: true }), DT);
    expect(p.state.z).toBeCloseTo(-MAP_BOUND, 10);
  });

  it('死亡状态不推进', () => {
    const p = new ClientPrediction({ ...atOrigin(), alive: false });
    p.pushInput(idle(1, { moveForward: true }), DT);
    expect(p.state.x).toBe(0);
    expect(p.state.z).toBe(0);
  });

  it('乱序输入被忽略（seq 非递增）', () => {
    const p = new ClientPrediction(atOrigin());
    p.pushInput(idle(2), DT);
    p.pushInput(idle(1, { moveForward: true }), DT); // 乱序 → 忽略
    expect(p.pendingInputs.length).toBe(1);
    expect(p.pendingInputs[0].seq).toBe(2);
  });

  it('小误差平滑收敛：renderState 向服务端位置收敛，不硬校正', () => {
    const p = new ClientPrediction(atOrigin(), { smoothing: 0.5 });
    p.pushInput(idle(1), DT); // 本地不动
    const r = p.reconcile({ x: 0.2, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 1 });
    expect(r.snapped).toBe(false);
    expect(r.errorMeters).toBeCloseTo(0.2, 10);
    // 平滑系数 0.5：渲染位置从 0 向 0.2 收敛一半 → 0.1
    expect(p.renderState.x).toBeCloseTo(0.1, 10);
    // 权威预测状态保持本地预测值（不被打断）
    expect(p.state.x).toBeCloseTo(0, 10);
  });

  it('大误差硬校正：回滚到服务端位置并重放未确认输入', () => {
    const p = new ClientPrediction(atOrigin());
    // 本地预测走了 3 米（误差 3 > 阈值 0.5）
    for (let i = 1; i <= 30; i++) {
      p.pushInput(idle(i, { moveForward: true }), DT);
    }
    const r = p.reconcile({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 30 });
    expect(r.snapped).toBe(true);
    expect(r.acked).toBe(30);
    expect(r.replayed).toBe(0); // 全部输入已被 ack，无重放
    expect(p.state.z).toBeCloseTo(0, 10);
    expect(p.pendingInputs.length).toBe(0);
  });

  it('硬校正后重放未确认输入（ackSeq 只确认部分）', () => {
    const p = new ClientPrediction(atOrigin());
    for (let i = 1; i <= 10; i++) {
      p.pushInput(idle(i, { moveForward: true }), DT);
    }
    // 服务端确认到 seq 5，位置在 (0,0,0)（本地已跑 10 帧 → 误差大）
    const r = p.reconcile({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 5 });
    expect(r.snapped).toBe(true);
    expect(r.acked).toBe(5);
    expect(r.replayed).toBe(5); // seq 6..10 重放
    expect(p.pendingInputs.length).toBe(5);
    // 重放后位置 = 5 帧移动量
    expect(p.state.z).toBeCloseTo(-PLAYER_WALK_SPEED * DT * 5, 10);
    // 渲染状态同步对齐（无跳变累积）
    expect(p.renderState.z).toBeCloseTo(p.state.z, 10);
  });

  it('ack 丢弃已确认输入并统计', () => {
    const p = new ClientPrediction(atOrigin());
    for (let i = 1; i <= 5; i++) p.pushInput(idle(i), DT);
    expect(p.ack(3)).toBe(3);
    expect(p.pendingInputs.map((i) => i.seq)).toEqual([4, 5]);
    expect(p.ack(3)).toBe(0); // 重复 ack 无效果
  });

  it('校正统计：误差累计/峰值/重放计数', () => {
    const p = new ClientPrediction(atOrigin());
    p.reconcile({ x: 0.1, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 0 });
    p.reconcile({ x: 0.2, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 0 });
    expect(p.stats.corrections).toBe(2);
    expect(p.stats.totalErrorMeters).toBeCloseTo(0.3, 10);
    expect(p.stats.maxErrorMeters).toBeCloseTo(0.2, 10);
    expect(p.stats.replayedInputs).toBe(0);
  });
});
