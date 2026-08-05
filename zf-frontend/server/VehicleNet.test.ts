/**
 * 服务端权威载具端到端（阶段 8：游戏内容权威化第二步）。
 * 本地起 ServerApp，真实 WebSocket 客户端：
 *   - 加入即收到 vehicle_state 广播（按 VEHICLE_SPAWN_DEFS 初始状态）；
 *   - 走到载具旁 → vehicle_enter → 服务端校验距离 → driverId 生效；
 *   - vehicle_drive → 载具位置推进 → vehicle_state 反映；
 *   - vehicle_exit → 释放司机位。
 * 真实定时器（不 mock）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ServerApp } from './ServerApp.ts';
import { NetClient, type RawTransport, type NetClientOptions } from '../src/network/NetClient.ts';
import { VEHICLE_SPAWN_DEFS, type VehicleStateMsg } from '../shared/protocol.ts';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('服务端权威载具（阶段 8 端到端）', () => {
  let server: ServerApp;
  let url: string;
  const clients: NetClient[] = [];

  beforeAll(async () => {
    server = new ServerApp({ port: 0, defaultRoomId: 'vehicles', staticLayout: [] });
    url = `ws://127.0.0.1:${await server.start()}`;
  });

  afterAll(() => {
    for (const c of clients) c.disconnect();
    server.stop();
  });

  function makeClient(id: string, options: NetClientOptions = {}): NetClient {
    const client = new NetClient(url, id, id, {
      transportFactory: () => new NodeTransport(url),
      pingIntervalMs: 0,
      ...options,
    });
    clients.push(client);
    return client;
  }

  it('加入即收到 vehicle_state：初始满血、未摧毁、空车、归属与权威定义一致', async () => {
    const a = makeClient('va1');
    const states: VehicleStateMsg[] = [];
    a.onVehicleState = (s) => states.push(s);

    await a.connect();
    a.joinRoom('vehicles');
    await sleep(600); // 覆盖 ≥1 个 15Hz 广播周期

    expect(states.length).toBeGreaterThan(0);
    const s = states[states.length - 1];
    expect(s.vehicles).toHaveLength(VEHICLE_SPAWN_DEFS.length);
    for (let i = 0; i < s.vehicles.length; i++) {
      const v = s.vehicles[i];
      const def = VEHICLE_SPAWN_DEFS[i];
      expect(v.id).toBe(def.id);
      expect(v.type).toBe(def.type);
      expect(v.team).toBe(def.team);
      expect(v.destroyed).toBe(false);
      expect(v.driverId).toBeNull();
      expect(v.health).toBe(v.maxHealth);
    }
  }, 10000);

  it('上车 → 驾驶 → 位置推进 → 下车：driverId 生效并释放', async () => {
    const a = makeClient('va2');
    const states: VehicleStateMsg[] = [];
    a.onVehicleState = (s) => states.push(s);

    await a.connect();
    const ackPromise = new Promise<{ team: number }>((resolve) => {
      a.onJoinAck = (m) => resolve({ team: m.team });
    });
    a.joinRoom('vehicles');
    const ack = await ackPromise;
    await sleep(400);

    // 队伍平衡分配使出生点不确定：team 0 → (-20,-20) 就近 v1(-16,-16)；team 1 → (20,20) 就近 v2(16,16)
    const targetId = ack.team === 0 ? 'v1' : 'v2';
    const sx = ack.team === 0 ? -20 : 20;
    const sz = ack.team === 0 ? -20 : 20;
    const tx = ack.team === 0 ? -16 : 16;
    const tz = ack.team === 0 ? -16 : 16;
    const walkYaw = Math.atan2(tx - sx, -(tz - sz));

    // 走 ~5.7m（30Hz × 40 帧 ≈ 1.32s；不超输入限速 40/s）
    for (let i = 0; i < 40; i++) {
      a.sendInput({ ...IDLE_INPUT, moveForward: true, aimYaw: walkYaw });
      await sleep(33);
    }
    await sleep(200);

    // 上车（半径内）
    a.sendVehicleEnter(targetId);
    await sleep(300);
    let v = states[states.length - 1].vehicles.find((x) => x.id === targetId)!;
    expect(v.driverId).toBe('va2');

    // 驾驶前进 1.3s（jeep 加速度 8 → 位移 ≈ 6.9m）
    const before = { x: v.x, z: v.z };
    for (let i = 0; i < 40; i++) {
      a.sendVehicleDrive(1, 0);
      await sleep(33);
    }
    await sleep(200);
    v = states[states.length - 1].vehicles.find((x) => x.id === targetId)!;
    const moved = Math.hypot(v.x - before.x, v.z - before.z);
    expect(moved).toBeGreaterThan(5);

    // 下车：司机位释放
    a.sendVehicleExit();
    await sleep(300);
    v = states[states.length - 1].vehicles.find((x) => x.id === targetId)!;
    expect(v.driverId).toBeNull();
  }, 15000);

  it('距离过远上车被拒（错误码 vehicle_enter_failed）', async () => {
    const a = makeClient('va3');
    const errors: string[] = [];
    a.onError = (code) => errors.push(code);

    await a.connect();
    a.joinRoom('vehicles');
    await sleep(400);

    // 无论分配到哪个队（(-20,-20) 或 (20,20)），朝 -z 走 3s（≈15.6m）后都远离两辆载具
    for (let i = 0; i < 90; i++) {
      a.sendInput({ ...IDLE_INPUT, moveForward: true, aimYaw: 0 });
      await sleep(33);
    }
    await sleep(200);

    a.sendVehicleEnter('v2');
    await sleep(300);

    expect(errors).toContain('vehicle_enter_failed');
  }, 10000);
});
