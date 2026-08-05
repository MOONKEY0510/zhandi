/**
 * Headless 虚拟玩家（阶段 8 压测/soak）。
 * 复用 NetClient 全协议栈：握手 → 加入 → 按设定频率发送随机输入 → 统计快照/错误/RTT。
 * 可挂 NetSimulator 模拟真实网络条件（延迟/抖动/丢包），用于 16v16 验收压测。
 */
import { NetClient, type NetClientOptions } from '../src/network/NetClient.ts';
import { NetSimulator, type NetSimOptions } from '../src/network/NetSimulator.ts';
import { NodeTransport } from './NodeTransport.ts';

export interface HeadlessOptions {
  url: string;
  playerId: string;
  displayName?: string;
  roomId?: string;
  /** 网络模拟条件（可选） */
  sim?: NetSimOptions;
  /** 输入发送频率 Hz（默认 30，接近真实客户端） */
  inputRateHz?: number;
  /** 每 tick 开火概率（默认 0.2） */
  fireChance?: number;
}

const IDLE_INPUT = {
  moveForward: false,
  moveBackward: false,
  moveLeft: false,
  moveRight: false,
  sprint: false,
  fire: false,
  aimYaw: 0,
  aimPitch: 0,
};

export class HeadlessClient {
  readonly client: NetClient;
  readonly simulator: NetSimulator | null;
  /** 入站模拟器（与出站对称，模拟服务器 → 客户端方向） */
  readonly inboundSimulator: NetSimulator | null;
  /** 收到快照数 */
  snapshots = 0;
  /** 服务器错误码列表（正常行为下应为空） */
  errors: string[] = [];
  joined = false;
  /** 最新快照 tick */
  lastTick = -1;
  /** 快照 tick 间隔（丢包检测：> 2 表示中间有快照丢失） */
  tickGaps: number[] = [];
  private seq = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private moveTimer: ReturnType<typeof setInterval> | null = null;
  private move = { f: false, b: false, l: false, r: false, sprint: false };

  constructor(private readonly opts: HeadlessOptions) {
    const { url, playerId, displayName, sim } = opts;
    const options: NetClientOptions = {
      pingIntervalMs: 200,
      maxReconnects: 0,
    };
    if (sim) {
      this.simulator = new NetSimulator(sim);
      this.inboundSimulator = new NetSimulator(sim);
    } else {
      this.simulator = null;
      this.inboundSimulator = null;
    }
    options.transportFactory = () => {
      const raw = new NodeTransport(url);
      if (this.simulator && this.inboundSimulator) {
        // 双向网络模拟：出站（发送 → 延迟/丢包 → 真实 WebSocket）与入站（真实接收 → 延迟/丢包 → 客户端）对称
        this.simulator.onReceive = (bytes) => raw.send(bytes);
        const inSim = this.inboundSimulator;
        return {
          connect: () => raw.connect(),
          send: (bytes) => this.simulator!.send(bytes),
          onMessage: (cb) => {
            inSim.onReceive = (bytes) => cb(bytes);
            raw.onMessage((bytes) => inSim.send(bytes));
          },
          onClose: (cb) => raw.onClose(cb),
          close: () => raw.close(),
        };
      }
      return raw;
    };
    this.client = new NetClient(url, playerId, displayName ?? playerId, options);
    this.client.onJoinAck = () => {
      this.joined = true;
    };
    this.client.onError = (code) => this.errors.push(code);
    this.client.onSnapshot = (players) => {
      this.snapshots += 1;
      const tick = this.client.snapshotBuffer.getLatest()?.tick ?? -1;
      if (this.lastTick >= 0 && tick > this.lastTick) {
        this.tickGaps.push(tick - this.lastTick);
      }
      this.lastTick = tick;
      void players;
    };
  }

  /** 连接并加入房间，等待握手与入房完成后启动随机输入循环 */
  async start(): Promise<void> {
    await this.client.connect();
    // 等待协议握手完成（hello_ack），再发 join —— connect() 只保证传输就绪，
    // 丢包网络下 hello 可能重发，join 抢跑会触发服务器 not_hello
    const handshakeDeadline = Date.now() + 8000;
    while (!this.client.isConnected && Date.now() < handshakeDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.client.joinRoom(this.opts.roomId ?? 'load');
    // 等待 join_ack（双向网络模拟下握手+加入需 200ms+；丢包有 join 重试兜底）
    const deadline = Date.now() + 8000;
    while (this.client.getStats().roomId === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const rate = this.opts.inputRateHz ?? 30;
    const interval = Math.max(16, Math.round(1000 / rate));
    this.inputTimer = setInterval(() => this.tickInput(), interval);
    this.moveTimer = setInterval(() => this.randomMove(), 250);
  }

  stop(): void {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.moveTimer) clearInterval(this.moveTimer);
    this.inputTimer = null;
    this.moveTimer = null;
    this.client.disconnect();
    this.simulator?.dispose();
    this.inboundSimulator?.dispose();
  }

  getStats() {
    return this.client.getStats();
  }

  get playerId(): string {
    return this.opts.playerId;
  }

  /** 丢包导致的快照缺口数（tick 间隔 > 2） */
  get lostSnapshots(): number {
    return this.tickGaps.filter((g) => g > 2).length;
  }

  private randomMove(): void {
    const r = Math.random();
    this.move = {
      f: r < 0.5,
      b: r >= 0.5 && r < 0.6,
      l: r >= 0.6 && r < 0.8,
      r: r >= 0.8,
      sprint: r < 0.3,
    };
  }

  private tickInput(): void {
    this.seq += 1;
    this.client.sendInput({
      ...IDLE_INPUT,
      moveForward: this.move.f,
      moveBackward: this.move.b,
      moveLeft: this.move.l,
      moveRight: this.move.r,
      sprint: this.move.sprint,
      fire: Math.random() < (this.opts.fireChance ?? 0.2),
      aimYaw: Math.random() * Math.PI * 2 - Math.PI,
      aimPitch: (Math.random() - 0.5) * 1.4,
    });
  }
}
