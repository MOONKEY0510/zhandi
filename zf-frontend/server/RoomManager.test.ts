import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoomManager } from './RoomManager.ts';

describe('RoomManager（阶段 8 房间生命周期）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('创建与加入：新玩家进 waiting 房间', () => {
    const manager = new RoomManager();
    const result = manager.joinOrCreate('r1', 'p1', '玩家一');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.team).toBe(0);
    const room = manager.getRoom('r1')!;
    expect(room.phase).toBe('waiting');
    expect(room.playerCount).toBe(1);
  });

  it('队伍平衡：先 0 队后 1 队轮换', () => {
    const manager = new RoomManager();
    manager.joinOrCreate('r1', 'p1', '一');
    const r2 = manager.joinOrCreate('r1', 'p2', '二');
    const r3 = manager.joinOrCreate('r1', 'p3', '三');
    expect(r2.ok && r2.player.team).toBe(1);
    expect(r3.ok && r3.player.team).toBe(0);
  });

  it('房间满员拒绝加入', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('r1', { maxPlayers: 2 });
    room.join('p1', '一');
    room.join('p2', '二');
    const result = room.join('p3', '三');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('room_full');
    expect(room.phaseLabel).toBe('full');
  });

  it('断线保留：宽限期内重连恢复原槽位', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('r1', { retentionSeconds: 30 });
    const first = room.join('p1', '一');
    expect(first.ok && first.resumed).toBe(false);

    room.markDisconnected('p1');
    const reconnect = room.join('p1', '一重连');
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(reconnect.resumed).toBe(true);
    expect(reconnect.player.team).toBe(first.ok ? first.player.team : 0);
    expect(room.playerCount).toBe(1);
  });

  it('超过宽限期：重连视为新玩家（移除旧记录）', () => {
    vi.setSystemTime(1000);
    const manager = new RoomManager();
    const room = manager.createRoom('r1', { retentionSeconds: 30 });
    room.join('p1', '一');
    room.markDisconnected('p1');

    vi.setSystemTime(1000 + 31_000);
    const removed = room.cleanupDisconnected(Date.now());
    expect(removed).toEqual(['p1']);
    expect(room.playerCount).toBe(0);

    const again = room.join('p1', '一再来');
    expect(again.ok && again.resumed).toBe(false);
  });

  it('重复连接拒绝（already_connected）', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('r1');
    room.join('p1', '一');
    const result = room.join('p1', '一');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('already_connected');
  });

  it('离开移除玩家，断线通知可追溯房间', () => {
    const manager = new RoomManager();
    manager.joinOrCreate('r1', 'p1', '一');
    manager.joinOrCreate('r1', 'p2', '二');
    const room = manager.disconnect('p1');
    expect(room?.id).toBe('r1');
    expect(room?.getPlayer('p1')?.connected).toBe(false);
    manager.leave('p1');
    expect(room?.getPlayer('p1')).toBeNull();
  });

  it('stats 统计房间与玩家数', () => {
    const manager = new RoomManager();
    manager.joinOrCreate('r1', 'p1', '一');
    manager.joinOrCreate('r2', 'p2', '二');
    const stats = manager.stats();
    expect(stats.rooms).toBe(2);
    expect(stats.players).toBe(2);
    expect(stats.activeRooms).toBe(2);
  });

  it('开始/结束对局切换阶段', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('r1');
    room.start();
    expect(room.phase).toBe('started');
    room.end();
    expect(room.phase).toBe('ended');
  });
});
