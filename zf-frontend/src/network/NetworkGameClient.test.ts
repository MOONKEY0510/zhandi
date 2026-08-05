import { describe, it, expect } from 'vitest';
import { NetworkGameClient } from './NetworkGameClient.ts';
import type { RawTransport } from './NetClient.ts';
import { encodeMessage, decodeMessage } from '../../shared/codec.ts';
import { PROTOCOL_VERSION, type Snapshot } from '../../shared/protocol.ts';

/** 内存假传输：记录发出的消息，允许测试注入服务端回复（与 NetClient.test 同构） */
class FakeTransport implements RawTransport {
  sent: Uint8Array[] = [];
  private msgCb: ((bytes: Uint8Array) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;

  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.closeCb?.('closed');
  }

  inject(msg: Parameters<typeof encodeMessage>[0]): void {
    this.msgCb?.(encodeMessage(msg));
  }

  decodeLast(): ReturnType<typeof decodeMessage> | null {
    if (this.sent.length === 0) return null;
    return decodeMessage(this.sent[this.sent.length - 1]);
  }
}

function snapshot(tick: number, serverTime: number, players: Snapshot['players']): Snapshot {
  return { kind: 'snapshot', tick, serverTime, players };
}

/** 建立一个已连接并加入房间的桥接客户端（注入假传输） */
async function setupBridge(): Promise<{ bridge: NetworkGameClient; transport: FakeTransport }> {
  const transport = new FakeTransport();
  const bridge = new NetworkGameClient();
  await bridge.connect('ws://fake', 'r1', 'p1', '玩家一', {
    pingIntervalMs: 0,
    transportFactory: () => transport,
  });
  return { bridge, transport };
}

describe('NetworkGameClient（阶段 8 第九批：GameScene 网络桥接层）', () => {
  it('connect 发送 hello 与 join（协议握手 → 加入房间）', async () => {
    const transport = new FakeTransport();
    const bridge = new NetworkGameClient();
    await bridge.connect('ws://fake', 'r1', 'p1', '玩家一', {
      pingIntervalMs: 0,
      transportFactory: () => transport,
    });
    const hello = decodeMessage(transport.sent[0]);
    expect(hello.kind).toBe('hello');
    const join = decodeMessage(transport.sent[transport.sent.length - 1]);
    expect(join.kind).toBe('join');
    if (join.kind === 'join') expect(join.roomId).toBe('r1');
    bridge.disconnect();
  });

  it('快照插值结果排除本地玩家，只保留远端', async () => {
    const { bridge, transport } = await setupBridge();
    transport.inject(snapshot(1, 1000, [
      { id: 'p1', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 1 },
      { id: 'p9', x: 5, y: 0, z: 0, yaw: 0.3, pitch: 0, health: 80, alive: true },
    ]));
    expect(bridge.remotePlayers.size).toBe(1);
    const p9 = bridge.remotePlayers.get('p9')!;
    expect(p9.x).toBe(5);
    // 二进制编解码为 float32，存在量化误差
    expect(p9.yaw).toBeCloseTo(0.3, 5);
    expect(p9.health).toBeCloseTo(80, 5);
    expect(bridge.remotePlayers.get('p1')).toBeUndefined();
    bridge.disconnect();
  });

  it('远端玩家从快照消失后自动移除（插值窗口滞后约 3 帧）', async () => {
    const { bridge, transport } = await setupBridge();
    transport.inject(snapshot(1, 1000, [{ id: 'p9', x: 5, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true }]));
    expect(bridge.remotePlayers.size).toBe(1);
    // 后续快照不再包含 p9：渲染时间越过含 p9 的帧窗口后移除（100ms 插值延迟 + 1 帧）
    transport.inject(snapshot(2, 1066, []));
    transport.inject(snapshot(3, 1132, []));
    transport.inject(snapshot(4, 1198, []));
    expect(bridge.remotePlayers.size).toBe(0);
    bridge.disconnect();
  });

  it('player_leave 立即移除并触发回调', async () => {
    const { bridge, transport } = await setupBridge();
    const left: string[] = [];
    bridge.onPlayerLeave = (id) => left.push(id);
    transport.inject(snapshot(1, 1000, [{ id: 'p9', x: 5, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true }]));
    transport.inject({ kind: 'player_leave', playerId: 'p9', reason: 'timeout' });
    expect(bridge.remotePlayers.size).toBe(0);
    expect(left).toEqual(['p9']);
    bridge.disconnect();
  });

  it('sendInput 映射移动/瞄准/开火字段并附加 seq', async () => {
    const { bridge, transport } = await setupBridge();
    transport.inject({ kind: 'hello_ack', protocolVersion: PROTOCOL_VERSION, serverTick: 1 });
    bridge.sendInput({
      moveForward: true,
      moveBackward: false,
      moveLeft: true,
      moveRight: false,
      sprint: true,
      fire: false,
      aimYaw: 1.2,
      aimPitch: -0.3,
    });
    const msg = transport.decodeLast()!;
    expect(msg.kind).toBe('input');
    if (msg.kind === 'input') {
      expect(msg.seq).toBe(1);
      expect(msg.moveForward).toBe(true);
      expect(msg.moveLeft).toBe(true);
      expect(msg.sprint).toBe(true);
      expect(msg.aimYaw).toBeCloseTo(1.2, 5);
      expect(msg.aimPitch).toBeCloseTo(-0.3, 5);
    }
    bridge.disconnect();
  });

  it('disconnect 清空远端视图', async () => {
    const { bridge, transport } = await setupBridge();
    transport.inject(snapshot(1, 1000, [{ id: 'p9', x: 5, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true }]));
    expect(bridge.remotePlayers.size).toBe(1);
    bridge.disconnect();
    expect(bridge.remotePlayers.size).toBe(0);
  });
});
