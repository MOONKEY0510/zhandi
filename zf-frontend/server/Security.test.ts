/**
 * 安全验收（阶段 8）：服务器必须拒绝一切越权/畸形/伪造消息。
 * 用裸 WebSocket + 协议编码直接构造恶意输入，验证服务端裁决行为。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ServerApp } from './ServerApp.ts';
import { encodeMessage, decodeMessage } from '../shared/codec.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import type { NetworkMessage } from '../shared/protocol.ts';

function rawConnect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('连接失败'));
  });
}

/** 等待服务器下一条 error 帧（协议二进制） */
function waitError(ws: WebSocket, timeoutMs = 2000): Promise<{ code: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ws.onmessage = (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      try {
        const decoded = decodeMessage(bytes);
        if (decoded.kind === 'error') {
          clearTimeout(timer);
          resolve({ code: decoded.code });
        }
      } catch {
        // 非协议帧，忽略继续等
      }
    };
  });
}

/** 发送一条消息，等待服务器回 error（或超时返回 null） */
async function sendAndWaitError(ws: WebSocket, msg: NetworkMessage, timeoutMs = 2000): Promise<{ code: string } | null> {
  const err = waitError(ws, timeoutMs);
  ws.send(encodeMessage(msg));
  return err;
}

describe('安全验收（阶段 8：越权/畸形/伪造消息拒绝）', () => {
  let server: ServerApp;
  let url: string;

  beforeAll(async () => {
    server = new ServerApp({ port: 0, defaultRoomId: 'sec', staticLayout: [] });
    const port = await server.start();
    url = `ws://127.0.0.1:${port}`;
  }, 10000);

  afterAll(() => {
    server.stop();
  });

  it('未握手直接 join → not_hello', async () => {
    const ws = await rawConnect(url);
    const err = await sendAndWaitError(ws, { kind: 'join', roomId: 'sec' });
    expect(err?.code).toBe('not_hello');
    ws.close();
  });

  it('未 join 直接发 input → not_joined', async () => {
    const ws = await rawConnect(url);
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec0', displayName: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    const err = await sendAndWaitError(ws, {
      kind: 'input',
      seq: 1,
      clientTick: 1,
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      sprint: false,
      fire: false,
      aimYaw: 0,
      aimPitch: 0,
    });
    expect(err?.code).toBe('not_joined');
    ws.close();
  });

  it('客户端发送服务端专用消息（snapshot）→ unexpected_message', async () => {
    const ws = await rawConnect(url);
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec1', displayName: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    const err = await sendAndWaitError(ws, { kind: 'snapshot', tick: 1, serverTime: 1, players: [] });
    expect(err?.code).toBe('unexpected_message');
    ws.close();
  });

  it('未知 tag 畸形帧 → unknown_tag', async () => {
    const ws = await rawConnect(url);
    const err = waitError(ws);
    ws.send(new Uint8Array([0x63])); // tag 99：未定义
    expect((await err)?.code).toBe('unknown_tag');
    ws.close();
  });

  it('截断帧 → truncated', async () => {
    const ws = await rawConnect(url);
    const full = encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec2', displayName: 'x' });
    const truncated = full.slice(0, Math.max(1, full.length - 3)); // 砍掉尾部
    const err = waitError(ws);
    ws.send(truncated);
    expect((await err)?.code).toBe('truncated');
    ws.close();
  });

  it('协议版本不匹配 → protocol_mismatch 且断开', async () => {
    const ws = await rawConnect(url);
    const closed = new Promise<boolean>((resolve) => {
      ws.onclose = () => resolve(true);
    });
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: 999, playerId: 'sec3', displayName: 'x' }));
    const err = waitError(ws);
    expect((await err)?.code).toBe('protocol_mismatch');
    expect(await closed).toBe(true);
  });

  it('乱序晚到的旧包被静默丢弃（不误报重放）', async () => {
    const ws = await rawConnect(url);
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec4', displayName: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(encodeMessage({ kind: 'join', roomId: 'sec' }));
    await new Promise((r) => setTimeout(r, 100));
    const mkInput = (seq: number): NetworkMessage => ({
      kind: 'input',
      seq,
      clientTick: seq,
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      sprint: false,
      fire: false,
      aimYaw: 0,
      aimPitch: 0,
    });
    ws.send(encodeMessage(mkInput(5)));
    await new Promise((r) => setTimeout(r, 100));
    // 旧包（seq=3 < 已应用的 5）：静默忽略，服务器不应回任何 error
    const err = await sendAndWaitError(ws, mkInput(3), 800);
    expect(err).toBeNull();
    // 连接仍健康：后续正常 seq 不被影响
    const err2 = await sendAndWaitError(ws, mkInput(6), 800);
    expect(err2).toBeNull();
    ws.close();
  });

  it('抖动乱序输入被缓冲而非拒绝（seq 1,3,2 → 无 stale_input）', async () => {
    const ws = await rawConnect(url);
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec5', displayName: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(encodeMessage({ kind: 'join', roomId: 'sec' }));
    await new Promise((r) => setTimeout(r, 100));
    const mkInput = (seq: number, forward: boolean): NetworkMessage => ({
      kind: 'input',
      seq,
      clientTick: seq,
      moveForward: forward,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      sprint: false,
      fire: false,
      aimYaw: 0,
      aimPitch: 0,
    });
    // 抖动导致乱序：先发 seq=1、seq=3，再补发 seq=2（网络延迟窗口内交换）
    ws.send(encodeMessage(mkInput(1, true)));
    ws.send(encodeMessage(mkInput(3, true)));
    ws.send(encodeMessage(mkInput(2, true)));
    // 等待数 tick：全部应被缓冲应用，服务器不应回 stale_input / input_jump
    const err = await sendAndWaitError(ws, mkInput(4, true), 1500);
    expect(err).toBeNull(); // 无错误（seq=4 正常递增，前序乱序已缓冲）
    ws.close();
  });

  it('seq 跳跃超过乱序窗口 → input_jump（异常输入检测）', async () => {
    const ws = await rawConnect(url);
    ws.send(encodeMessage({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'sec6', displayName: 'x' }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(encodeMessage({ kind: 'join', roomId: 'sec' }));
    await new Promise((r) => setTimeout(r, 100));
    const mkInput = (seq: number): NetworkMessage => ({
      kind: 'input',
      seq,
      clientTick: seq,
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      sprint: false,
      fire: false,
      aimYaw: 0,
      aimPitch: 0,
    });
    ws.send(encodeMessage(mkInput(1)));
    await new Promise((r) => setTimeout(r, 100));
    // 跳跃 100 > 窗口 8
    const err = await sendAndWaitError(ws, mkInput(101));
    expect(err?.code).toBe('input_jump');
    ws.close();
  });
});
