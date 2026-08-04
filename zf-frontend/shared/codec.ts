/**
 * 紧凑二进制编解码（阶段 8 P0）。
 * 仅依赖 Uint8Array/DataView + TextEncoder/TextDecoder，浏览器与 Node 通用。
 * 所有读取做边界校验，畸形帧抛 ProtocolError —— 服务端据此拒绝非法消息。
 */

import {
  type NetworkMessage,
  type MessageKind,
  type Snapshot,
  type RoomState,
  type PlayerInput,
  type RoomPhase,
  MAX_MESSAGE_BYTES,
} from './protocol.ts';

export class ProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

const TAG_BY_KIND: Record<MessageKind, number> = {
  hello: 1,
  hello_ack: 2,
  join: 3,
  join_ack: 4,
  room_state: 5,
  input: 6,
  snapshot: 7,
  player_leave: 8,
  ping: 9,
  pong: 10,
  error: 11,
};

const KIND_BY_TAG: Record<number, MessageKind> = Object.fromEntries(
  Object.entries(TAG_BY_KIND).map(([kind, tag]) => [tag, kind]),
) as Record<number, MessageKind>;

const ROOM_PHASE_INDEX: Record<RoomPhase, number> = {
  waiting: 0, full: 1, loading: 2, started: 3, ended: 4,
};
const ROOM_PHASE_BY_INDEX: RoomPhase[] = ['waiting', 'full', 'loading', 'started', 'ended'];

const LEAVE_REASON_INDEX: Record<'left' | 'timeout' | 'kicked', number> = {
  left: 0, timeout: 1, kicked: 2,
};
const LEAVE_REASON_BY_INDEX: ('left' | 'timeout' | 'kicked')[] = ['left', 'timeout', 'kicked'];

// ===== 编码 =====

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: false });

function utf8Len(s: string): number {
  return te.encode(s).length;
}

/** 计算消息编码后的字节数（不含长度前缀） */
function sizeOf(msg: NetworkMessage): number {
  switch (msg.kind) {
    case 'hello':
      return 1 + 1 + utf8Len(msg.protocolVersion.toString()) + 1 + utf8Len(msg.playerId) + 1 + utf8Len(msg.displayName);
    case 'hello_ack':
      return 1 + 1 + 4;
    case 'join':
      return 1 + 1 + utf8Len(msg.roomId);
    case 'join_ack':
      return 1 + 1 + utf8Len(msg.roomId) + 1 + utf8Len(msg.playerId) + 1 + 1 + 1;
    case 'room_state': {
      let size = 1 + 1 + utf8Len(msg.roomId) + 1 + 1 + utf8Len(msg.map) + 2 + 2 + 1;
      for (const p of msg.players) {
        size += 1 + utf8Len(p.id) + 1 + utf8Len(p.displayName) + 1 + 1;
      }
      return size;
    }
    case 'input':
      return 1 + 4 + 4 + 6 + 4 + 4;
    case 'snapshot': {
      let size = 1 + 4 + 4 + 1;
      for (const p of msg.players) {
        size += 1 + utf8Len(p.id) + 4 + 4 + 4 + 4 + 4 + 2 + 1;
      }
      return size;
    }
    case 'player_leave':
      return 1 + 1 + utf8Len(msg.playerId) + 1;
    case 'ping':
      return 1 + 8;
    case 'pong':
      return 1 + 8 + 8;
    case 'error':
      return 1 + 1 + utf8Len(msg.code) + 1 + utf8Len(msg.message);
  }
}

function writeString(view: DataView, offset: number, s: string): number {
  const bytes = te.encode(s);
  view.setUint8(offset, bytes.length);
  offset += 1;
  for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
  return offset + bytes.length;
}

