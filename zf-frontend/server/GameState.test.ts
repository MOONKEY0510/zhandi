/**
 * 服务端权威游戏状态端到端（阶段 8：征服规则权威化）。
 * 本地起 ServerApp，真实 WebSocket 双客户端：
 *   - 加入即开局：game_state 广播（满兵力、据点中立、phase=started）；
 *   - 击杀闭环：队 0 玩家瞄准队 1 玩家连射 → 服务端裁决死亡 → 扣兵力 + 记击杀 → game_state 反映。
 * 真实定时器（不 mock）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ServerApp } from './ServerApp.ts';
import { NetClient, type RawTransport, type NetClientOptions } from '../src/network/NetClient.ts';
import { CONQUEST_OBJECTIVE_DEFS, type JoinAck, type ServerGameState } from '../shared/protocol.ts';

/** Node（ws 包）传输：实现 RawTransport */
class NodeTransport implements RawTransport {
  private ws: WebSocket;
  private msgCb: ((bytes: Uint8Array) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (event) => {
      this.msgCb?.(new Uint8Array(event.data as ArrayBuffer));
    };
    this.ws.onclose = () => this.closeCb?.('closed');
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === this.ws.OPEN) {
        resolve();
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket 连接失败'));
    });
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(bytes);
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.ws.close();
  }
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 等待 join_ack（先设置回调再 joinRoom） */
function waitJoinAck(client: NetClient): Promise<JoinAck> {
  return new Promise((resolve) => {
    client.onJoinAck = (ack) => resolve(ack);
  });
}

describe('服务端权威游戏状态（阶段 8 征服规则端到端）', () => {
  let server: ServerApp;
  let url: string;
  const clients: NetClient[] = [];
  const states: ServerGameState[] = [];

  beforeAll(async () => {
    server = new ServerApp({ port: 0, defaultRoomId: 'gs' });
    const port = await server.start();
    url = `ws://127.0.0.1:${port}`;
  }, 10000);

  afterAll(() => {
    for (const client of clients) client.disconnect();
    server.stop();
  });

  function makeClient(playerId: string, options: NetClientOptions = {}): NetClient {
    const client = new NetClient(url, playerId, `玩家${playerId}`, {
      pingIntervalMs: 100,
      maxReconnects: 0,
      ...options,
      transportFactory: options.transportFactory ?? (() => new NodeTransport(url)),
    });
    client.onGameState = (state) => states.push(state);
    clients.push(client);
    return client;
  }

  it('加入即开局：game_state 广播满兵力、据点中立、phase=started', async () => {
    const a = makeClient('ga1');
    await a.connect();
    a.joinRoom('gs');
    await sleep(900); // 覆盖 ≥1 个 2Hz 广播周期 + 加入余量

    expect(states.length).toBeGreaterThan(0);
    const s = states[states.length - 1];
    expect(s.phase).toBe('started');
    // 开局所有据点中立 → 双方都"无据点"在流失（2/s），0.9s 内各流失 ~2（含浮点/时序误差，给宽余量）
    expect(s.tickets[0]).toBeGreaterThanOrEqual(290);
    expect(s.tickets[0]).toBeLessThanOrEqual(300);
    expect(s.tickets[1]).toBeGreaterThanOrEqual(290);
    expect(s.tickets[1]).toBeLessThanOrEqual(300);
    expect(s.maxTickets).toBe(300);
    expect(s.kills).toEqual([0, 0]);
    expect(s.objectives).toHaveLength(3);
    expect(s.objectives.every((o) => o.owner === 2)).toBe(true);
    expect(s.winner).toBeNull();
    // 同源防漂移：服务端广播的据点 id 集合 = 客户端场景视觉用的权威布局（联网场景据此重定位）
    const defIds = new Set(CONQUEST_OBJECTIVE_DEFS.map((d) => d.id));
    expect(s.objectives.map((o) => o.id).sort()).toEqual([...defIds].sort());
  }, 10000);

  it('击杀闭环：队 0 瞄准队 1 连射 → 死亡扣兵力 + 击杀计数 → game_state 反映', async () => {
    states.length = 0;
    const a = makeClient('ga2');
    const b = makeClient('gb2');
    await a.connect();
    await b.connect();

    const ackAPromise = waitJoinAck(a);
    const ackBPromise = waitJoinAck(b);
    a.joinRoom('gs');
    b.joinRoom('gs');
    const [ackA, ackB] = await Promise.all([ackAPromise, ackBPromise]);
    expect(ackA.team).not.toBe(ackB.team); // 平衡分配：不同队

    // shooter 取队 0，target 取队 1（出生点：队 0 = (-20,-20)，队 1 = (20,20)）
    const shooterIsA = ackA.team === 0;
    const shooter = shooterIsA ? a : b;
    const shooterTeam = shooterIsA ? ackA.team : ackB.team;
    const targetTeam = shooterIsA ? ackB.team : ackA.team;

    const spawnX = (team: 0 | 1): number => (team === 0 ? -20 : 20);
    const sx = spawnX(shooterTeam);
    const sz = sx;
    const tx = spawnX(targetTeam);
    const tz = tx;
    const dx = tx - sx;
    const dz = tz - sz;
    const dist = Math.hypot(dx, dz);
    // 服务端 forward = (sin(yaw), -cos(yaw))；pitch 下压使弹道在目标躯干高度穿过：
    // 飞行时间 t = dist/speed，垂直位移 Δy = -1.1m，sin(pitch) = Δy / dist
    const yaw = Math.atan2(dx, -dz);
    const pitch = Math.asin((0.5 - 1.6) / dist);

    // 连射 3.5 秒（弹道飞行 ~0.94s，4 发击杀 → 余量充足）
    const start = performance.now();
    while (performance.now() - start < 3500) {
      shooter.sendInput({ ...IDLE_INPUT, fire: true, aimYaw: yaw, aimPitch: pitch });
      await sleep(30);
    }
    await sleep(600); // 等最后一批 game_state 与弹道结算

    expect(states.length).toBeGreaterThan(0);
    const last = states[states.length - 1];
    expect(last.kills[shooterTeam]).toBeGreaterThanOrEqual(1);
    expect(last.tickets[targetTeam]).toBeLessThan(300);
  }, 20000);
});
