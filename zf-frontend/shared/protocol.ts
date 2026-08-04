/**
 * 权威多人协议（阶段 8 P0：服务器架构）。
 * 纯 TypeScript + 无运行期依赖，前端（vite）与服务端（vite-node）共享。
 * 注意：本文件禁止使用 enum（vite-node/Node 直跑需要可擦除语法）。
 */

export const PROTOCOL_VERSION = 1 as const;
/** 固定服务器 tick 频率（Hz） */
export const TICK_RATE_HZ = 30 as const;
/** 快照广播频率（Hz）：tick 30Hz 下每 2 tick 发一次 = 15Hz */
export const SNAPSHOT_EVERY_TICKS = 2 as const;
export const SNAPSHOT_RATE_HZ = TICK_RATE_HZ / SNAPSHOT_EVERY_TICKS as 15;
/** 房间容量（16v16） */
export const MAX_PLAYERS_PER_ROOM = 32 as const;
export const MAX_PLAYERS_PER_TEAM = MAX_PLAYERS_PER_ROOM / 2;
/** 断线保留宽限期（秒）：期间重连可恢复战局 */
export const DISCONNECT_RETENTION_SECONDS = 30 as const;
/** 服务端权威移动参数 */
export const PLAYER_WALK_SPEED = 5.2 as const;
export const PLAYER_SPRINT_SPEED = 7.4 as const;
export const PLAYER_MAX_HEALTH = 100 as const;
/** 输入速率限制（每秒最大 input 消息数，防作弊/洪水） */
export const INPUT_RATE_LIMIT_PER_SECOND = 40 as const;
/** 射击冷却（ms），服务端裁决的射速上限 */
export const SERVER_FIRE_COOLDOWN_MS = 120 as const;
/** 俯仰角钳制（弧度），客户端预测与服务端裁决共用 */
export const PLAYER_PITCH_CLAMP = Math.PI / 2 - 0.01;
/** 地图边界（米），超界位置钳制 */
export const MAP_BOUND = 160 as const;
/** 玩家眼睛高度（米），弹丸出生点 y 偏移 */
export const PLAYER_EYE_HEIGHT = 1.6 as const;
/** 服务端枪弹参数（统一步枪，后续按装备细分） */
export const BULLET_SPEED_MPS = 60 as const;
export const BULLET_DAMAGE = 25 as const;
export const BULLET_HIT_RADIUS = 0.6 as const;
export const BULLET_HEIGHT_HALF = 1.2 as const;
export const BULLET_MAX_RANGE = 200 as const;
export const BULLET_LIFE_MS = 4000 as const;

export type MessageKind =
  | 'hello'
  | 'hello_ack'
  | 'join'
  | 'join_ack'
  | 'room_state'
  | 'input'
  | 'snapshot'
  | 'player_leave'
  | 'ping'
  | 'pong'
  | 'error';

export type RoomPhase = 'waiting' | 'full' | 'loading' | 'started' | 'ended';

export type TeamIdNet = 0 | 1;

export interface ClientHello {
  kind: 'hello';
  protocolVersion: number;
  playerId: string;
  displayName: string;
}

export interface ServerHelloAck {
  kind: 'hello_ack';
  protocolVersion: number;
  serverTick: number;
}

export interface JoinRoom {
  kind: 'join';
  roomId: string;
}

export interface JoinAck {
  kind: 'join_ack';
  roomId: string;
  playerId: string;
  team: TeamIdNet;
  slot: number;
  /** 重连恢复：true 表示接续断线前的战局 */ resumed: boolean;
}

export interface RoomPlayerInfo {
  id: string;
  displayName: string;
  team: TeamIdNet;
  alive: boolean;
}

export interface RoomState {
  kind: 'room_state';
  roomId: string;
  phase: RoomPhase;
  map: string;
  tickRate: number;
  snapshotRate: number;
  players: RoomPlayerInfo[];
}

/** 客户端输入（含本地预测所需序列号） */
export interface PlayerInput {
  kind: 'input';
  /** 客户端输入序列号（单调递增，服务端用于乱序/重放检测） */
  seq: number;
  /** 客户端本地 tick（预测基准） */
  clientTick: number;
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  sprint: boolean;
  fire: boolean;
  aimYaw: number;
  aimPitch: number;
}

export interface SnapshotPlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  alive: boolean;
  /**
   * 服务端已确认的最高输入 seq（仅观察者本人有值）。
   * 客户端预测校正基准：回滚到该状态并重放 seq > ackSeq 的未确认输入。
   */
  ackSeq?: number;
}

export interface Snapshot {
  kind: 'snapshot';
  tick: number;
  /** 快照时间戳（服务端 ms），插值基准 */
  serverTime: number;
  players: SnapshotPlayer[];
}

export interface PlayerLeave {
  kind: 'player_leave';
  playerId: string;
  reason: 'left' | 'timeout' | 'kicked';
}

export interface Ping {
  kind: 'ping';
  clientTime: number;
}

export interface Pong {
  kind: 'pong';
  clientTime: number;
  serverTime: number;
}

export interface ErrorMsg {
  kind: 'error';
  code: string;
  message: string;
}

export type NetworkMessage =
  | ClientHello
  | ServerHelloAck
  | JoinRoom
  | JoinAck
  | RoomState
  | PlayerInput
  | Snapshot
  | PlayerLeave
  | Ping
  | Pong
  | ErrorMsg;

/** 消息最大长度（字节）：防止畸形帧拖垮解析 */
export const MAX_MESSAGE_BYTES = 4096 as const;