function encodeBody(msg: NetworkMessage, view: DataView): void {
  let o = 1; // 预留 tag
  switch (msg.kind) {
    case 'hello':
      o = writeString(view, o, msg.protocolVersion.toString());
      o = writeString(view, o, msg.playerId);
      o = writeString(view, o, msg.displayName);
      break;
    case 'hello_ack':
      view.setUint8(o, msg.protocolVersion); o += 1;
      view.setUint32(o, msg.serverTick, true); o += 4;
      break;
    case 'join':
      o = writeString(view, o, msg.roomId);
      break;
    case 'join_ack':
      o = writeString(view, o, msg.roomId);
      o = writeString(view, o, msg.playerId);
      view.setUint8(o, msg.team); o += 1;
      view.setUint8(o, msg.slot); o += 1;
      view.setUint8(o, msg.resumed ? 1 : 0); o += 1;
      break;
    case 'room_state': {
      o = writeString(view, o, msg.roomId);
      view.setUint8(o, ROOM_PHASE_INDEX[msg.phase]); o += 1;
      o = writeString(view, o, msg.map);
      view.setUint16(o, msg.tickRate, true); o += 2;
      view.setUint16(o, msg.snapshotRate, true); o += 2;
      view.setUint8(o, msg.players.length); o += 1;
      for (const p of msg.players) {
        o = writeString(view, o, p.id);
        o = writeString(view, o, p.displayName);
        view.setUint8(o, p.team); o += 1;
        view.setUint8(o, p.alive ? 1 : 0); o += 1;
      }
      break;
    }
    case 'input':
      view.setUint32(o, msg.seq, true); o += 4;
      view.setUint32(o, msg.clientTick, true); o += 4;
      view.setUint8(o, bitfield6(msg)); o += 1;
      view.setFloat32(o, msg.aimYaw, true); o += 4;
      view.setFloat32(o, msg.aimPitch, true); o += 4;
      break;
    case 'snapshot': {
      view.setUint32(o, msg.tick, true); o += 4;
      view.setUint32(o, msg.serverTime, true); o += 4;
      view.setUint8(o, msg.players.length); o += 1;
      for (const p of msg.players) {
        o = writeString(view, o, p.id);
        view.setFloat32(o, p.x, true); o += 4;
        view.setFloat32(o, p.y, true); o += 4;
        view.setFloat32(o, p.z, true); o += 4;
        view.setFloat32(o, p.yaw, true); o += 4;
        view.setFloat32(o, p.pitch, true); o += 4;
        view.setUint16(o, Math.max(0, Math.min(65535, Math.round(p.health * 100))), true); o += 2;
        view.setUint8(o, p.alive ? 1 : 0); o += 1;
      }
      break;
    }
    case 'player_leave':
      o = writeString(view, o, msg.playerId);
      view.setUint8(o, LEAVE_REASON_INDEX[msg.reason]); o += 1;
      break;
    case 'ping':
      view.setFloat64(o, msg.clientTime, true); o += 8;
      break;
    case 'pong':
      view.setFloat64(o, msg.clientTime, true); o += 8;
      view.setFloat64(o, msg.serverTime, true); o += 8;
      break;
    case 'error':
      o = writeString(view, o, msg.code);
      o = writeString(view, o, msg.message);
      break;
  }
}

export function encodeMessage(msg: NetworkMessage): Uint8Array {
  const size = sizeOf(msg);
  if (size > MAX_MESSAGE_BYTES) {
    throw new ProtocolError('message_too_large', `消息 ${msg.kind} 编码后 ${size}B 超过上限 ${MAX_MESSAGE_BYTES}B`);
  }
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint8(0, TAG_BY_KIND[msg.kind]);
  encodeBody(msg, view);
  return bytes;
}

// ===== 解码 =====

