/**
 * WebSocket 权威服务器（阶段 8 P0）。
 * 握手（协议版本校验）→ 加入房间 → 输入速率限制 → 固定 tick 权威模拟 → 快照广播。
 * 关键结果全部服务器裁决：移动速度、射速、边界。
 */

import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  TICK_RATE_HZ,
  SNAPSHOT_EVERY_TICKS,
  INPUT_RATE_LIMIT_PER_SECOND,
  type NetworkMessage,
  type PlayerInput,
  type JoinAck,
  type Snapshot,
} from '../shared/protocol.ts';
import { encodeMessage, decodeMessage, ProtocolError } from '../shared/codec.ts';
import { computeVisiblePlayers } from '../shared/interest.ts';
import { SimClock } from './SimClock.ts';
import { RoomManager } from './RoomManager.ts';
import { PlayerSim, type PlayerSimInput } from './PlayerSim.ts';

export interface ServerAppOptions {
  port?: number;
  /** 大厅默认房间 */
  defaultRoomId?: string;
  /** 每 tick 调试回调（压测/监控用） */
  onStats?: (stats: { tick: number; rooms: number; players: number; corrections: number }) => void;
}

interface Connection {
  ws: WebSocket;
  playerId: string | null;
  roomId: string | null;
  sim: PlayerSim | null;
  /** 输入速率限制（滑动窗口） */
  inputTimes: number[];
  /** 输入序列去重（服务端已处理的最高 seq） */
  lastSeq: number;
  /** RTT 统计 */
  lastPingClientTime: number;
  /** 最新待应用输入（下一 tick 生效） */
  pendingInput?: PlayerInput;
}

const SPAWN = [
  { x: -20, y: 0, z: -20 },
  { x: 20, y: 0, z: 20 },
];

export class ServerApp {
  readonly roomManager = new RoomManager();
  readonly clock = new SimClock({ tickRateHz: TICK_RATE_HZ, snapshotEveryTicks: SNAPSHOT_EVERY_TICKS });
  private wss: WebSocketServer | null = null;
  private connections = new Map<WebSocket, Connection>();
  private readonly options: Required<Pick<ServerAppOptions, 'defaultRoomId'>> & ServerAppOptions;
  /** 监控：累计速度修正次数（异常移动检测） */
  private totalCorrections = 0;

