/**
 * 客户端预测与服务器校正（阶段 8 P0：客户端网络体验）。
 * 输入序列 + 本地预测 + 快照校正 + 平滑误差回收：
 *  - pushInput：输入追加缓冲并本地推进（移动模型与服务端 PlayerSim 完全一致）；
 *  - reconcile：快照到达时 ack 已确认输入，误差超阈值 → 硬校正回滚并重放未确认输入，
 *    误差在阈值内 → 渲染状态向校正状态平滑收敛（误差回收）；
 *  - renderState：渲染用状态（平滑），state：权威校正后的预测状态（统计用）。
 * 纯逻辑、可单测。
 */

import {
  MAP_BOUND,
  PLAYER_PITCH_CLAMP,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  TICK_RATE_HZ,
} from '../../shared/protocol.ts';

export interface PredictedPlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
}

/** 与服务端 PlayerInput 一致（不含 kind，seq 为本地单调序列） */
export interface PredictionInput {
  seq: number;
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  sprint: boolean;
  fire: boolean;
  aimYaw: number;
  aimPitch: number;
}

export interface ClientPredictionOptions {
  walkSpeed?: number;
  sprintSpeed?: number;
  /** 误差平滑系数（0..1）：每帧渲染状态向校正状态收敛的比例 */
  smoothing?: number;
  /** 硬校正阈值（米）：预测误差超过该值直接对齐服务端并重放未确认输入 */
  snapThreshold?: number;
}

export interface ReconcileResult {
  /** 本次校正的水平位移误差（米） */
  errorMeters: number;
  /** 是否触发硬校正（超过 snapThreshold） */
  snapped: boolean;
  /** 硬校正后重放的未确认输入数 */
  replayed: number;
  /** 被 ack 丢弃的已确认输入数 */
  acked: number;
}

export interface ClientPredictionStats {
  corrections: number;
  totalErrorMeters: number;
  maxErrorMeters: number;
  replayedInputs: number;
}

interface RequiredOpts {
  walkSpeed: number;
  sprintSpeed: number;
  smoothing: number;
  snapThreshold: number;
}

export class ClientPrediction {
  private _state: PredictedPlayerState;
  private _renderState: PredictedPlayerState;
  private readonly opts: RequiredOpts;
  private buffer: PredictionInput[] = [];
  private lastAckSeq = 0;
  readonly stats: ClientPredictionStats = { corrections: 0, totalErrorMeters: 0, maxErrorMeters: 0, replayedInputs: 0 };

  constructor(initial: PredictedPlayerState, options: ClientPredictionOptions = {}) {
    this._state = { ...initial };
    this._renderState = { ...initial };
    this.opts = {
      walkSpeed: options.walkSpeed ?? PLAYER_WALK_SPEED,
      sprintSpeed: options.sprintSpeed ?? PLAYER_SPRINT_SPEED,
      smoothing: options.smoothing ?? 0.5,
      snapThreshold: options.snapThreshold ?? 0.5,
    };
  }

  /** 权威校正后的预测状态（渲染一般用 renderState） */
  get state(): PredictedPlayerState {
    return { ...this._state };
  }

  /** 渲染状态：硬校正时对齐，小误差时平滑收敛 */
  get renderState(): PredictedPlayerState {
    return { ...this._renderState };
  }

  /** 未确认输入缓冲（seq 单调递增） */
  get pendingInputs(): readonly PredictionInput[] {
    return this.buffer;
  }

  /** 追加输入并本地预测推进一帧（state 与 renderState 同步推进） */
  pushInput(input: PredictionInput, deltaSeconds: number): void {
    if (this.buffer.length > 0 && input.seq <= this.buffer[this.buffer.length - 1].seq) return; // 乱序保护
    this.buffer.push(input);
    this._state = step(this._state, input, deltaSeconds, this.opts);
    this._renderState = step(this._renderState, input, deltaSeconds, this.opts);
  }

