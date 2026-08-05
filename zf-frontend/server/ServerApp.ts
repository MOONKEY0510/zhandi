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
  INPUT_BUFFER_WINDOW,
  PLAYER_EYE_HEIGHT,
  RESPAWN_DELAY_MS,
  ROUND_RESTART_DELAY_MS,
  type NetworkMessage,
  type PlayerInput,
  type JoinAck,
  type Snapshot,
  type RoomState,
  type VehicleDrive,
  type VehicleFire,
} from '../shared/protocol.ts';
import { encodeMessage, decodeMessage, ProtocolError } from '../shared/codec.ts';
import { computeVisiblePlayers } from '../shared/interest.ts';
import { SimClock } from './SimClock.ts';
import { RoomManager, type Room } from './RoomManager.ts';
import { PlayerSim, type PlayerSimInput } from './PlayerSim.ts';
import { VehicleSim } from './VehicleSim.ts';
import { ProjectileSim, type ProjectileTarget } from './ProjectileSim.ts';
import { ConquestSim, type ConquestPlayerRef } from './ConquestSim.ts';

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
  /** 显示名（击杀事件/计分板用，握手时登记） */
  displayName: string;
  roomId: string | null;
  sim: PlayerSim | null;
  /** 输入速率限制（滑动窗口） */
  inputTimes: number[];
  /** 输入序列去重（服务端已收到的最高 seq，重放检测） */
  lastSeq: number;
  /** 乱序容忍缓冲：按 seq 升序的待应用输入（抖动导致乱序时缓冲，不丢） */
  pendingQueue: PlayerInput[];
  /** 已应用到模拟的最高 seq */
  lastAppliedSeq: number;
  /** RTT 统计 */
  lastPingClientTime: number;
  /** 载具驾驶输入（最近一次 vehicle_drive；每 tick 应用到玩家所在载具） */
  vehicleDrive: { forward: number; turn: number } | null;
}

const SPAWN = [
  { x: -20, y: 0, z: -20 },
  { x: 20, y: 0, z: 20 },
];

/** 上车半径（米）：与服务端据点捕获半径一致 */
const VEHICLE_ENTER_RADIUS = 8;

/** 载具武器类型 → 击杀事件显示名 */
const VEHICLE_WEAPON_LABELS: Record<'mg' | 'cannon', string> = { mg: '机枪', cannon: '主炮' };

