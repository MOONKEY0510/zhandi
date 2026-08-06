/**
 * 战局回放录制器（阶段 10 P1：回放/观战与举报入口）。
 * 录制本局关键事件（击杀/死亡/占点/载具/结算）为时间线，供结算界面回放浏览。
 * 纯逻辑模块：不依赖 DOM / THREE，时间基准为初始化时的系统时间（毫秒）。
 */

export type ReplayEventType = 'kill' | 'death' | 'objective' | 'vehicle' | 'round_end';

export interface ReplayEvent {
  /** 距录制开始（startTime）的相对毫秒数 */
  time: number;
  type: ReplayEventType;
  /** 事件描述文本（如「步枪 爆头 AI Bot」） */
  label: string;
  /** 阵营归属（可选，用于筛选） */
  team?: string;
  /** 补充详情（可选） */
  detail?: string;
}

export interface ReplayTimelineItem {
  /** 格式化时间 mm:ss */
  clock: string;
  type: ReplayEventType;
  label: string;
  team?: string;
}

export const REPLAY_EVENT_LABELS: Record<ReplayEventType, string> = {
  kill: '击杀',
  death: '阵亡',
  objective: '据点',
  vehicle: '载具',
  round_end: '结算',
};

export class ReplayRecorder {
  private events: ReplayEvent[] = [];
  private readonly startTime: number;

  constructor(startTime: number = Date.now()) {
    this.startTime = startTime;
  }

  /** 录制事件：time 自动换算为相对毫秒 */
  record(
    type: ReplayEventType,
    label: string,
    opts: { team?: string; detail?: string } = {},
  ): void {
    this.events.push({
      time: Math.max(0, Date.now() - this.startTime),
      type,
      label,
      team: opts.team,
      detail: opts.detail,
    });
  }

  /** 直接录制带明确时间的条目（测试/回放导入用） */
  recordAt(time: number, type: ReplayEventType, label: string, opts: { team?: string; detail?: string } = {}): void {
    this.events.push({ time: Math.max(0, time), type, label, team: opts.team, detail: opts.detail });
  }

  getEvents(): ReplayEvent[] {
    return [...this.events].sort((a, b) => a.time - b.time);
  }

  getCount(): number {
    return this.events.length;
  }

  /** 格式化毫秒 → mm:ss */
  static formatClock(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /** 时间线视图（按时间排序 + 格式化时钟），供 UI 渲染 */
  getTimeline(): ReplayTimelineItem[] {
    return this.getEvents().map((e) => ({
      clock: ReplayRecorder.formatClock(e.time),
      type: e.type,
      label: e.label,
      team: e.team,
    }));
  }

  /** 按类型筛选时间线 */
  getTimelineByType(type: ReplayEventType | 'all'): ReplayTimelineItem[] {
    if (type === 'all') return this.getTimeline();
    return this.getTimeline().filter((item) => item.type === type);
  }

  clear(): void {
    this.events = [];
  }
}
