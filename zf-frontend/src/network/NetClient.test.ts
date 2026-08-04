import { describe, it, expect } from 'vitest';
import { NetClient, type RawTransport } from './NetClient.ts';
import { ClientPrediction } from './ClientPrediction.ts';
import { encodeMessage, decodeMessage } from '../../shared/codec.ts';
import { PROTOCOL_VERSION, TICK_RATE_HZ, PLAYER_WALK_SPEED, type Snapshot } from '../../shared/protocol.ts';

/** 内存假传输：记录发出的消息，允许测试注入服务端回复 */
class FakeTransport implements RawTransport {
  sent: Uint8Array[] = [];
  private msgCb: ((bytes: Uint8Array) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;
  closed = false;

  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.closed = true;
    this.closeCb?.('closed');
  }

  /** 测试注入：模拟服务器发来的消息 */
  inject(msg: Parameters<typeof encodeMessage>[0]): void {
    this.msgCb?.(encodeMessage(msg));
  }

  decodeLast(): ReturnType<typeof decodeMessage> | null {
    if (this.sent.length === 0) return null;
    return decodeMessage(this.sent[this.sent.length - 1]);
  }
}

describe('NetClient（阶段 8 协议客户端）', () => {
  it('connect 发送 hello 握手', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    const msg = transport.decodeLast()!;
    expect(msg.kind).toBe('hello');
    if (msg.kind === 'hello') {
      expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(msg.playerId).toBe('p1');
    }
  });

  it('hello_ack 后 connected = true', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    transport.inject({ kind: 'hello_ack', protocolVersion: PROTOCOL_VERSION, serverTick: 1 });
    expect(client.getStats().connected).toBe(true);
  });

  it('join 后收到 join_ack 记录房间', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    client.joinRoom('r1');
    expect(transport.decodeLast()!.kind).toBe('join');
    transport.inject({ kind: 'join_ack', roomId: 'r1', playerId: 'p1', team: 0, slot: 1, resumed: false });
    expect(client.getStats().roomId).toBe('r1');
  });

  it('sendInput 附加单调递增 seq', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    // 握手完成前 sendInput 会被丢弃（未连接保护），先注入 hello_ack 建立连接
    transport.inject({ kind: 'hello_ack', protocolVersion: PROTOCOL_VERSION, serverTick: 1 });
    client.sendInput({ moveForward: true, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, fire: false, aimYaw: 0, aimPitch: 0 });
    client.sendInput({ moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, fire: false, aimYaw: 0, aimPitch: 0 });
    expect(client.getStats().inputsSent).toBe(2);
    expect(client.getStats().seq).toBe(2);
  });

  it('快照进入缓冲并可插值', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    const snapA: Snapshot = {
      kind: 'snapshot', tick: 1, serverTime: 1000,
      players: [{ id: 'p9', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true }],
    };
    const snapB: Snapshot = {
      kind: 'snapshot', tick: 2, serverTime: 1066,
      players: [{ id: 'p9', x: 10, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true }],
    };
    transport.inject(snapA);
    transport.inject(snapB);
    expect(client.getStats().snapshotsReceived).toBe(2);
    // 默认渲染延迟 100ms → 渲染时间 966 < 快照1(1000) → 早于缓冲 → 冻结最早帧
    const interpolated = client.renderNow();
    expect(interpolated!.get('p9')!.x).toBe(0);
    // 明确指定渲染时间验证插值
    const atMiddle = client.snapshotBuffer.interpolate(1033)!;
    expect(atMiddle.get('p9')!.x).toBeCloseTo(5, 5);
  });

  it('pong 计算 RTT', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    const before = performance.now();
    transport.inject({ kind: 'pong', clientTime: before, serverTime: before });
    const stats = client.getStats();
    expect(stats.rttMs).not.toBeNull();
    expect(stats.rttMs).toBeGreaterThanOrEqual(0);
  });

  it('错误消息触发 onError', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    const captured: { code?: string } = {};
    client.onError = (code, _message) => { captured.code = code; };
    transport.inject({ kind: 'error', code: 'room_full', message: '房间已满' });
    expect(captured.code).toBe('room_full');
  });

  it('挂载预测：sendInput 推进本地预测，快照按 ackSeq 校正本人', async () => {
    const transport = new FakeTransport();
    const prediction = new ClientPrediction({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true });
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0, prediction });
    await client.connect();
    transport.inject({ kind: 'hello_ack', protocolVersion: PROTOCOL_VERSION, serverTick: 1 });
    const input = { moveForward: true, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, fire: false, aimYaw: 0, aimPitch: 0 };
    // 连续 10 tick 输入 → 本地预测推进 10 帧（误差 10×5.2/30 ≈ 1.73m > 0.5m 阈值）
    for (let i = 0; i < 10; i++) client.sendInput(input);
    expect(prediction.state.z).toBeCloseTo(-10 * PLAYER_WALK_SPEED / TICK_RATE_HZ, 10);
    // 快照校正：服务端确认 seq 10，位置在原点 → 硬校正回滚
    let reconcile: ReturnType<ClientPrediction['reconcile']> | null = null;
    client.onPredictionReconcile = (r) => { reconcile = r; };
    transport.inject({
      kind: 'snapshot', tick: 10, serverTime: 1000,
      players: [{ id: 'p1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 10 }],
    });
    expect(reconcile).not.toBeNull();
    expect(reconcile!.snapped).toBe(true);
    expect(prediction.state.z).toBeCloseTo(0, 10);
    expect(prediction.pendingInputs.length).toBe(0);
  });

  it('disconnect 关闭传输', async () => {
    const transport = new FakeTransport();
    const client = NetClient.withTransport(transport, 'p1', '玩家一', { pingIntervalMs: 0 });
    await client.connect();
    client.disconnect();
    expect(transport.closed).toBe(true);
  });
});
