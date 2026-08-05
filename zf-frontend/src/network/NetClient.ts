/**
 * 协议客户端（阶段 8 P0：客户端网络体验）。
 * 负责：握手（协议版本校验）→ 加入房间 → 输入序列发送 → 快照缓冲插值 → RTT 统计。
 * 传输层可注入（浏览器 WebSocket / NetSimulator 包装 / 测试假传输）。
 */

import {
  PROTOCOL_VERSION,
  type NetworkMessage,
  type PlayerInput,
  type RoomState,
  type JoinAck,
  type ServerGameState,
  type VehicleStateMsg,
  type KillFeedMsg,
} from '../../shared/protocol.ts';
import { encodeMessage, decodeMessage, ProtocolError } from '../../shared/codec.ts';
import { TICK_RATE_HZ } from '../../shared/protocol.ts';
import { SnapshotBuffer, type SnapshotData, type InterpolatedPlayer } from './SnapshotBuffer.ts';
import { NetSimulator } from './NetSimulator.ts';
import { ClientPrediction, type ReconcileResult } from './ClientPrediction.ts';

/** 原始传输抽象：发送字节 + 消息回调（NetSimulator 与 WebSocket 都满足） */
export interface RawTransport {
  /** 建立连接（等待底层就绪；重连时重新调用） */
  connect(): Promise<void>;
  send(bytes: Uint8Array): void;
  onMessage(cb: (bytes: Uint8Array) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

/** 浏览器 WebSocket 传输 */
export class WebSocketTransport implements RawTransport {
  private ws: WebSocket | null = null;
  constructor(private url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket 连接失败：${this.url}`));
    });
  }

  send(bytes: Uint8Array): void {
    // 复制为 ArrayBuffer 视图，规避 SharedArrayBuffer 泛型不兼容
    this.ws?.send(new Uint8Array(bytes));
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.ws!.onmessage = (event) => {
      const raw = event.data as ArrayBuffer;
      cb(new Uint8Array(raw));
    };
  }

  onClose(cb: (reason: string) => void): void {
    this.ws!.onclose = () => cb('closed');
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export interface NetClientOptions {
  /** 断线重连尝试次数（0 = 不重连） */
  maxReconnects?: number;
  /** 重连基础退避延迟 ms（实际延迟 = base × 2^attempts） */
  reconnectBaseDelayMs?: number;
  /** 网络模拟（联调/演示用），包装在真实传输外 */
  simulator?: NetSimulator;
  /** 自定义传输工厂（测试/同构环境：每次重连新建连接）；默认浏览器 WebSocket（可选模拟器包装） */
  transportFactory?: () => RawTransport;
  /** ping 周期 ms */
  pingIntervalMs?: number;
  /**
   * 客户端预测实例（可选）：sendInput 时推进预测（每输入一服务端 tick），
   * 快照到达时以 ackSeq 校正本人状态。调用方应按服务端 tick 节奏发送输入。
   */
  prediction?: ClientPrediction;
}

export interface NetClientStats {
  rttMs: number | null;
  jitterMs: number | null;
  lastPingAt: number;
  snapshotsReceived: number;
  inputsSent: number;
  seq: number;
  connected: boolean;
  roomId: string | null;
}

export class NetClient {
  private transport: RawTransport;
  /** 传输工厂：重连时重建连接（WebSocket 断线后不可复用） */
  private transportFactory: () => RawTransport;
  private readonly playerId: string;
  private readonly displayName: string;
  private readonly options: Required<
    Pick<NetClientOptions, 'maxReconnects' | 'pingIntervalMs' | 'reconnectBaseDelayMs'>
  >;
  private readonly simulator: NetSimulator | null;
  private readonly prediction: ClientPrediction | null;

  readonly snapshotBuffer = new SnapshotBuffer();
  private seq = 0;
  private connected = false;
  private roomId: string | null = null;
  private phase: RoomState['phase'] | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;

  private rttSamples: number[] = [];
  private lastPingAt = 0;
  private lastPingClientTime = 0;
  private snapshotsReceived = 0;
  private inputsSent = 0;
  /** 握手重试：hello 丢失/延迟时超时重发（模拟 UDP 场景下第一个包也会丢） */
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private helloAttempts = 0;
  /** join 重试：join 消息丢失时超时重发 */
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private joinAttempts = 0;
  private joinedRoom = false;

  onSnapshot: ((players: Map<string, InterpolatedPlayer>, snapshot: SnapshotData) => void) | null = null;
  onRoomState: ((state: RoomState) => void) | null = null;
  onJoinAck: ((ack: JoinAck) => void) | null = null;
  onGameState: ((state: ServerGameState) => void) | null = null;
  onVehicleState: ((state: VehicleStateMsg) => void) | null = null;
  /** 击杀事件（服务端权威：命中裁决死亡后广播） */
  onKillFeed: ((msg: KillFeedMsg) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;
  /** 房间内玩家离开（超时清理/主动退出），用于移除远端实体 */
  onPlayerLeave: ((playerId: string, reason: 'left' | 'timeout' | 'kicked') => void) | null = null;
  /** 每次快照校正本人预测后回调（统计/调试用） */
  onPredictionReconcile: ((result: ReconcileResult) => void) | null = null;

  constructor(url: string, playerId: string, displayName: string, options: NetClientOptions = {}) {
    this.playerId = playerId;
    this.displayName = displayName;
    this.options = {
      maxReconnects: options.maxReconnects ?? 3,
      pingIntervalMs: options.pingIntervalMs ?? 1000,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 500,
    };
    this.simulator = options.simulator ?? null;
    this.prediction = options.prediction ?? null;

    this.transportFactory =
      options.transportFactory ??
      (() => {
        const raw = new WebSocketTransport(url);
        if (this.simulator) {
          // 双向网络模拟：出站（发送 → 延迟/丢包 → 真实 WebSocket）与入站（真实接收 → 延迟/丢包 → 客户端）对称
          const outSim = this.simulator;
          const inSim = new NetSimulator(outSim.getOptions());
          outSim.onReceive = (bytes) => raw.send(bytes);
          return {
            connect: () => raw.connect(),
            send: (bytes) => outSim.send(bytes),
            onMessage: (cb) => {
              inSim.onReceive = (bytes) => cb(bytes);
              raw.onMessage((bytes) => inSim.send(bytes));
            },
            onClose: (cb) => raw.onClose(cb),
            close: () => raw.close(),
          };
        }
        return raw;
      });
    this.transport = this.transportFactory();
  }

  /** 供测试注入假传输（绕过 WebSocket） */
  static withTransport(transport: RawTransport, playerId: string, displayName: string, options: NetClientOptions = {}): NetClient {
    const client = new NetClient('ws://fake', playerId, displayName, options);
    client.transportFactory = () => transport;
    client.transport = transport;
    return client;
  }

  async connect(): Promise<void> {
    this.manualClose = false;
    await this.connectTransport();
    this.sendHello();
    this.startPing();
    this.scheduleHelloRetry();
  }

  /** 建立传输并绑定消息/断线回调 */
  private async connectTransport(): Promise<void> {
    await this.transport.connect();
    this.transport.onMessage((bytes) => this.dispatch(bytes));
    this.transport.onClose((reason) => {
      if (this.manualClose) return;
      this.connected = false;
      this.onDisconnect?.(reason);
      this.scheduleReconnect();
    });
  }

  private sendHello(): void {
    this.helloAttempts += 1;
    this.send({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: this.playerId, displayName: this.displayName });
  }

  /** hello_ack 超时重发：首包在丢包网络下可能丢失，最多重试 3 次 */
  private scheduleHelloRetry(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null;
      if (this.connected || this.helloAttempts >= 3) return;
      this.sendHello();
      this.scheduleHelloRetry();
    }, 1000);
  }

  joinRoom(roomId: string): void {
    this.roomId = roomId;
    this.joinedRoom = false;
    this.joinAttempts = 0;
    this.send({ kind: 'join', roomId });
    this.scheduleJoinRetry();
  }

  /** join_ack 超时重发：丢包网络下 join 可能丢失，最多重试 3 次 */
  private scheduleJoinRetry(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (this.joinedRoom || this.joinAttempts >= 3 || !this.roomId) return;
      this.joinAttempts += 1;
      this.send({ kind: 'join', roomId: this.roomId });
      this.scheduleJoinRetry();
    }, 500);
  }

  /** 发送移动/开火输入（自动附加 seq 与本地 tick；挂载预测时同步推进本地预测） */
  sendInput(input: Omit<PlayerInput, 'kind' | 'seq' | 'clientTick'>): void {
    if (!this.connected) return;
    this.seq += 1;
    this.inputsSent += 1;
    if (this.prediction) {
      this.prediction.pushInput({ ...input, seq: this.seq }, 1 / TICK_RATE_HZ);
    }
    this.send({
      kind: 'input',
      seq: this.seq,
      clientTick: 0,
      ...input,
    });
  }

  /** 请求上车（服务端校验距离与座位） */
  sendVehicleEnter(vehicleId: string): void {
    if (!this.connected) return;
    this.send({ kind: 'vehicle_enter', vehicleId });
  }

  /** 请求下车 */
  sendVehicleExit(): void {
    if (!this.connected) return;
    this.send({ kind: 'vehicle_exit' });
  }

  /** 载具驾驶输入（仅司机生效；forward/turn ∈ -1..1） */
  sendVehicleDrive(forward: number, turn: number): void {
    if (!this.connected) return;
    this.send({ kind: 'vehicle_drive', forward, turn });
  }

  /** 载具开火（仅司机生效；服务端裁决冷却/伤害并生成弹丸） */
  sendVehicleFire(vehicleId: string, aimYaw: number, aimPitch: number, weaponIndex = 0): void {
    if (!this.connected) return;
    this.send({ kind: 'vehicle_fire', vehicleId, aimYaw, aimPitch, weaponIndex });
  }

  getStats(): NetClientStats {
    const sorted = [...this.rttSamples].sort((a, b) => a - b);
    const rtt = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
    const jitter = sorted.length >= 2 ? sorted[sorted.length - 1] - sorted[0] : null;
    return {
      rttMs: rtt,
      jitterMs: jitter,
      lastPingAt: this.lastPingAt,
      snapshotsReceived: this.snapshotsReceived,
      inputsSent: this.inputsSent,
      seq: this.seq,
      connected: this.connected,
      roomId: this.roomId,
    };
  }

  /** 协议握手是否完成（收到 hello_ack；connect() 只保证传输就绪） */
  get isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
    if (this.joinTimer) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    this.transport.close();
    this.connected = false;
  }

  /** 断线重连：指数退避，重建传输 → 重新握手 → 恢复原房间（服务端按 playerId 恢复战局） */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // 已有重连在调度中
    if (this.reconnectAttempts >= this.options.maxReconnects) {
      this.onDisconnect?.('max_reconnects');
      return;
    }
    const delay = this.options.reconnectBaseDelayMs * 2 ** this.reconnectAttempts;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempts += 1;
    this.transport = this.transportFactory();
    await this.connectTransport();
    this.sendHello();
    if (this.roomId) {
      this.send({ kind: 'join', roomId: this.roomId });
    }
  }

  /** 供测试：推进一次插值（渲染时间 = 最新快照 - 默认延迟） */
  renderNow(): Map<string, InterpolatedPlayer> | null {
    const latest = this.snapshotBuffer.getLatest();
    if (!latest) return null;
    return this.snapshotBuffer.interpolate();
  }

  /**
   * 模拟传输中断（调试/网络面板）：关闭底层连接但不置 manualClose，
   * 触发自动重连流程（与真实断线路径一致）。
   */
  dropConnection(): void {
    this.transport.close();
  }

  private dispatch(bytes: Uint8Array): void {
    let msg: NetworkMessage;
    try {
      msg = decodeMessage(bytes);
    } catch (err) {
      if (err instanceof ProtocolError) {
        this.onError?.(err.code, err.message);
      }
      return;
    }

    switch (msg.kind) {
      case 'hello_ack':
        this.connected = true;
        this.reconnectAttempts = 0; // 握手成功：重连计数复位
        if (this.helloTimer) {
          clearTimeout(this.helloTimer);
          this.helloTimer = null;
        }
        this.helloAttempts = 0;
        break;
      case 'join_ack':
        this.roomId = msg.roomId;
        this.joinedRoom = true;
        if (this.joinTimer) {
          clearTimeout(this.joinTimer);
          this.joinTimer = null;
        }
        this.joinAttempts = 0;
        this.onJoinAck?.(msg);
        break;
      case 'room_state':
        this.phase = msg.phase;
        this.onRoomState?.(msg);
        break;
      case 'game_state':
        this.onGameState?.(msg);
        break;
      case 'vehicle_state':
        this.onVehicleState?.(msg);
        break;
      case 'kill_feed':
        this.onKillFeed?.(msg);
        break;
      case 'snapshot': {
        this.snapshotsReceived += 1;
        this.snapshotBuffer.push({ tick: msg.tick, serverTime: msg.serverTime, players: msg.players });
        if (this.prediction) {
          const own = msg.players.find((p) => p.id === this.playerId);
          if (own) {
            const result = this.prediction.reconcile(own);
            this.onPredictionReconcile?.(result);
          }
        }
        if (this.onSnapshot) {
          const interpolated = this.snapshotBuffer.interpolate();
          if (interpolated) this.onSnapshot(interpolated, this.snapshotBuffer.getLatest()!);
        }
        break;
      }
      case 'pong': {
        const now = this.now();
        const rtt = now - msg.clientTime;
        this.rttSamples.push(rtt);
        if (this.rttSamples.length > 20) this.rttSamples.shift();
        this.lastPingAt = now;
        break;
      }
      case 'error':
        this.onError?.(msg.code, msg.message);
        break;
      case 'player_leave':
        this.onPlayerLeave?.(msg.playerId, msg.reason);
        break;
      default:
        break;
    }
  }

  private send(msg: NetworkMessage): void {
    try {
      this.transport.send(encodeMessage(msg));
    } catch {
      // 传输未就绪时静默丢弃（连接层负责重连）
    }
  }

  private startPing(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    const loop = (): void => {
      // 未连接时继续等待（连接建立慢/重连期间不中断 ping 循环）
      if (this.connected) {
        this.lastPingClientTime = this.now();
        this.send({ kind: 'ping', clientTime: this.lastPingClientTime });
      }
      this.pingTimer = setTimeout(loop, this.options.pingIntervalMs);
    };
    this.pingTimer = setTimeout(loop, this.options.pingIntervalMs);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