class Reader {
  private view: DataView;
  private offset = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new ProtocolError('truncated', `数据截断：需要 ${n}B，剩余 ${this.remaining}B`);
    }
  }

  u8(): number {
    this.ensure(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.ensure(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.ensure(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  string(maxLen = 128): string {
    const len = this.u8();
    if (len > maxLen) {
      throw new ProtocolError('string_too_long', `字符串长度 ${len} 超过上限 ${maxLen}`);
    }
    this.ensure(len);
    const s = td.decode(this.bytes.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }
}

function bitfield6(msg: PlayerInput): number {
  return (
    (msg.moveForward ? 1 : 0) |
    (msg.moveBackward ? 2 : 0) |
    (msg.moveLeft ? 4 : 0) |
    (msg.moveRight ? 8 : 0) |
    (msg.sprint ? 16 : 0) |
    (msg.fire ? 32 : 0)
  );
}

function readInputFlags(r: Reader): Pick<PlayerInput, 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight' | 'sprint' | 'fire'> {
  const flags = r.u8();
  return {
    moveForward: (flags & 1) !== 0,
    moveBackward: (flags & 2) !== 0,
    moveLeft: (flags & 4) !== 0,
    moveRight: (flags & 8) !== 0,
    sprint: (flags & 16) !== 0,
    fire: (flags & 32) !== 0,
  };
}

export function decodeMessage(bytes: Uint8Array): NetworkMessage {
  if (bytes.length < 1) {
    throw new ProtocolError('empty', '空消息');
  }
  if (bytes.length > MAX_MESSAGE_BYTES) {
    throw new ProtocolError('message_too_large', `消息 ${bytes.length}B 超过上限 ${MAX_MESSAGE_BYTES}B`);
  }
  const tag = bytes[0];
  const kind = KIND_BY_TAG[tag];
  if (!kind) {
    throw new ProtocolError('unknown_tag', `未知消息 tag ${tag}`);
  }
  const r = new Reader(bytes);
  r.u8(); // 跳过 tag
  switch (kind) {
    case 'hello': {
      const protocolVersion = Number(r.string(8));
      const playerId = r.string();
      const displayName = r.string(64);
      return { kind, protocolVersion, playerId, displayName };
    }
    case 'hello_ack':
      return { kind, protocolVersion: r.u8(), serverTick: r.u32() };
    case 'join':
      return { kind, roomId: r.string(64) };
    case 'join_ack': {
      const roomId = r.string(64);
      const playerId = r.string();
      const team = r.u8() as 0 | 1;
      const slot = r.u8();
      const resumed = r.u8() === 1;
      return { kind, roomId, playerId, team, slot, resumed };
    }
    case 'room_state': {
      const roomId = r.string(64);
      const phase = ROOM_PHASE_BY_INDEX[r.u8()] ?? 'waiting';
      const map = r.string(64);
      const tickRate = r.u16();
      const snapshotRate = r.u16();
      const count = r.u8();
      const players: RoomState['players'] = [];
      for (let i = 0; i < count; i++) {
        const id = r.string();
        const displayName = r.string(64);
        const team = r.u8() as 0 | 1;
        const alive = r.u8() === 1;
        players.push({ id, displayName, team, alive });
      }
      return { kind, roomId, phase, map, tickRate, snapshotRate, players };
    }
    case 'input': {
      const seq = r.u32();
      const clientTick = r.u32();
      const flags = readInputFlags(r);
      const aimYaw = r.f32();
      const aimPitch = r.f32();
      return { kind, seq, clientTick, ...flags, aimYaw, aimPitch };
    }
    case 'snapshot': {
      const tick = r.u32();
      const serverTime = r.u32();
      const count = r.u8();
      const players: Snapshot['players'] = [];
      for (let i = 0; i < count; i++) {
        const id = r.string();
        const x = r.f32();
        const y = r.f32();
        const z = r.f32();
        const yaw = r.f32();
        const pitch = r.f32();
        const health = r.u16() / 100;
        const alive = r.u8() === 1;
        players.push({ id, x, y, z, yaw, pitch, health, alive });
      }
      return { kind, tick, serverTime, players };
    }
    case 'player_leave': {
      const playerId = r.string();
      const reason = LEAVE_REASON_BY_INDEX[r.u8()] ?? 'left';
      return { kind, playerId, reason };
    }
    case 'ping':
      return { kind, clientTime: r.f64() };
    case 'pong':
      return { kind, clientTime: r.f64(), serverTime: r.f64() };
    case 'error': {
      const code = r.string(64);
      const message = r.string(256);
      return { kind, code, message };
    }
  }
}
