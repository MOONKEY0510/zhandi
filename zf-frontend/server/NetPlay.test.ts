/**
 * 端到端回环集成验证（阶段 8 验收缩小版）。
 * 本地起权威 ServerApp（随机端口），双 NetClient 经真实 WebSocket（ws 包）连接，
 * 验证：快照互见一致性、输入速率限制裁决、断线自动重连恢复战局、RTT 统计。
 * 真实定时器（不 mock），覆盖客户端预测/插值之外的全链路互操作。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ServerApp } from './ServerApp.ts';
import { NetClient, type RawTransport, type NetClientOptions } from '../src/network/NetClient.ts';
import { ClientPrediction } from '../src/network/ClientPrediction.ts';
import { NetSimulator } from '../src/network/NetSimulator.ts';
import type { JoinAck } from '../shared/protocol.ts';

/** Node（ws 包）传输：实现 RawTransport，connect 等待 onopen */
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

describe('NetPlay 端到端回环（阶段 8 集成验证）', () => {
  let server: ServerApp;
  let url: string;
  const clients: NetClient[] = [];

  beforeAll(async () => {
    server = new ServerApp({ port: 0, defaultRoomId: 'netplay' });
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
    clients.push(client);
    return client;
  }

  it('双客户端互见：A 前进，B 快照中看到 A 位置推进（一致性）', async () => {
    const a = makeClient('a1');
    const b = makeClient('b1');
    const seenA: { x: number; z: number }[] = [];
    b.onSnapshot = (players) => {
      const pa = players.get('a1');
      if (pa) seenA.push({ x: pa.x, z: pa.z });
    };

    await a.connect();
    await b.connect();
    a.joinRoom('netplay');
    b.joinRoom('netplay');
    await sleep(250); // 加入 + 首快照

    // A 以 ~30Hz 持续前进 600ms（服务端速度 5.2 m/s → 理论位移 ≈ 3.1m）
    const start = performance.now();
    while (performance.now() - start < 600) {
      a.sendInput({ ...IDLE_INPUT, moveForward: true });
      await sleep(30);
    }
    await sleep(200); // 等快照到达 B

    expect(seenA.length).toBeGreaterThan(0);
    const last = seenA[seenA.length - 1];
    // A 出生点 team 0 = (-20, -20)，前进后至少位移 1m（含插值延迟保守下限）
    expect(Math.hypot(last.x - -20, last.z - -20)).toBeGreaterThan(1);
  }, 15000);

  it('输入速率限制：1 秒内超发被服务器拒绝（input_rate_limited）', async () => {
    const a = makeClient('a2');
    const errors: string[] = [];
    a.onError = (code) => errors.push(code);

    await a.connect();
    a.joinRoom('netplay');
    await sleep(200);

    // 限速 40/s：立即连发 60 个输入 → 超出滑动窗口
    for (let i = 0; i < 60; i += 1) {
      a.sendInput({ ...IDLE_INPUT, moveForward: true });
    }
    await sleep(300);

    expect(errors).toContain('input_rate_limited');
  }, 15000);

  it('断线自动重连并恢复战局（join_ack.resumed = true 且重连后继续收快照）', async () => {
    const a = makeClient('a3', { maxReconnects: 3, reconnectBaseDelayMs: 200 });
    const joins: JoinAck[] = [];
    let snapshotsAfterReconnect = 0;
    a.onJoinAck = (ack) => joins.push(ack);
    a.onSnapshot = () => {
      if (joins.length >= 2) snapshotsAfterReconnect += 1;
    };

    await a.connect();
    a.joinRoom('netplay');
    await sleep(250);
    expect(joins.length).toBe(1);
    expect(joins[0].resumed).toBe(false);

    // 模拟意外断线（不走主动 disconnect）：触发自动重连
    a.dropConnection();
    await sleep(1200); // 退避 200ms + 重连握手 + 恢复房间 + 快照

    expect(joins.length).toBe(2);
    expect(joins[1].resumed).toBe(true); // RoomManager 断线保留，战局恢复
    expect(snapshotsAfterReconnect).toBeGreaterThan(0); // 重连后继续收到快照
  }, 15000);

  it('网络模拟包装下 RTT 统计反映双向延迟（60ms → ≥ 40ms）', async () => {
    const raw = new NodeTransport(url);
    const sim = new NetSimulator({ latencyMs: 60 });
    const inSim = new NetSimulator({ latencyMs: 60 });
    sim.onReceive = (bytes) => raw.send(bytes);
    const transport: RawTransport = {
      connect: () => raw.connect(),
      send: (bytes) => sim.send(bytes),
      onMessage: (cb) => {
        inSim.onReceive = (bytes) => cb(bytes);
        raw.onMessage((bytes) => inSim.send(bytes));
      },
      onClose: (cb) => raw.onClose(cb),
      close: () => raw.close(),
    };
    const a = makeClient('a4', { transportFactory: () => transport, pingIntervalMs: 100 });

    await a.connect();
    a.joinRoom('netplay');
    await sleep(700); // 数个 ping 周期

    const stats = a.getStats();
    expect(stats.rttMs).not.toBeNull();
    expect(stats.rttMs!).toBeGreaterThanOrEqual(40);
    expect(stats.snapshotsReceived).toBeGreaterThan(0);
    sim.dispose();
  }, 15000);

  it('快照 ackSeq 生效：服务端确认并应用输入后，客户端预测缓冲被清理', async () => {    // A 挂本地预测（初始 = 队 0 出生点 (-20,-20)）
    const prediction = new ClientPrediction({ x: -20, y: 0, z: -20, yaw: 0, pitch: 0, health: 100, alive: true });
    const a = makeClient('a5', { prediction, pingIntervalMs: 0 });
    const ackedCounts: number[] = [];
    a.onPredictionReconcile = (r) => ackedCounts.push(r.acked);

    await a.connect();
    a.joinRoom('netplay');
    await sleep(250);

    // 以 ~60Hz 发送 20 个前进输入（预测缓冲随发送累积；期间快照已开始 ack 部分输入）
    for (let i = 0; i < 20; i += 1) {
      a.sendInput({ ...IDLE_INPUT, moveForward: true });
      await sleep(16);
    }
    expect(prediction.pendingInputs.length).toBeGreaterThan(0); // 预测已挂载并推进

    // 等服务端应用全部输入 → 快照携带 lastAppliedSeq → 客户端 reconcile 按 ackSeq 清理缓冲
    await sleep(800);

    expect(prediction.pendingInputs.length).toBe(0); // 全部输入已被 ack 丢弃
    expect(ackedCounts.some((n) => n > 0)).toBe(true); // 至少一次快照确认了输入
    // 预测位移 ≈ 服务端同模型推进（20 × 16ms × 5.2m/s ≈ 1.7m），未被硬校正（无碰撞模型偏差）
    const final = prediction.state;
    expect(Math.hypot(final.x - -20, final.z - -20)).toBeGreaterThan(1);
  }, 15000);

  it('载具武器闭环：A 驾驶吉普（队0）朝 B（队1）开火 → B 血量下降（载具机枪命中玩家）', async () => {
    const a = makeClient('vfire-a');
    const b = makeClient('vfire-b');
    const bHealths: number[] = [];
    b.onSnapshot = (players) => {
      const me = players.get('vfire-b');
      if (me) bHealths.push(me.health);
    };

    await a.connect();
    await b.connect();
    a.joinRoom('netplay');
    b.joinRoom('netplay');
    await sleep(300);

    // B（出生 20,20）沿 -z 直行 3.9s（20.3m）→ (20,-0.3)，避开 v1→v2 对角线（v2 会挡弹道）
    const mvStart = performance.now();
    while (performance.now() - mvStart < 3900) {
      b.sendInput({ ...IDLE_INPUT, moveForward: true });
      await sleep(30);
    }
    await sleep(200);

    // A 上 v1（吉普，队0，位于 -16,-16；A 出生点 -20,-20 距其 5.7m < 8m）
    a.sendVehicleEnter('v1');
    await sleep(300);

    // 朝 B 位置 (20,-0.3) 射击：yaw = atan2(36, -15.7) ≈ 1.984。
    // 全量并行（机器高负载）下 B 的 3.9s 移动窗口可能位移不足，扇形扫射加宽覆盖
    // [1.85, 2.40]（对应 B 移动 0%–100% 的 yaw 范围），避免 flaky。
    for (let i = 0; i < 24; i += 1) {
      const yaw = 1.85 + (i / 23) * 0.55;
      a.sendVehicleFire('v1', yaw, 0, 0);
      await sleep(160); // > 机枪冷却 140ms
    }
    await sleep(500);

    expect(bHealths.some((h) => h < 100)).toBe(true); // 载具机枪打中 B 掉血
    // 释放 v1 司机位（供后续用例复用）
    a.sendVehicleExit();
    await sleep(200);
  }, 20000);

  it('载具武器闭环：B 坦克主炮摧毁 A 的吉普 → A 被清出司机位（vehicle_state 权威广播）', async () => {
    const a = makeClient('vkill-a');
    const b = makeClient('vkill-b');
    const v1States: { destroyed: boolean; driverId: string | null }[] = [];
    a.onVehicleState = (state) => {
      const v1 = state.vehicles.find((v) => v.id === 'v1');
      if (v1) v1States.push({ destroyed: v1.destroyed, driverId: v1.driverId });
    };

    await a.connect();
    await b.connect();
    a.joinRoom('netplay');
    b.joinRoom('netplay');
    await sleep(300);

    // A 上 v1（吉普 200 血），B 上 v2（坦克 主炮 120 伤，位于 16,16；B 出生点 20,20 距其 5.7m）
    a.sendVehicleEnter('v1');
    b.sendVehicleEnter('v2');
    await sleep(300);

    // 从 v2(16,16) 朝 v1(-16,-16)：方向 yaw = atan2(-32, 32) = -π/4
    const yaw = Math.atan2(-32, 32);
    b.sendVehicleFire('v2', yaw, 0, 0); // 第 1 炮：200 - 120 = 80
    await sleep(2100); // > 坦克主炮冷却 1800ms
    b.sendVehicleFire('v2', yaw, 0, 0); // 第 2 炮：摧毁
    await sleep(800);

    const last = v1States[v1States.length - 1];
    expect(last).toBeDefined();
    expect(last.destroyed).toBe(true); // 吉普被坦克主炮摧毁
    expect(last.driverId).toBeNull(); // A 被清出司机位（被动下车）
    // 中途应观察到健康状态（第 1 炮后 health 80 → 未摧毁）
    expect(v1States.some((s) => !s.destroyed)).toBe(true);
  }, 20000);
});
