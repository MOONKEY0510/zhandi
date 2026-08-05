/**
 * 网络对战客户端（阶段 8 第九批：GameScene 网络接入）。
 * 封装 NetClient 为 GameScene 可用的桥接层：
 *   - connect(url, roomId, playerId) → 握手 + 加入房间；
 *   - sendInput() 发送服务端权威输入序列（seq 由 NetClient 自动附加）；
 *   - 快照插值结果经 RemotePlayerView 维护，自动排除本地玩家；
 *   - player_leave / 断线 / 错误通过回调上报。
 * 纯逻辑、无 Three.js 依赖，可独立单测（注入假传输）。
 */

import { NetClient, type NetClientStats, type RawTransport } from './NetClient.ts';
import type { PlayerInput, ServerGameState } from '../../shared/protocol.ts';
import type { InterpolatedPlayer } from './SnapshotBuffer.ts';
import { RemotePlayerView } from './RemotePlayerView.ts';
import type { NetSimulator } from './NetSimulator.ts';
import type { ClientPrediction } from './ClientPrediction.ts';

/** 客户端输入子集：与 PlayerInput 一致但省略协议字段（seq/clientTick 由 NetClient 填充） */
export type ClientInput = Omit<PlayerInput, 'kind' | 'seq' | 'clientTick'>;

export interface NetworkGameClientOptions {
  /** 断线重连尝试次数（0 = 不重连） */
  maxReconnects?: number;
  /** ping 周期 ms */
  pingIntervalMs?: number;
  /** 网络模拟（联调/演示用） */
  simulator?: NetSimulator;
  /** 自定义传输工厂（测试/同构环境：每次重连新建连接） */
  transportFactory?: () => RawTransport;
  /**
   * 本地预测（服务端权威移动）：NetClient 发送输入时自动推进本地预测，
   * 快照到达时按服务端 ackSeq 校正（平滑收敛/硬校正），GameScene 据此回写本地渲染位置。
   */
  prediction?: ClientPrediction;
}

export class NetworkGameClient {
  private client: NetClient | null = null;
  private ownId = '';

  /** 远端玩家渲染视图（已排除本地玩家） */
  readonly remotePlayers = new RemotePlayerView();

  onPlayerLeave: ((playerId: string, reason: 'left' | 'timeout' | 'kicked') => void) | null = null;
  onJoinAck: ((ack: { roomId: string; team: 0 | 1; slot: number; resumed: boolean }) => void) | null = null;
  onRoomState: ((state: { roomId: string; phase: string; players: unknown[] }) => void) | null = null;
  onGameState: ((state: ServerGameState) => void) | null = null;
  onError: ((code: string, message: string) => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;
  /** 每次快照校正本人预测后回调（统计/调试用） */
  onPredictionReconcile: ((result: unknown) => void) | null = null;

  /** 建立连接并加入房间：hello（重试）→ join（重试）；返回后传输就绪，join 结果走 onJoinAck */
  async connect(
    url: string,
    roomId: string,
    playerId: string,
    displayName: string,
    options: NetworkGameClientOptions = {},
  ): Promise<void> {
    this.ownId = playerId;
    this.client = new NetClient(url, playerId, displayName, {
      maxReconnects: options.maxReconnects,
      pingIntervalMs: options.pingIntervalMs,
      simulator: options.simulator,
      transportFactory: options.transportFactory,
      prediction: options.prediction,
    });
    this.client.onSnapshot = (players: Map<string, InterpolatedPlayer>) => {
      // 排除本地玩家：本地渲染由本地模拟/预测驱动，服务端回声不参与远端实体渲染
      const remote = new Map<string, InterpolatedPlayer>();
      for (const [id, p] of players) {
        if (id !== this.ownId) remote.set(id, p);
      }
      this.remotePlayers.apply(remote);
    };
    this.client.onPlayerLeave = (playerId, reason) => {
      this.remotePlayers.remove(playerId);
      this.onPlayerLeave?.(playerId, reason);
    };
    this.client.onJoinAck = (ack) => this.onJoinAck?.(ack);
    this.client.onRoomState = (state) =>
      this.onRoomState?.({ roomId: state.roomId, phase: state.phase, players: state.players });
    this.client.onGameState = (state) => this.onGameState?.(state);
    this.client.onError = (code, message) => this.onError?.(code, message);
    this.client.onDisconnect = (reason) => this.onDisconnect?.(reason);
    this.client.onPredictionReconcile = (result) => this.onPredictionReconcile?.(result);

    await this.client.connect();
    this.client.joinRoom(roomId);
  }

  /** 发送输入（自动附加 seq 与本地 tick；未连接时静默丢弃） */
  sendInput(input: ClientInput): void {
    this.client?.sendInput(input);
  }

  getStats(): NetClientStats | null {
    return this.client?.getStats() ?? null;
  }

  get isConnected(): boolean {
    return this.client?.isConnected ?? false;
  }

  /** 主动断开：不再重连，清空远端视图 */
  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
    this.remotePlayers.clear();
  }
}
