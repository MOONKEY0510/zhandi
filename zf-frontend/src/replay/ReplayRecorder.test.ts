import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplayRecorder, REPLAY_EVENT_LABELS } from './ReplayRecorder';

describe('ReplayRecorder（阶段 10 P1：战局回放录制）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('record 自动换算相对时间（基于 startTime）', () => {
    const recorder = new ReplayRecorder(Date.now());
    vi.advanceTimersByTime(15_000);
    recorder.record('kill', '步枪 爆头 AI Bot');
    const events = recorder.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].time).toBe(15_000);
    expect(events[0].type).toBe('kill');
    expect(events[0].label).toBe('步枪 爆头 AI Bot');
  });

  it('getEvents 按时间排序（乱序录制仍有序返回）', () => {
    const recorder = new ReplayRecorder(0);
    recorder.recordAt(30_000, 'objective', '「据点 A」被苏军占领');
    recorder.recordAt(5_000, 'kill', '击杀 1');
    recorder.recordAt(20_000, 'death', '你被击杀了');
    const times = recorder.getEvents().map((e) => e.time);
    expect(times).toEqual([5_000, 20_000, 30_000]);
  });

  it('formatClock 输出 mm:ss', () => {
    expect(ReplayRecorder.formatClock(0)).toBe('00:00');
    expect(ReplayRecorder.formatClock(5_000)).toBe('00:05');
    expect(ReplayRecorder.formatClock(65_000)).toBe('01:05');
    expect(ReplayRecorder.formatClock(600_000)).toBe('10:00');
  });

  it('getTimeline 返回排序后的格式化时间线', () => {
    const recorder = new ReplayRecorder(0);
    recorder.recordAt(90_000, 'vehicle', '坦克 被摧毁（正面部）', { team: 'A' });
    recorder.recordAt(10_000, 'kill', '击杀', { team: 'B' });
    const timeline = recorder.getTimeline();
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toEqual({ clock: '00:10', type: 'kill', label: '击杀', team: 'B' });
    expect(timeline[1].clock).toBe('01:30');
  });

  it('getTimelineByType 支持类型筛选', () => {
    const recorder = new ReplayRecorder(0);
    recorder.recordAt(1_000, 'kill', '击杀 1');
    recorder.recordAt(2_000, 'objective', '占点 1');
    recorder.recordAt(3_000, 'kill', '击杀 2');
    expect(recorder.getTimelineByType('kill')).toHaveLength(2);
    expect(recorder.getTimelineByType('objective')).toHaveLength(1);
    expect(recorder.getTimelineByType('all')).toHaveLength(3);
    expect(recorder.getTimelineByType('vehicle')).toHaveLength(0);
  });

  it('clear 清空事件', () => {
    const recorder = new ReplayRecorder(0);
    recorder.recordAt(1_000, 'kill', '击杀');
    expect(recorder.getCount()).toBe(1);
    recorder.clear();
    expect(recorder.getCount()).toBe(0);
    expect(recorder.getTimeline()).toHaveLength(0);
  });

  it('REPLAY_EVENT_LABELS 覆盖全部事件类型', () => {
    expect(Object.keys(REPLAY_EVENT_LABELS).sort()).toEqual(
      ['death', 'kill', 'objective', 'round_end', 'vehicle'],
    );
  });
});
