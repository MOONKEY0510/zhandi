/**
 * 举报记录持久化（阶段 10 P1：回放/观战与举报入口）。
 * 结算界面举报玩家 → addReport 写入本地存储（上限 50 条）；
 * 联网上报端点接入后可在提交处替换为服务端请求（记录结构保持不变）。
 */

export interface ReportEntry {
  id: string;
  /** 被举报玩家 id（玩家自身为 playerId，AI 为 bot_N） */
  targetId: string;
  targetName: string;
  /** 举报理由：cheat / abusive / toxic / other */
  reason: string;
  /** 备注（可选，≤ 200 字） */
  note?: string;
  /** 举报时间（毫秒） */
  time: number;
}

export const REPORT_REASONS = [
  { id: 'cheat', label: '作弊 / 外挂' },
  { id: 'abusive', label: '辱骂 / 骚扰' },
  { id: 'toxic', label: '恶意行为（堵路/送人头）' },
  { id: 'other', label: '其他' },
] as const;

const REPORTS_KEY = 'zhandi.reports.v1';
const MAX_REPORTS = 50;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadReports(
  storage: Pick<Storage, 'getItem'> = localStorage,
): ReportEntry[] {
  try {
    const raw = storage.getItem(REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ReportEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as ReportEntry).targetId === 'string' &&
        typeof (e as ReportEntry).reason === 'string',
    );
  } catch {
    return [];
  }
}

export function addReport(
  entry: Omit<ReportEntry, 'id' | 'time'>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): ReportEntry {
  const reports = loadReports(storage);
  const full: ReportEntry = {
    ...entry,
    id: newId(),
    time: Date.now(),
    note: (entry.note ?? '').trim().slice(0, 200),
  };
  reports.push(full);
  // 保留最新 MAX_REPORTS 条
  storage.setItem(REPORTS_KEY, JSON.stringify(reports.slice(-MAX_REPORTS)));
  return full;
}

export function clearReports(
  storage: Pick<Storage, 'removeItem'> = localStorage,
): void {
  storage.removeItem(REPORTS_KEY);
}