  /**
   * 服务端快照校正。
   * @param server 服务端权威状态（仅本人玩家；ackSeq 为服务端已确认的最高输入 seq）
   */
  reconcile(server: PredictedPlayerState & { ackSeq?: number }): ReconcileResult {
    const acked = this.ack(server.ackSeq);
    const error = horizontalDist(this._state.x, this._state.z, server.x, server.z);
    this.stats.corrections += 1;
    this.stats.totalErrorMeters += error;
    this.stats.maxErrorMeters = Math.max(this.stats.maxErrorMeters, error);

    if (error > this.opts.snapThreshold) {
      // 硬校正：回滚到服务端状态并重放未确认输入
      this._state = { ...server };
      const replayed = this.replay();
      // 渲染状态同步对齐（避免视觉跳变累积漂移）
      this._renderState = { ...this._state };
      return { errorMeters: error, snapped: true, replayed, acked };
    }

    // 小误差：渲染状态向服务端权威位置平滑收敛（误差回收），不打断本地手感
    const k = this.opts.smoothing;
    this._renderState = {
      x: lerp(this._renderState.x, server.x, k),
      y: lerp(this._renderState.y, server.y, k),
      z: lerp(this._renderState.z, server.z, k),
      yaw: lerpAngle(this._renderState.yaw, server.yaw, k),
      pitch: lerp(this._renderState.pitch, server.pitch, k),
      health: server.health,
      alive: server.alive,
    };
    return { errorMeters: error, snapped: false, replayed: 0, acked };
  }

  /** 丢弃已被服务端确认的输入（seq <= ackSeq），返回丢弃数量 */
  ack(seq?: number): number {
    if (seq === undefined || seq <= this.lastAckSeq) return 0;
    const before = this.buffer.length;
    this.buffer = this.buffer.filter((i) => i.seq > seq);
    this.lastAckSeq = seq;
    return before - this.buffer.length;
  }

  /** 从当前状态重放缓冲中的未确认输入（每输入一服务端 tick） */
  private replay(): number {
    const tickSeconds = 1 / TICK_RATE_HZ;
    let count = 0;
    for (const input of this.buffer) {
      this._state = step(this._state, input, tickSeconds, this.opts);
      count += 1;
    }
    this.stats.replayedInputs += count;
    return count;
  }
}

/** 与服务端 PlayerSim.step 完全一致的移动模型（保证预测与裁决一致） */
function step(prev: PredictedPlayerState, input: PredictionInput, deltaSeconds: number, opts: RequiredOpts): PredictedPlayerState {
  if (!prev.alive) return prev;
  const speed = input.sprint ? opts.sprintSpeed : opts.walkSpeed;
  let dx = (input.moveRight ? 1 : 0) - (input.moveLeft ? 1 : 0);
  let dz = (input.moveBackward ? 1 : 0) - (input.moveForward ? 1 : 0);
  if (dx !== 0 && dz !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dz *= inv;
  }
  const sinYaw = Math.sin(prev.yaw);
  const cosYaw = Math.cos(prev.yaw);
  const moveX = dx * cosYaw - dz * sinYaw;
  const moveZ = dx * sinYaw + dz * cosYaw;
  return {
    x: clamp(prev.x + moveX * speed * deltaSeconds, -MAP_BOUND, MAP_BOUND),
    y: prev.y,
    z: clamp(prev.z + moveZ * speed * deltaSeconds, -MAP_BOUND, MAP_BOUND),
    yaw: clampAngle(Number.isFinite(input.aimYaw) ? input.aimYaw : prev.yaw),
    pitch: clamp(Number.isFinite(input.aimPitch) ? input.aimPitch : prev.pitch, -PLAYER_PITCH_CLAMP, PLAYER_PITCH_CLAMP),
    health: prev.health,
    alive: prev.alive,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clampAngle(v: number): number {
  if (!Number.isFinite(v)) return 0;
  let a = v % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function lerpAngle(a: number, b: number, alpha: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * alpha;
}

function horizontalDist(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x2 - x1, z2 - z1);
}
