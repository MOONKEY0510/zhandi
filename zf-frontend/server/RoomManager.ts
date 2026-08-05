/**
 * 房间生命周期管理（阶段 8 P0：服务器架构）。
 * 创建 → 加入 → 满员 → 加载 → 开始 → 结束 → 销毁；
 * 中途加入、断线保留（宽限期内重连恢复）、队伍平衡分配。
 */

import {
  MAX_PLAYERS_PER_ROOM,
  MAX_PLAYERS_PER_TEAM,
  DISCONNECT_RETENTION_SECONDS,
  type RoomPhase,
  type RoomPlayerInfo,
} from '../shared/protocol.ts';
import type { ConquestSim } from './ConquestSim.ts';

export interface RoomPlayer {
  id: string;
  displayName: string;
  team: 0 | 1;
  slot: number;
  alive: boolean;
  connected: boolean;
  /** 断线时间戳（ms），connected=false 时用于宽限判断 */
  disconnectedAtMs: number;
  /** 重连恢复：玩家再次 join 时复用原槽位 */
  resumed: boolean;
}

export interface RoomOptions {
  map?: string;
  maxPlayers?: number;
  /** 断线保留宽限期（秒） */
  retentionSeconds?: number;
}

export type JoinResult =
  | { ok: true; player: RoomPlayer; resumed: boolean }
  | { ok: false; code: 'room_full' | 'team_full' | 'already_connected' | 'room_not_found' };

export class Room {
  readonly id: string;
  readonly maxPlayers: number;
  readonly retentionSeconds: number;
  map: string;
  phase: RoomPhase = 'waiting';
  players: RoomPlayer[] = [];
  /** 服务端权威征服规则（首个玩家加入时由 ServerApp 创建） */
  conquest: ConquestSim | null = null;
  /** 单调递增的槽位计数器 */
  private nextSlot = 0;

  constructor(id: string, options: RoomOptions = {}) {
    this.id = id;
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS_PER_ROOM;
    this.map = options.map ?? 'stalingrad';
    this.retentionSeconds = options.retentionSeconds ?? DISCONNECT_RETENTION_SECONDS;
  }

  get playerCount(): number {
    return this.players.length;
  }

  get isFull(): boolean {
    return this.players.length >= this.maxPlayers;
  }

  get phaseLabel(): RoomPhase {
    if (this.phase === 'ended') return 'ended';
    if (this.isFull) return 'full';
    return this.phase;
  }

  /** 加入房间：优先恢复断线玩家，否则分配队伍平衡槽位 */
  join(playerId: string, displayName: string): JoinResult {
    // 断线恢复：同 id 且未超宽限期 → 复用原记录
    const existing = this.players.find((p) => p.id === playerId);
    if (existing) {
      if (existing.connected) {
        return { ok: false, code: 'already_connected' };
      }
      const elapsed = (Date.now() - existing.disconnectedAtMs) / 1000;
      if (elapsed <= this.retentionSeconds) {
        existing.connected = true;
        existing.displayName = displayName;
        existing.resumed = true;
        return { ok: true, player: existing, resumed: true };
      }
      // 超过宽限期：移除旧记录后按新玩家加入
      this.removePlayer(playerId);
    }

    if (this.isFull) return { ok: false, code: 'room_full' };

    const team = this.pickTeam();
    if (team === null) return { ok: false, code: 'team_full' };

    const player: RoomPlayer = {
      id: playerId,
      displayName,
      team,
      slot: this.nextSlot++,
      alive: true,
      connected: true,
      disconnectedAtMs: 0,
      resumed: false,
    };
    this.players.push(player);
    return { ok: true, player, resumed: false };
  }

  /** 队伍平衡分配：人数少的队优先，平局时轮换 */
  private pickTeam(): 0 | 1 | null {
    const count0 = this.players.filter((p) => p.team === 0).length;
    const count1 = this.players.filter((p) => p.team === 1).length;
    if (count0 >= MAX_PLAYERS_PER_TEAM && count1 >= MAX_PLAYERS_PER_TEAM) return null;
    if (count0 > count1) return 1;
    if (count1 > count0) return 0;
    return (this.players.length % 2) as 0 | 1;
  }

  /** 断线登记：进入宽限期，超时由 tick 清理 */
  markDisconnected(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    player.connected = false;
    player.disconnectedAtMs = Date.now();
  }

  /** 主动离开（立即移除） */
  removePlayer(playerId: string): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index >= 0) this.players.splice(index, 1);
  }

  /** 每 tick 清理超宽限期的断线玩家，返回被移除的 id 列表 */
  cleanupDisconnected(nowMs = Date.now()): string[] {
    const removed: string[] = [];
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (!p.connected && (nowMs - p.disconnectedAtMs) / 1000 > this.retentionSeconds) {
        removed.push(p.id);
        this.players.splice(i, 1);
      }
    }
    return removed;
  }

  getPlayer(playerId: string): RoomPlayer | null {
    return this.players.find((p) => p.id === playerId) ?? null;
  }

  /** 房间状态快照（发给客户端的精简信息） */
  toRoomState(): RoomPlayerInfo[] {
    return this.players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      team: p.team,
      alive: p.alive && p.connected,
    }));
  }

  /** 开始对局 */
  start(): void {
    if (this.phase === 'waiting' || this.phase === 'full' || this.phase === 'loading') {
      this.phase = 'started';
    }
  }

  end(): void {
    this.phase = 'ended';
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(roomId: string, options: RoomOptions = {}): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room = new Room(roomId, options);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  /** 加入或创建（demo 语义：房间不存在则创建） */
  joinOrCreate(roomId: string, playerId: string, displayName: string, options: RoomOptions = {}): JoinResult {
    const room = this.createRoom(roomId, options);
    const result = room.join(playerId, displayName);
    return result;
  }

  /** 断线登记（宽限期保留） */
  disconnect(playerId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.getPlayer(playerId)) {
        room.markDisconnected(playerId);
        return room;
      }
    }
    return null;
  }

  leave(playerId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.getPlayer(playerId)) {
        room.removePlayer(playerId);
        return room;
      }
    }
    return null;
  }

  /** 清理所有房间的过期断线玩家，返回 { roomId, playerIds } 列表 */
  cleanupAll(nowMs = Date.now()): { roomId: string; playerIds: string[] }[] {
    const results: { roomId: string; playerIds: string[] }[] = [];
    for (const [roomId, room] of this.rooms) {
      const removed = room.cleanupDisconnected(nowMs);
      if (removed.length > 0) results.push({ roomId, playerIds: removed });
      if (room.players.length === 0 && room.phase === 'ended') {
        this.rooms.delete(roomId);
      }
    }
    return results;
  }

  /** 统计（监控/压测用） */
  stats(): { rooms: number; players: number; activeRooms: number } {
    let players = 0;
    let activeRooms = 0;
    for (const room of this.rooms.values()) {
      players += room.players.length;
      if (room.players.length > 0) activeRooms += 1;
    }
    return { rooms: this.rooms.size, players, activeRooms };
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }
}
