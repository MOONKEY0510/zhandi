import { describe, it, expect } from 'vitest';
import { PositionHistory } from './PositionHistory.ts';
import { HIT_REWIND_WINDOW_MS } from '../shared/protocol.ts';

describe('PositionHistory（阶段 8 第十九批：有限历史回溯采样）', () => {
  it('记录 + 采样：查询时刻精确落在记录点上时返回该位置', () => {
    const h = new PositionHistory();
    h.record(1000, 1, 0, 1, true);
    h.record(1033, 2, 0, 2, true);
    h.record(1066, 3, 0, 3, true);
    const p = h.sampleAt(1033, HIT_REWIND_WINDOW_MS);
    expect(p).toEqual({ x: 2, y: 0, z: 2 });
  });

  it('线性插值：两记录点之间按时间比例插值位置', () => {
    const h = new PositionHistory();
    h.record(1000, 0, 0, 0, true);
    h.record(2000, 10, 0, 20, true);
    // 中间 1500ms → x=5, z=10
    expect(h.sampleAt(1500, HIT_REWIND_WINDOW_MS)).toEqual({ x: 5, y: 0, z: 10 });
    // 1/4 处 1250ms → x=2.5, z=5
    expect(h.sampleAt(1250, HIT_REWIND_WINDOW_MS)).toEqual({ x: 2.5, y: 0, z: 5 });
  });

  it('晚于最新记录：返回最新位置（当前帧兜底）', () => {
    const h = new PositionHistory();
    h.record(1000, 1, 2, 3, true);
    h.record(1033, 4, 5, 6, true);
    expect(h.sampleAt(5000, HIT_REWIND_WINDOW_MS)).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('早于最旧记录且超回溯窗口：返回 null（调用方回退当前帧位置）', () => {
    const h = new PositionHistory();
    h.record(1000, 1, 2, 3, true);
    h.record(1033, 4, 5, 6, true);
    expect(h.sampleAt(0, HIT_REWIND_WINDOW_MS)).toBeNull(); // 早 1000ms > 500ms 窗口
    // 窗口边缘内（早 400ms）：仍可采样到最旧位置
    expect(h.sampleAt(600, HIT_REWIND_WINDOW_MS)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('空历史：返回 null', () => {
    expect(new PositionHistory().sampleAt(0, HIT_REWIND_WINDOW_MS)).toBeNull();
  });

  it('乱序防御：时间回退的记录被忽略，相同时刻的记录被替换', () => {
    const h = new PositionHistory();
    h.record(1000, 1, 1, 1, true);
    h.record(900, 9, 9, 9, true); // 回退 → 忽略
    h.record(1033, 2, 2, 2, true);
    h.record(1033, 3, 3, 3, false); // 同 tick 重生瞬移 → 替换
    expect(h.size).toBe(2);
    expect(h.sampleAt(1033, HIT_REWIND_WINDOW_MS)).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('容量裁剪：超出容量丢弃最旧记录', () => {
    const h = new PositionHistory(4);
    for (let i = 0; i < 10; i++) h.record(1000 + i * 33, i, 0, 0, true);
    expect(h.size).toBe(4);
    // 裁剪后最旧样本为 i=6（t1198）：查询 t100（早 1098ms > 500ms 窗口）→ 超窗 null
    expect(h.sampleAt(100, HIT_REWIND_WINDOW_MS)).toBeNull();
    expect(h.sampleAt(1000 + 7 * 33, HIT_REWIND_WINDOW_MS)).toEqual({ x: 7, y: 0, z: 0 });
  });

  it('clear：清空全部记录', () => {
    const h = new PositionHistory();
    h.record(1000, 1, 2, 3, true);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.newestTimeMs).toBeNull();
  });
});
