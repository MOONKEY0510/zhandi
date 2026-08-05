import { describe, it, expect } from 'vitest';
import { SnapshotBuffer, type SnapshotData } from './SnapshotBuffer.ts';

function snap(tick: number, serverTime: number, players: SnapshotData['players']): SnapshotData {
  return { tick, serverTime, players };
}

const p1 = (x: number, z: number): SnapshotData['players'][number] => ({
  id: 'p1', x, y: 0, z, yaw: 0, pitch: 0, health: 100, alive: true,
});

describe('SnapshotBuffer（阶段 8 快照插值）', () => {
  it('空缓冲返回 null', () => {
    const buf = new SnapshotBuffer();
    expect(buf.interpolate()).toBeNull();
    expect(buf.getLatest()).toBeNull();
  });

  it('单帧：渲染时间落后则冻结在该帧', () => {
    const buf = new SnapshotBuffer({ renderDelayMs: 100 });
    buf.push(snap(1, 1000, [p1(0, 0)]));
    const result = buf.interpolate(900);
    expect(result!.get('p1')!.x).toBe(0);
  });

  it('两帧插值：50% 位置取中点', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(10, 0)]));
    const result = buf.interpolate(1033)!; // (1000+1066)/2
    expect(result.get('p1')!.x).toBeCloseTo(5, 5);
    expect(result.get('p1')!.fromTick).toBe(1);
    expect(result.get('p1')!.toTick).toBe(2);
  });

  it('角度插值走最短弧', () => {
    const buf = new SnapshotBuffer();
    const a = { ...p1(0, 0), yaw: Math.PI - 0.1 };
    const b = { ...p1(0, 0), yaw: -Math.PI + 0.1 };
    buf.push(snap(1, 1000, [a]));
    buf.push(snap(2, 1066, [b]));
    const result = buf.interpolate(1033)!;
    // 两个角都在 ±π 附近，最短弧经过 π 边界 → 中点应在 ±π 附近（而不是绕 0 的长弧）
    expect(Math.abs(Math.abs(result.get('p1')!.yaw) - Math.PI)).toBeLessThan(0.11);
  });

  it('按 tick 去重：重复快照忽略', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(1, 1000, [p1(99, 99)]));
    buf.push(snap(2, 1066, [p1(10, 0)]));
    const result = buf.interpolate(1033)!;
    expect(result.get('p1')!.x).toBeCloseTo(5, 5); // 未被重复帧污染
  });

  it('乱序压入：按 tick 排序', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(2, 1066, [p1(10, 0)]));
    buf.push(snap(1, 1000, [p1(0, 0)]));
    expect(buf.getLatest()!.tick).toBe(2);
    const result = buf.interpolate(1033)!;
    expect(result.get('p1')!.x).toBeCloseTo(5, 5);
  });

  it('新玩家出现在快照 b：直接使用 b 帧', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(5, 0), { id: 'p2', x: 100, y: 0, z: 0, yaw: 0, pitch: 0, health: 80, alive: true }]));
    const result = buf.interpolate(1033)!;
    expect(result.get('p2')!.x).toBe(100);
    expect(result.get('p2')!.health).toBe(80);
  });

  it('玩家在 b 消失：保持 a 帧', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 1000, [p1(0, 0), { id: 'p2', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 50, alive: true }]));
    buf.push(snap(2, 1066, [p1(10, 0)]));
    const result = buf.interpolate(1033)!;
    expect(result.get('p2')!.health).toBe(50);
  });

  it('缓冲上限：淘汰最旧', () => {
    const buf = new SnapshotBuffer({ maxBuffered: 3 });
    for (let i = 1; i <= 5; i++) buf.push(snap(i, 1000 + i * 66, [p1(i, 0)]));
    expect(buf.stats().buffered).toBe(3);
    expect(buf.getLatest()!.tick).toBe(5);
  });

  it('stats：lagMs 与 frozen 标记', () => {
    const buf = new SnapshotBuffer({ renderDelayMs: 100, freezeThresholdMs: 500 });
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(10, 0)]));
    const stats = buf.stats(900); // 渲染时间落后 166ms
    expect(stats.lagMs).toBe(166);
    expect(stats.frozen).toBe(false);
    const frozen = buf.stats(300); // 落后 766ms
    expect(frozen.frozen).toBe(true);
  });

  it('丢包短时外推：按最后两帧速度继续推进', () => {
    const buf = new SnapshotBuffer({ extrapolateMs: 200 });
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(10, 0)])); // 速度 ≈ 151.5 m/s
    // 渲染时间超最新帧 100ms（≤ 200ms 外推窗）
    const result = buf.interpolate(1166)!;
    const player = result.get('p1')!;
    expect(player.extrapolated).toBe(true);
    // x = 10 + 151.5 × 0.1 ≈ 25.15
    expect(player.x).toBeCloseTo(25.15, 1);
  });

  it('超过外推窗口：冻结在最新帧', () => {
    const buf = new SnapshotBuffer({ extrapolateMs: 200 });
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(10, 0)]));
    const result = buf.interpolate(1400)!; // 超前 334ms > 200ms
    expect(result.get('p1')!.x).toBe(10);
    expect(result.get('p1')!.extrapolated).toBeUndefined();
  });

  it('外推期间新玩家冻结在最新帧位置', () => {
    const buf = new SnapshotBuffer({ extrapolateMs: 200 });
    buf.push(snap(1, 1000, [p1(0, 0)]));
    buf.push(snap(2, 1066, [p1(10, 0), { id: 'p2', x: 100, y: 0, z: 0, yaw: 0, pitch: 0, health: 80, alive: true }]));
    const result = buf.interpolate(1166)!;
    expect(result.get('p1')!.extrapolated).toBe(true);
    expect(result.get('p2')!.x).toBe(100);
    expect(result.get('p2')!.extrapolated).toBe(false);
  });
});