export class ServerApp {
  readonly roomManager = new RoomManager();
  readonly clock = new SimClock({ tickRateHz: TICK_RATE_HZ, snapshotEveryTicks: SNAPSHOT_EVERY_TICKS });
  /** 服务端权威弹道与命中裁决 */
  readonly projectiles = new ProjectileSim();
  private wss: WebSocketServer | null = null;
  private connections = new Map<WebSocket, Connection>();
  private readonly options: Required<Pick<ServerAppOptions, 'defaultRoomId'>> & ServerAppOptions;
  /** 监控：累计速度修正次数（异常移动检测） */
  private totalCorrections = 0;
  /** tick 循环定时器（stop 时清除，优雅关闭） */
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (!this.wss) return; // 已停止：不再推进
      this.clock.step();
      this.options.onStats?.({
        tick: this.clock.tick,
        rooms: this.roomManager.stats().rooms,
        players: this.roomManager.stats().players,
        corrections: this.totalCorrections,
      });
      this.tickTimer = setTimeout(loop, tickMs);
    };
    this.tickTimer = setTimeout(loop, tickMs);
  }

  private handleConnection(ws: WebSocket): void {
    const conn: Connection = {
      ws,
      playerId: null,
      displayName: '',
      roomId: null,
      sim: null,
      inputTimes: [],
      lastSeq: -1,
      pendingQueue: [],
      lastAppliedSeq: -1,
      lastPingClientTime: 0,
      vehicleDrive: null,
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
        conn.displayName = msg.displayName;
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
        // 首个玩家加入即开局（演示语义：房间创建即进入征服对局）
        room.conquest ??= new ConquestSim();
        room.vehicles ??= new VehicleSim();
        if (room.phase === 'waiting') room.start();
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
        this.send(conn.ws, this.buildRoomState(room));
        return;
      }

      case 'input': {
        this.handleInput(conn, msg);
        return;
      }

      case 'vehicle_enter': {
        this.handleVehicleEnter(conn, msg.vehicleId);
        return;
      }

      case 'vehicle_exit': {
        this.handleVehicleExit(conn);
        return;
      }

      case 'vehicle_drive': {
        this.handleVehicleDrive(conn, msg);
        return;
      }

      case 'vehicle_fire': {
        this.handleVehicleFire(conn, msg);
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
      case 'game_state':
      case 'vehicle_state':
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
    // 乱序晚到的旧包（seq 已应用过）：客户端每个 seq 只发一次，无重传机制，
    // 因此这只可能是抖动导致的乱序到达 —— 静默丢弃（不打断玩家，也不误报攻击）。
    if (msg.seq <= conn.lastAppliedSeq) {
      return;
    }
    if (msg.seq > conn.lastSeq + INPUT_BUFFER_WINDOW) {
      // 超出乱序容忍窗口：视为非法跳跃（异常输入检测）
      this.send(conn.ws, { kind: 'error', code: 'input_jump', message: '输入序列跳跃过大' });
      return;
    }
    conn.lastSeq = Math.max(conn.lastSeq, msg.seq);
    // 按 seq 升序插入缓冲（抖动乱序 → 缓冲等待补齐，不丢弃）
    const queue = conn.pendingQueue;
    let i = queue.length;
    while (i > 0 && queue[i - 1].seq > msg.seq) i -= 1;
    queue.splice(i, 0, msg);
  }

  /** 上车：服务端校验玩家距离与司机位（半径 8m，与据点捕获半径一致） */
  private handleVehicleEnter(conn: Connection, vehicleId: string): void {
    const room = conn.roomId ? this.roomManager.getRoom(conn.roomId) : null;
    if (!conn.playerId || !conn.sim || !room?.vehicles) {
      this.send(conn.ws, { kind: 'error', code: 'vehicle_enter_failed', message: '请先加入房间' });
      return;
    }
    const s = conn.sim.state;
    const ok = room.vehicles.enter(vehicleId, conn.playerId, s.x, s.z, VEHICLE_ENTER_RADIUS);
    if (!ok) {
      this.send(conn.ws, { kind: 'error', code: 'vehicle_enter_failed', message: '载具不可用或距离过远' });
    }
  }

  /** 下车：退出当前所在载具 */
  private handleVehicleExit(conn: Connection): void {
    const room = conn.roomId ? this.roomManager.getRoom(conn.roomId) : null;
    if (!conn.playerId || !room?.vehicles) return;
    room.vehicles.exit(conn.playerId);
    conn.vehicleDrive = null;
  }

  /** 驾驶输入：仅记录（每 tick 应用到该玩家所在载具）；输入范围钳制 */
  private handleVehicleDrive(conn: Connection, msg: VehicleDrive): void {
    conn.vehicleDrive = {
      forward: Math.max(-1, Math.min(1, Number.isFinite(msg.forward) ? msg.forward : 0)),
      turn: Math.max(-1, Math.min(1, Number.isFinite(msg.turn) ? msg.turn : 0)),
    };
  }

  /**
   * 载具开火：服务端裁决司机/武器/冷却 → 生成弹丸（复用玩家弹道裁决管线，
   * 弹丸 ownerId = 司机，命中敌方玩家同样走击杀/兵力扣减）。
   */
  private handleVehicleFire(conn: Connection, msg: VehicleFire): void {
    const room = conn.roomId ? this.roomManager.getRoom(conn.roomId) : null;
    if (!conn.playerId || !conn.sim || !room?.vehicles) return;
    const yaw = Number.isFinite(msg.aimYaw) ? msg.aimYaw : 0;
    const pitch = Number.isFinite(msg.aimPitch) ? msg.aimPitch : 0;
    const weaponIndex = Number.isInteger(msg.weaponIndex) ? Math.max(0, Math.min(3, msg.weaponIndex)) : 0;
    const result = room.vehicles.fire(msg.vehicleId, conn.playerId, yaw, pitch, this.clock.nowMs(), weaponIndex);
    if (!result) return;
    this.projectiles.spawn({
      ownerId: conn.playerId,
      team: conn.sim.state.team,
      x: result.x,
      y: result.y,
      z: result.z,
      yaw,
      pitch,
      speedMps: result.speedMps,
      damage: result.damage,
      maxRange: result.maxRange,
      lifeMs: result.lifeMs,
      label: VEHICLE_WEAPON_LABELS[result.weaponKind],
    });
  }

  /** 每 tick：把最新输入应用到玩家模拟，推进弹道并裁决命中 */
  private stepSimulation(tick: number, deltaSeconds: number, shouldSnapshot: boolean): void {
    // 快照广播前应用输入（输入在上一 tick 到达，本 tick 生效；乱序缓冲按 seq 顺序消费）
    for (const conn of this.connections.values()) {
      if (!conn.sim) continue;
      let applied = false;
      while (conn.pendingQueue.length > 0) {
        const next = conn.pendingQueue.shift()!;
        if (next.seq <= conn.lastAppliedSeq) continue; // 理论不会发生（已过滤），防御
        conn.lastAppliedSeq = next.seq;
        const input: PlayerSimInput = {
          moveForward: next.moveForward,
          moveBackward: next.moveBackward,
          moveLeft: next.moveLeft,
          moveRight: next.moveRight,
          sprint: next.sprint,
          fire: next.fire,
          aimYaw: next.aimYaw,
          aimPitch: next.aimPitch,
        };
        const result = conn.sim.step(input, deltaSeconds, this.clock.nowMs());
        if (result.corrected) this.totalCorrections += 1;
        if (result.fired) {
          // 服务端裁决射速通过 → 生成弹丸（起点 = 眼睛高度，方向 = 朝向）
          const s = conn.sim.state;
          this.projectiles.spawn({
            ownerId: conn.playerId!,
            team: s.team,
            x: s.x,
            y: s.y + PLAYER_EYE_HEIGHT,
            z: s.z,
            yaw: s.yaw,
            pitch: s.pitch,
          });
        }
        applied = true;
      }
      if (!applied) {
        // 无输入：惯性停止（速度由钳制模型自然归零）
        conn.sim.step({ moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, fire: false, aimYaw: conn.sim.state.yaw, aimPitch: conn.sim.state.pitch }, deltaSeconds, this.clock.nowMs());
      }
    }

    // 死亡重生（服务端权威）：死亡计时到期 → 队伍出生点复活（下一周期快照反映）。
    // 仅在 started 阶段生效：结算期（ended）保持阵亡，由 restartRound 统一复活。
    for (const conn of this.connections.values()) {
      if (!conn.sim || conn.sim.state.alive) continue;
      const room = conn.roomId ? this.roomManager.getRoom(conn.roomId) : null;
      if (!room || room.phase !== 'started') continue;
      if (this.clock.nowMs() - conn.sim.state.deathTimeMs >= RESPAWN_DELAY_MS) {
        const s = conn.sim.state;
        const spawn = SPAWN[s.team];
        conn.sim.respawn(spawn.x, spawn.z);
        conn.vehicleDrive = null;
      }
    }

    // 弹道推进 + 命中裁决（伤害由服务器裁决，客户端无法伪造击杀）
    const targets: ProjectileTarget[] = [];
    for (const conn of this.connections.values()) {
      if (!conn.sim) continue;
      const s = conn.sim.state;
      targets.push({ id: s.id, team: s.team, x: s.x, y: s.y, z: s.z, alive: s.alive });
    }
    // 载具作为弹道目标：命中半径按车型（大型目标更易命中），摧毁 → 司机被清空（vehicle_state 广播驱动客户端被动退出）
    for (const room of this.roomManager.listRooms()) {
      if (!room.vehicles) continue;
      for (const v of room.vehicles.list()) {
        if (v.destroyed) continue;
        targets.push({
          id: v.id,
          team: v.team as 0 | 1,
          x: v.x,
          y: 0.8,
          z: v.z,
          alive: true,
          radius: v.hitRadius,
        });
      }
    }
    this.projectiles.step(deltaSeconds, targets, (hit) => {
      // 命中载具（id 形如 v1/v2）：扣血 → 摧毁（清空司机 + 重生计时）
      for (const room of this.roomManager.listRooms()) {
        if (room.vehicles?.getVehicle(hit.targetId)) {
          room.vehicles.takeDamage(hit.targetId, hit.damage);
          return;
        }
      }
      const targetConn = this.findConnection(hit.targetId);
      if (targetConn?.sim) {
        const wasAlive = targetConn.sim.state.alive;
        targetConn.sim.takeDamage(hit.damage, this.clock.nowMs());
        // 死亡翻转：广播击杀事件（kill_feed 即时反馈）+ 服务端权威扣兵力/记击杀
        if (wasAlive && !targetConn.sim.state.alive) {
          const room = targetConn.roomId ? this.roomManager.getRoom(targetConn.roomId) : null;
          const shooterConn = this.findConnection(hit.ownerId);
          if (room) {
            this.broadcastToRoom(room.id, {
              kind: 'kill_feed',
              killerId: hit.ownerId,
              killerName: shooterConn?.displayName || '未知',
              victimId: hit.targetId,
              victimName: targetConn.displayName || hit.targetId,
              weaponLabel: hit.label,
            });
          }
          if (room?.conquest && shooterConn?.sim) {
            room.conquest.onPlayerKilled(targetConn.sim.state.team, shooterConn.sim.state.team);
          }
        }
      }
    });

    // 征服规则推进（服务端权威：占点 / 兵力流失 / 胜负判定）
    for (const room of this.roomManager.listRooms()) {
      if (room.phase !== 'started' || !room.conquest) continue;
      const refs: ConquestPlayerRef[] = [];
      for (const p of room.players) {
        const c = this.findConnection(p.id);
        if (c?.sim) {
          const s = c.sim.state;
          refs.push({ id: s.id, team: s.team, x: s.x, z: s.z, alive: s.alive });
        }
      }
      room.conquest.update(deltaSeconds, refs);
      if (room.conquest.winner !== null) {
        // 回合结束：进入结算期，经 ROUND_RESTART_DELAY_MS 自动开新回合
        room.end();
        room.roundEndAtMs = this.clock.nowMs() + ROUND_RESTART_DELAY_MS;
      }
    }

    // 载具推进（服务端权威：驾驶输入应用到司机所在载具，空车惯性减速，摧毁重生）
    for (const room of this.roomManager.listRooms()) {
      if (!room.vehicles) continue;
      for (const p of room.players) {
        const c = this.findConnection(p.id);
        if (!c?.vehicleDrive || !c.playerId) continue;
        const v = room.vehicles.getVehicleByDriver(c.playerId);
        if (v) room.vehicles.drive(v.id, c.vehicleDrive.forward, c.vehicleDrive.turn, deltaSeconds);
      }
      room.vehicles.update(deltaSeconds);
    }

    // 回合重启（服务端权威）：结算期结束 → 重置征服/载具/全部玩家重生 → 广播新回合状态
    for (const room of this.roomManager.listRooms()) {
      if (room.phase === 'ended' && room.roundEndAtMs !== null && this.clock.nowMs() >= room.roundEndAtMs) {
        this.restartRound(room);
      }
    }

    if (shouldSnapshot) {
      this.broadcastSnapshots(tick);
      this.broadcastVehicleStates(tick);
    }
    // 游戏状态广播（~2Hz，30Hz tick 下每 15 tick 一次）
    if (tick % 15 === 0) {
      for (const room of this.roomManager.listRooms()) {
        if (room.conquest) {
          this.broadcastToRoom(room.id, room.conquest.getState(room.id, room.phaseLabel, tick, this.clock.nowMs()));
        }
      }
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
        // 观察者本人附加 ackSeq（服务端已确认并应用的最高输入 seq，客户端预测校正基准）。
        // 注意用 lastAppliedSeq 而非 lastSeq：乱序缓冲中尚未应用的输入不能被 ack，
        // 否则客户端会丢弃未确认输入，硬校正重放时状态偏差。
        const snapshot: Snapshot = {
          kind: 'snapshot',
          tick,
          serverTime: this.clock.nowMs(),
          players: visible.map((p) =>
            p.id === conn.playerId && conn.lastAppliedSeq >= 0 ? { ...p, ackSeq: conn.lastAppliedSeq } : p,
          ),
        };
        this.send(conn.ws, snapshot);
      }
    }
  }

  /** 载具状态广播（与快照同周期 15Hz；客户端渲染/插值用） */
  private broadcastVehicleStates(tick: number): void {
    for (const room of this.roomManager.listRooms()) {
      if (!room.vehicles || room.players.length === 0) continue;
      this.broadcastToRoom(room.id, room.vehicles.getState(tick, room.id));
    }
  }

  /** 组装房间状态消息（join 应答与回合重启广播共用） */
  private buildRoomState(room: Room): RoomState {
    return {
      kind: 'room_state',
      roomId: room.id,
      phase: room.phaseLabel,
      map: room.map,
      tickRate: this.clock.tickRateHz,
      snapshotRate: this.clock.tickRateHz / this.clock.snapshotEveryTicks,
      players: room.toRoomState(),
    };
  }

  /** 新回合：重置征服/载具权威模拟 + 全员队伍出生点复活 + 立即广播 room_state/game_state */
  private restartRound(room: Room): void {
    room.conquest = new ConquestSim();
    room.vehicles = new VehicleSim();
    room.phase = 'started';
    room.roundEndAtMs = null;
    for (const p of room.players) {
      const c = this.findConnection(p.id);
      if (c?.sim) {
        const s = c.sim.state;
        const spawn = SPAWN[s.team];
        c.sim.respawn(spawn.x, spawn.z);
        c.vehicleDrive = null;
      }
    }
    this.broadcastToRoom(room.id, this.buildRoomState(room));
    if (room.conquest) {
      this.broadcastToRoom(room.id, room.conquest.getState(room.id, room.phaseLabel, this.clock.tick, this.clock.nowMs()));
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
        // 断线玩家自动下车（释放载具司机位）
        room.vehicles?.exit(conn.playerId);
        conn.vehicleDrive = null;
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
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.wss?.close();
    this.wss = null;
  }
}
