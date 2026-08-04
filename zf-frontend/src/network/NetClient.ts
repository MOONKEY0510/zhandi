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
} from '../../shared/protocol.ts';
import { encodeMessage, decodeMessage, ProtocolError } from '../../shared/codec.ts';
import { SnapshotBuffer, type SnapshotData, type InterpolatedPlayer } from './SnapshotBuffer.ts';
import { NetSimulator } from './NetSimulator.ts';

/** 原始传输抽象：发送字节 + 消息回调（NetSimulator 与 WebSocket 都满足） */
export interface RawTransport {
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
  /** 断线重连尝试次数 */
  maxReconnects?: number;
  /** 网络模拟（联调/演示用），包装在真实传输外 */
  simulator?: NetSimulator;
  /** ping 周期 ms */
  pingIntervalMs?: number;
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
  private readonly playerId: string;
  private readonly displayName: string;
  private readonly options: Required<Pick<NetClientOptions, 'maxReconnects' | 'pingIntervalMs'>>;
  private readonly simulator: NetSimulator | null;

  readonly snapshotBuffer = new SnapshotBuffer();
  private seq = 0;
  private connected = false;
  private roomId: string | null = null;
  private phase: RoomState['phase'] | null = null;

  private rttSamples: number[] = [];
  private lastPingAt = 0;
  private lastPingClientTime = 0;
  private snapshotsReceived = 0;
  private inputsSent = 0;

  onSnapshot: ((players: Map<string, InterpolatedPlayer>, snapshot: SnapshotData) => void) | null = null;
  onRoomState: ((state: RoomState) => void) | null = null;
  onJoinAck: ((ack: JoinAck) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;

  constructor(url: string, playerId: string, displayName: string, options: NetClientOptions = {}) {
    this.playerId = playerId;
    this.displayName = displayName;
    this.options = {
      maxReconnects: options.maxReconnects ?? 3,
      pingIntervalMs: options.pingIntervalMs ?? 1000,
    };
    this.simulator = options.simulator ?? null;

    const raw = new WebSocketTransport(url);
    if (this.simulator) {
      // 模拟器包装出站方向：客户端发送 → 模拟延迟/丢包 → 真实 WebSocket
      this.simulator.onReceive = (bytes) => raw.send(bytes);
      this.transport = {
        send: (bytes) => this.simulator!.send(bytes),
        onMessage: (cb) => raw.onMessage(cb),
        onClose: (cb) => raw.onClose(cb),
        close: () => raw.close(),
      };
    } else {
      this.transport = raw;
    }
  }

  /** 供测试注入假传输（绕过 WebSocket） */
  static withTransport(transport: RawTransport, playerId: string, displayName: string, options: NetClientOptions = {}): NetClient {
    const client = new NetClient('ws://fake', playerId, displayName, options);
    client.transport = transport;
    return client;
  }

  async connect(): Promise<void> {
    await (this.transport as WebSocketTransport).connect?.();
    this.transport.onMessage((bytes) => this.dispatch(bytes));
    this.transport.onClose((reason) => {
      this.connected = false;
      this.onDisconnect?.(reason);
    });
    this.send({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: this.playerId, displayName: this.displayName });
    this.startPing();
  }

  joinRoom(roomId: string): void {
    this.send({ kind: 'join', roomId });
  }

  /** 发送移动/开火输入（自动附加 seq 与本地 tick） */
  sendInput(input: Omit<PlayerInput, 'kind' | 'seq' | 'clientTick'>): void {
    if (!this.connected) return;
    this.seq += 1;
    this.inputsSent += 1;
    this.send({
      kind: 'input',
      seq: this.seq,
      clientTick: 0,
      ...input,
    });
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

  disconnect(): void {
    this.transport.close();
    this.connected = false;
  }

  /** 供测试：推进一次插值（渲染时间 = 最新快照 - 默认延迟） */
  renderNow(): Map<string, InterpolatedPlayer> | null {
    const latest = this.snapshotBuffer.getLatest();
    if (!latest) return null;
    return this.snapshotBuffer.interpolate();
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
        break;
      case 'join_ack':
        this.roomId = msg.roomId;
        this.onJoinAck?.(msg);
        break;
      case 'room_state':
        this.phase = msg.phase;
        this.onRoomState?.(msg);
        break;
      case 'snapshot':
        this.snapshotsReceived += 1;
        this.snapshotBuffer.push({ tick: msg.tick, serverTime: msg.serverTime, players: msg.players });
        if (this.onSnapshot) {
          const interpolated = this.snapshotBuffer.interpolate();
          if (interpolated) this.onSnapshot(interpolated, this.snapshotBuffer.getLatest()!);
        }
        break;
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
        // 阶段 8 后续：从插值结果中移除
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
    const loop = (): void => {
      if (!this.connected) return;
      this.lastPingClientTime = this.now();
      this.send({ kind: 'ping', clientTime: this.lastPingClientTime });
      setTimeout(loop, this.options.pingIntervalMs);
    };
    setTimeout(loop, this.options.pingIntervalMs);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