  constructor(options: ServerAppOptions = {}) {
    this.options = { defaultRoomId: 'lobby-1', ...options };
    this.clock.onTick = (tick, deltaSeconds, shouldSnapshot) => {
      this.stepSimulation(tick, deltaSeconds, shouldSnapshot);
    };
    // 周期清理断线宽限期（每秒一次）
    setInterval(() => {
      const removed = this.roomManager.cleanupAll();
      for (const entry of removed) {
        for (const playerId of entry.playerIds) {
          this.broadcastToRoom(entry.roomId, { kind: 'player_leave', playerId, reason: 'timeout' });
        }
      }
    }, 1000).unref?.();
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.options.port ?? 8787 });
      this.wss = wss;
      wss.on('listening', () => {
        const address = wss.address();
        const port = typeof address === 'object' && address ? address.port : this.options.port ?? 8787;
        resolve(port);
      });
      wss.on('error', reject);
      wss.on('connection', (ws) => this.handleConnection(ws));
      this.startTickLoop();
    });
  }

  private startTickLoop(): void {
    const tickMs = 1000 / this.clock.tickRateHz;
    const loop = (): void => {
      this.clock.step();
      this.options.onStats?.({
        tick: this.clock.tick,
        rooms: this.roomManager.stats().rooms,
        players: this.roomManager.stats().players,
        corrections: this.totalCorrections,
      });
      setTimeout(loop, tickMs);
    };
    setTimeout(loop, tickMs);
  }

  private handleConnection(ws: WebSocket): void {
    const conn: Connection = {
      ws,
      playerId: null,
      roomId: null,
      sim: null,
      inputTimes: [],
      lastSeq: -1,
      lastPingClientTime: 0,
      pendingInput: undefined,
    };
    this.connections.set(ws, conn);

    ws.on('message', (data) => {
      let msg: NetworkMessage;
      try {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
        msg = decodeMessage(bytes);
      } catch (err) {
        if (err instanceof ProtocolError) {
          this.send(ws, { kind: 'error', code: err.code, message: err.message });
        }
        return;
      }
      this.handleMessage(conn, msg);
    });

    ws.on('close', () => {
      this.handleDisconnect(conn);
      this.connections.delete(ws);
    });

    ws.on('error', () => {
      this.handleDisconnect(conn);
    });
  }

  private handleMessage(conn: Connection, msg: NetworkMessage): void {
    switch (msg.kind) {
      case 'hello': {
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.send(conn.ws, {
            kind: 'error',
            code: 'protocol_mismatch',
            message: `协议版本不匹配：客户端 ${msg.protocolVersion}，服务器 ${PROTOCOL_VERSION}`,
          });
          conn.ws.close();
          return;
        }
        conn.playerId = msg.playerId;
        this.send(conn.ws, { kind: 'hello_ack', protocolVersion: PROTOCOL_VERSION, serverTick: this.clock.tick });
        return;
      }

      case 'join': {
        if (!conn.playerId) {
          this.send(conn.ws, { kind: 'error', code: 'not_hello', message: '请先握手' });
          return;
        }
        const room = this.roomManager.getRoom(msg.roomId) ?? this.roomManager.createRoom(msg.roomId);
        const result = room.join(conn.playerId, conn.playerId);
        if (!result.ok) {
          this.send(conn.ws, { kind: 'error', code: result.code, message: `加入失败：${result.code}` });
          return;
        }
        conn.roomId = room.id;
        const teamSpawn = SPAWN[result.player.team];
        conn.sim = new PlayerSim(result.player.id, result.player.team, teamSpawn);
        if (!result.resumed) {
          // 新加入玩家保持队伍原状（不重置）
        }
        const ack: JoinAck = {
          kind: 'join_ack',
          roomId: room.id,
          playerId: result.player.id,
          team: result.player.team,
          slot: result.player.slot,
          resumed: result.resumed,
        };
        this.send(conn.ws, ack);
        this.send(conn.ws, {
          kind: 'room_state',
          roomId: room.id,
          phase: room.phaseLabel,
          map: room.map,
          tickRate: this.clock.tickRateHz,
          snapshotRate: this.clock.tickRateHz / this.clock.snapshotEveryTicks,
          players: room.toRoomState(),
        });
        return;
      }

      case 'input': {
        this.handleInput(conn, msg);
        return;
      }

      case 'ping': {
        conn.lastPingClientTime = msg.clientTime;
        this.send(conn.ws, { kind: 'pong', clientTime: msg.clientTime, serverTime: this.clock.nowMs() });
        return;
      }

      case 'pong':
      case 'snapshot':
      case 'hello_ack':
      case 'join_ack':
      case 'room_state':
      case 'player_leave':
      case 'error':
        // 客户端不应向服务器发送这些消息
        this.send(conn.ws, { kind: 'error', code: 'unexpected_message', message: `客户端不应发送 ${msg.kind}` });
        return;
    }
  }

  private handleInput(conn: Connection, msg: PlayerInput): void {
    if (!conn.playerId || !conn.sim || !conn.roomId) {
      this.send(conn.ws, { kind: 'error', code: 'not_joined', message: '请先加入房间' });
      return;
    }
    // 输入速率限制（防洪水）
    const now = Date.now();
    conn.inputTimes.push(now);
    while (conn.inputTimes.length > 0 && now - conn.inputTimes[0] > 1000) conn.inputTimes.shift();
    if (conn.inputTimes.length > INPUT_RATE_LIMIT_PER_SECOND) {
      this.send(conn.ws, { kind: 'error', code: 'input_rate_limited', message: '输入频率超限' });
      return;
    }
    // 序列检查：只接受递增 seq（拒绝乱序/重放）
    if (msg.seq <= conn.lastSeq) {
      this.send(conn.ws, { kind: 'error', code: 'stale_input', message: '过期输入序列' });
      return;
    }
    conn.lastSeq = msg.seq;
    conn.pendingInput = msg;
  }

  /** 每 tick：把最新输入应用到玩家模拟 */
  private stepSimulation(tick: number, deltaSeconds: number, shouldSnapshot: boolean): void {
    // 快照广播前应用输入（输入在上一 tick 到达，本 tick 生效）
    for (const conn of this.connections.values()) {
      if (!conn.sim) continue;
      if (conn.pendingInput) {
        const input: PlayerSimInput = {
          moveForward: conn.pendingInput.moveForward,
          moveBackward: conn.pendingInput.moveBackward,
          moveLeft: conn.pendingInput.moveLeft,
          moveRight: conn.pendingInput.moveRight,
          sprint: conn.pendingInput.sprint,
          fire: conn.pendingInput.fire,
          aimYaw: conn.pendingInput.aimYaw,
          aimPitch: conn.pendingInput.aimPitch,
        };
        const result = conn.sim.step(input, deltaSeconds, this.clock.nowMs());
        if (result.corrected) this.totalCorrections += 1;
        if (result.fired) {
          // 阶段 8 后续：子弹实体/命中判定在服务器裁决；当前先广播开火事件占位
        }
      } else {
        // 无输入：惯性停止（速度由钳制模型自然归零）
        conn.sim.step({ moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, fire: false, aimYaw: conn.sim.state.yaw, aimPitch: conn.sim.state.pitch }, deltaSeconds, this.clock.nowMs());
      }
      conn.pendingInput = undefined;
    }

    if (shouldSnapshot) {
      this.broadcastSnapshots(tick);
    }
  }

  private broadcastSnapshots(tick: number): void {
    for (const room of this.roomManager.listRooms()) {
      const roomPlayers = room.players;
      if (roomPlayers.length === 0) continue;

      // 先汇总全房间玩家权威状态，再按观察者裁剪（Interest Management）
      const all: Snapshot['players'] = [];
      for (const roomPlayer of roomPlayers) {
        const conn = this.findConnection(roomPlayer.id);
        if (conn?.sim) {
          all.push(conn.sim.toSnapshot());
        } else {
          all.push({ id: roomPlayer.id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 0, alive: false });
        }
      }

      for (const roomPlayer of roomPlayers) {
        const conn = this.findConnection(roomPlayer.id);
        if (!conn?.sim || conn.ws.readyState !== conn.ws.OPEN) continue;
        const observer = conn.sim.state;
        const visible = computeVisiblePlayers({
          observerId: conn.playerId!,
          observerX: observer.x,
          observerZ: observer.z,
          players: all,
        });
        // 观察者本人附加 ackSeq（服务端已确认的最高输入 seq，客户端预测校正基准）
        const snapshot: Snapshot = {
          kind: 'snapshot',
          tick,
          serverTime: this.clock.nowMs(),
          players: visible.map((p) =>
            p.id === conn.playerId && conn.lastSeq >= 0 ? { ...p, ackSeq: conn.lastSeq } : p,
          ),
        };
        this.send(conn.ws, snapshot);
      }
    }
  }

  private findConnection(playerId: string): Connection | null {
    for (const conn of this.connections.values()) {
      if (conn.playerId === playerId) return conn;
    }
    return null;
  }

  private handleDisconnect(conn: Connection): void {
    if (conn.playerId) {
      const room = this.roomManager.disconnect(conn.playerId);
      if (room) {
        // 通知同房间其他玩家（宽限期内保留槽位）
        this.broadcastToRoom(room.id, { kind: 'player_leave', playerId: conn.playerId, reason: 'timeout' });
      }
    }
  }

  private broadcastToRoom(roomId: string, msg: NetworkMessage): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    const bytes = encodeMessage(msg);
    for (const player of room.players) {
      const conn = this.findConnection(player.id);
      if (conn && conn.ws.readyState === conn.ws.OPEN) {
        conn.ws.send(bytes);
      }
    }
  }

  private send(ws: WebSocket, msg: NetworkMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(encodeMessage(msg));
  }

  stop(): void {
    this.wss?.close();
    this.wss = null;
  }
}
