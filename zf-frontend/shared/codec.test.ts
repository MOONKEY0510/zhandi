import { describe, it, expect } from 'vitest';
import { encodeMessage, decodeMessage, ProtocolError } from './codec.ts';
import {
  PROTOCOL_VERSION,
  type NetworkMessage,
  type ClientHello,
  type PlayerInput,
  type Snapshot,
  type RoomState,
  type JoinAck,
  type VehicleStateMsg,
  type VehicleEnter,
  type VehicleExit,
  type VehicleDrive,
  type VehicleFire,
  type KillFeedMsg,
  type DestructibleStateMsg,
} from './protocol.ts';

function roundTrip<T extends NetworkMessage>(msg: T): T {
  const bytes = encodeMessage(msg);
  return decodeMessage(bytes) as T;
}

describe('codec（阶段 8 二进制协议）', () => {
  it('hello 往返一致', () => {
    const msg: ClientHello = { kind: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'p-abc-123', displayName: '测试玩家' };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('join_ack 往返一致（含重连标志）', () => {
    const msg: JoinAck = { kind: 'join_ack', roomId: 'room-1', playerId: 'p-1', team: 1, slot: 7, resumed: true };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('input 往返一致（位标志 + 角度）', () => {
    const msg: PlayerInput = {
      kind: 'input', seq: 1024, clientTick: 88,
      moveForward: true, moveBackward: false, moveLeft: true, moveRight: false,
      sprint: true, fire: true, aimYaw: -1.5708, aimPitch: 0.3,
    };
    const decoded = roundTrip(msg);
    expect(decoded.seq).toBe(1024);
    expect(decoded.clientTick).toBe(88);
    expect(decoded.moveForward).toBe(true);
    expect(decoded.moveLeft).toBe(true);
    expect(decoded.fire).toBe(true);
    expect(decoded.aimYaw).toBeCloseTo(-1.5708, 5); // f32 精度
    expect(decoded.aimPitch).toBeCloseTo(0.3, 5);
  });

  it('snapshot 往返一致（多玩家 + 血量缩放）', () => {
    const msg: Snapshot = {
      kind: 'snapshot', tick: 42, serverTime: 1234567,
      players: [
        { id: 'p-1', x: 1.5, y: 2.25, z: -3.75, yaw: 0.1, pitch: -0.2, health: 100, alive: true },
        { id: 'p-2', x: -10, y: 0, z: 8, yaw: 3.14, pitch: 1.5, health: 57.25, alive: true },
        { id: 'p-3', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 0, alive: false },
      ],
    };
    const decoded = roundTrip(msg);
    expect(decoded.tick).toBe(42);
    expect(decoded.serverTime).toBe(1234567);
    expect(decoded.players.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(decoded.players[i].id).toBe(msg.players[i].id);
      expect(decoded.players[i].x).toBeCloseTo(msg.players[i].x, 4); // f32 精度
      expect(decoded.players[i].y).toBeCloseTo(msg.players[i].y, 4);
      expect(decoded.players[i].z).toBeCloseTo(msg.players[i].z, 4);
      expect(decoded.players[i].yaw).toBeCloseTo(msg.players[i].yaw, 4);
      expect(decoded.players[i].pitch).toBeCloseTo(msg.players[i].pitch, 4);
      expect(decoded.players[i].health).toBeCloseTo(msg.players[i].health, 2);
      expect(decoded.players[i].alive).toBe(msg.players[i].alive);
    }
  });

  it('snapshot 玩家 ackSeq 可选字段往返（本人有值，他人缺省）', () => {
    const msg: Snapshot = {
      kind: 'snapshot', tick: 5, serverTime: 100,
      players: [
        { id: 'me', x: 1, y: 0, z: 1, yaw: 0, pitch: 0, health: 100, alive: true, ackSeq: 42 },
        { id: 'other', x: 2, y: 0, z: 2, yaw: 0, pitch: 0, health: 100, alive: true },
      ],
    };
    const decoded = roundTrip(msg);
    expect(decoded.players[0].ackSeq).toBe(42);
    expect(decoded.players[1].ackSeq).toBeUndefined();
  });

  it('room_state 往返一致（含玩家列表）', () => {
    const msg: RoomState = {
      kind: 'room_state', roomId: 'room-1', phase: 'started', map: 'stalingrad',
      tickRate: 30, snapshotRate: 15,
      players: [
        { id: 'p-1', displayName: '玩家一', team: 0, alive: true },
        { id: 'p-2', displayName: '玩家二', team: 1, alive: false },
      ],
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('ping/pong/error/player_leave 往返一致', () => {
    expect(roundTrip({ kind: 'ping', clientTime: 123.456 })).toEqual({ kind: 'ping', clientTime: 123.456 });
    expect(roundTrip({ kind: 'pong', clientTime: 123.456, serverTime: 999.9 })).toEqual({ kind: 'pong', clientTime: 123.456, serverTime: 999.9 });
    expect(roundTrip({ kind: 'player_leave', playerId: 'p-9', reason: 'timeout' })).toEqual({ kind: 'player_leave', playerId: 'p-9', reason: 'timeout' });
    expect(roundTrip({ kind: 'error', code: 'room_full', message: '房间已满' })).toEqual({ kind: 'error', code: 'room_full', message: '房间已满' });
  });

  it('未知 tag 抛 ProtocolError', () => {
    expect(() => decodeMessage(new Uint8Array([0xff, 0, 0]))).toThrow(ProtocolError);
  });

  it('截断数据抛 ProtocolError', () => {
    const full = encodeMessage({ kind: 'hello', protocolVersion: 1, playerId: 'p-1', displayName: 'name' });
    const truncated = full.subarray(0, full.length - 3);
    expect(() => decodeMessage(truncated)).toThrow(ProtocolError);
  });

  it('空消息抛 ProtocolError', () => {
    expect(() => decodeMessage(new Uint8Array(0))).toThrow(ProtocolError);
  });

  it('超长字符串抛 ProtocolError（schema 校验）', () => {
    const bytes = new Uint8Array([9, 200, 1, 2, 3]); // ping tag + 伪造成超长字符串的字段
    expect(() => decodeMessage(bytes)).toThrow(ProtocolError);
  });

  it('超上限消息被拒绝', () => {
    const longId = 'player-with-a-very-long-id-'.repeat(4); // 96 字符
    const msg: Snapshot = {
      kind: 'snapshot', tick: 1, serverTime: 1,
      players: Array.from({ length: 40 }, (_, i) => ({
        id: `${longId}-${i}`, x: i, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true,
      })),
    };
    expect(() => encodeMessage(msg)).toThrow(ProtocolError);
  });

  it('snapshot 玩家数上限（32 人内正常编码）', () => {
    const msg: Snapshot = {
      kind: 'snapshot', tick: 1, serverTime: 1,
      players: Array.from({ length: 32 }, (_, i) => ({
        id: `p-${i}`, x: i, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, alive: true,
      })),
    };
    const decoded = roundTrip(msg);
    expect(decoded.players.length).toBe(32);
  });

  it('vehicle_state 往返一致（多载具：占用/摧毁/重生字段）', () => {
    const msg: VehicleStateMsg = {
      kind: 'vehicle_state', roomId: 'r1', tick: 77,
      vehicles: [
        { id: 'v1', type: 0, x: 12.5, z: -8.25, yaw: 1.2, health: 200, maxHealth: 200, team: 0, destroyed: false, respawnIn: 0, driverId: 'p1' },
        { id: 'v2', type: 1, x: -30, z: 30, yaw: -0.5, health: 0, maxHealth: 500, team: 1, destroyed: true, respawnIn: 12, driverId: null },
      ],
    };
    const decoded = roundTrip(msg);
    expect(decoded.vehicles).toHaveLength(2);
    expect(decoded.vehicles[0]).toMatchObject({ id: 'v1', type: 0, x: 12.5, z: -8.25, health: 200, team: 0, destroyed: false, driverId: 'p1' });
    expect(decoded.vehicles[0].yaw).toBeCloseTo(1.2, 5);
    expect(decoded.vehicles[1]).toMatchObject({ id: 'v2', type: 1, x: -30, z: 30, health: 0, team: 1, destroyed: true, respawnIn: 12, driverId: null });
    expect(decoded.vehicles[1].yaw).toBeCloseTo(-0.5, 5);
  });

  it('vehicle_enter / vehicle_exit / vehicle_drive 往返一致', () => {
    const enter: VehicleEnter = { kind: 'vehicle_enter', vehicleId: 'v1' };
    const exit: VehicleExit = { kind: 'vehicle_exit' };
    const drive: VehicleDrive = { kind: 'vehicle_drive', forward: 0.75, turn: -0.25 };
    expect(roundTrip(enter)).toEqual(enter);
    expect(roundTrip(exit)).toEqual(exit);
    expect(roundTrip(drive)).toEqual(drive);
  });

  it('vehicle_fire 往返一致（方向/武器索引）', () => {
    const fire: VehicleFire = { kind: 'vehicle_fire', vehicleId: 'v2', aimYaw: 0.5, aimPitch: -0.25, weaponIndex: 0 };
    expect(roundTrip(fire)).toEqual(fire);
  });

  it('kill_feed 往返一致（含空击杀者）', () => {
    const feed: KillFeedMsg = {
      kind: 'kill_feed',
      killerId: 'p-a',
      killerName: '德军士兵',
      victimId: 'p-b',
      victimName: '苏军士兵',
      weaponLabel: '主炮',
    };
    expect(roundTrip(feed)).toEqual(feed);
    // 环境击杀：killerId=null → 空字符串往返还原
    const env: KillFeedMsg = { ...feed, killerId: null, killerName: '未知' };
    expect(roundTrip(env)).toEqual(env);
  });

  it('destructible_state 往返一致（bitset 破坏状态）', () => {
    const msg: DestructibleStateMsg = {
      kind: 'destructible_state',
      roomId: 'room-1',
      tick: 42,
      bits: '10100001',
    };
    expect(roundTrip(msg)).toEqual(msg);
  });
});
