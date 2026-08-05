/**
 * 服务端权威征服规则（阶段 8：游戏内容权威化第一步）。
 * 房间级玩法状态机：兵力值、击杀计数、据点归属与捕获进度、胜负判定。
 * 纯逻辑、无 I/O，可单测；ServerApp 每 tick 喂入玩家位置，命中裁决喂入击杀事件。
 */

import {
  CONQUEST_OBJECTIVE_DEFS,
  type ObjectiveOwner,
  type RoomPhase,
  type ServerGameState,
  type TeamIdNet,
} from '../shared/protocol.ts';

/** 默认征服参数（与客户端本地 ConquestMode 对齐的量级） */
export const CONQUEST_DEFAULTS = {
  maxTickets: 300,
  captureRadius: 8,
  captureSpeed: 15,
  /** 无据点的队伍每秒流失兵力 */
  drainPerSecond: 2,
} as const;

/**
 * 服务端据点定义（不渲染，只做规则）。
 * 与客户端联网场景视觉共用 shared 权威布局（CONQUEST_OBJECTIVE_DEFS），防漂移。
 */
export const CONQUEST_OBJECTIVES = CONQUEST_OBJECTIVE_DEFS;

export interface ConquestPlayerRef {
  id: string;
  team: TeamIdNet;
  x: number;
  z: number;
  alive: boolean;
}

export interface ConquestSimOptions {
  maxTickets?: number;
  captureRadius?: number;
  captureSpeed?: number;
  drainPerSecond?: number;
}

interface ObjectiveSim {
  id: string;
  x: number;
  z: number;
  owner: ObjectiveOwner;
  /** -100..100：正 = 队 0 控制方向，负 = 队 1 */
  progress: number;
}

export class ConquestSim {
  readonly maxTickets: number;
  readonly captureRadius: number;
  readonly captureSpeed: number;
  readonly drainPerSecond: number;

  tickets: [number, number];
  kills: [number, number];
  objectives: ObjectiveSim[];
  winner: TeamIdNet | null = null;

  constructor(options: ConquestSimOptions = {}) {
    this.maxTickets = options.maxTickets ?? CONQUEST_DEFAULTS.maxTickets;
    this.captureRadius = options.captureRadius ?? CONQUEST_DEFAULTS.captureRadius;
    this.captureSpeed = options.captureSpeed ?? CONQUEST_DEFAULTS.captureSpeed;
    this.drainPerSecond = options.drainPerSecond ?? CONQUEST_DEFAULTS.drainPerSecond;
    this.tickets = [this.maxTickets, this.maxTickets];
    this.kills = [0, 0];
    this.objectives = CONQUEST_OBJECTIVES.map((o) => ({
      id: o.id,
      x: o.x,
      z: o.z,
      owner: 2 as ObjectiveOwner,
      progress: 0,
    }));
  }

  /** 每 tick 推进：占点计算 + 无据点方兵力流失 + 胜负判定 */
  update(dt: number, players: ConquestPlayerRef[]): void {
    if (this.winner !== null) return;
    for (const obj of this.objectives) {
      this.updateObjective(obj, dt, players);
    }
    // 兵力流失：一支队伍若一个据点都没有，每秒流失（对战地征服：无据点 = 补给线被切断）
    const owned0 = this.objectives.some((o) => o.owner === 0);
    const owned1 = this.objectives.some((o) => o.owner === 1);
    if (!owned0) this.tickets[0] = Math.max(0, this.tickets[0] - this.drainPerSecond * dt);
    if (!owned1) this.tickets[1] = Math.max(0, this.tickets[1] - this.drainPerSecond * dt);
    this.checkWinner();
  }

  private updateObjective(obj: ObjectiveSim, dt: number, players: ConquestPlayerRef[]): void {
    let count0 = 0;
    let count1 = 0;
    for (const p of players) {
      if (!p.alive) continue;
      const dx = p.x - obj.x;
      const dz = p.z - obj.z;
      if (dx * dx + dz * dz <= this.captureRadius * this.captureRadius) {
        if (p.team === 0) count0 += 1;
        else count1 += 1;
      }
    }
    const strength = count0 - count1;
    if (strength === 0) {
      // 无人争夺：向中立回退（按现有归属方向衰减）
      const decay = this.captureSpeed * 0.5 * dt;
      if (obj.progress > 0) obj.progress = Math.max(0, obj.progress - decay);
      else if (obj.progress < 0) obj.progress = Math.min(0, obj.progress + decay);
      return;
    }
    const dir = strength > 0 ? 1 : -1;
    obj.progress += dir * this.captureSpeed * Math.min(Math.abs(strength), 3) * dt;
    obj.progress = Math.max(-100, Math.min(100, obj.progress));

    if (obj.progress >= 100) {
      obj.progress = 100;
      if (obj.owner !== 0) {
        obj.owner = 0;
        // 新占领方从 0 开始（本地征服一致：翻转后清零，避免残留进度）
        obj.progress = 0;
      }
    } else if (obj.progress <= -100) {
      obj.progress = -100;
      if (obj.owner !== 1) {
        obj.owner = 1;
        obj.progress = 0;
      }
    }
  }

  /** 击杀事件（服务端命中裁决后调用）：死亡方扣 1 兵力，击杀方 +1 击杀 */
  onPlayerKilled(deadTeam: TeamIdNet, killerTeam: TeamIdNet): void {
    if (this.winner !== null) return;
    this.tickets[deadTeam] = Math.max(0, this.tickets[deadTeam] - 1);
    this.kills[killerTeam] += 1;
    this.checkWinner();
  }

  private checkWinner(): void {
    if (this.tickets[0] <= 0) this.winner = 1;
    else if (this.tickets[1] <= 0) this.winner = 0;
  }

  /** 广播用状态（ServerApp 调 broadcastToRoom） */
  getState(roomId: string, phase: RoomPhase, tick: number, serverTime: number): ServerGameState {
    return {
      kind: 'game_state',
      roomId,
      phase,
      tick,
      serverTime,
      tickets: [Math.round(this.tickets[0]), Math.round(this.tickets[1])],
      maxTickets: this.maxTickets,
      kills: [...this.kills] as [number, number],
      objectives: this.objectives.map((o) => ({
        id: o.id,
        owner: o.owner,
        progress: Math.round(o.progress * 10) / 10,
      })),
      winner: this.winner,
    };
  }
}
