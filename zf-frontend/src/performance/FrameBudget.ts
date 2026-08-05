/**
 * 帧预算采集器（阶段 9 P0：拆解帧预算，"有预算、有数据"）。
 * 按《仿战地5分阶段优化计划》建议帧预算表（中画质 60 FPS）拆分 CPU 各阶段耗时：
 *   玩家/战斗模拟 1.0/2.0、AI 2.5/5.0、物理 2.0/4.0、动画 1.5/3.0、
 *   网络处理 0.7/1.5、UI 0.7/1.5、渲染提交+GPU 7.0/12.0（平均预算 / P95 上限 ms）。
 *
 * 用法：帧循环内 begin('physics') → 物理 step → end('physics')；同一段跨帧/嵌套
 * 由调用方保证配对（end 无 begin 时静默忽略，begin 覆盖未 end 的旧起点）。
 * 滚动窗口内统计各段：最近耗时、均值、P50/P95、峰值、超预算次数。
 * 纯逻辑、无 DOM，时钟可注入（测试用确定性时钟）；分位排序仅发生在采样调用时
 * （低频面板刷新），不在每帧热路径上。
 */

export type FrameBudgetSectionId =
  | 'simulation'
  | 'ai'
  | 'physics'
  | 'animation'
  | 'network'
  | 'ui'
  | 'render';

export interface FrameBudgetSectionDef {
  id: FrameBudgetSectionId;
  /** 显示名（面板/报告用） */
  label: string;
  /** 平均预算 ms（建议帧预算表） */
  budgetMs: number;
  /** P95 上限 ms */
  p95LimitMs: number;
}

/** 建议帧预算表（与计划文档「建议帧预算（中画质 60 FPS）」逐项对齐） */
export const FRAME_BUDGET_TABLE: readonly FrameBudgetSectionDef[] = [
  { id: 'simulation', label: '玩家/战斗模拟', budgetMs: 1.0, p95LimitMs: 2.0 },
  { id: 'ai', label: 'AI', budgetMs: 2.5, p95LimitMs: 5.0 },
  { id: 'physics', label: '物理', budgetMs: 2.0, p95LimitMs: 4.0 },
  { id: 'animation', label: '动画', budgetMs: 1.5, p95LimitMs: 3.0 },
  { id: 'network', label: '网络处理', budgetMs: 0.7, p95LimitMs: 1.5 },
  { id: 'ui', label: 'UI', budgetMs: 0.7, p95LimitMs: 1.5 },
  { id: 'render', label: '渲染提交 + GPU', budgetMs: 7.0, p95LimitMs: 12.0 },
] as const;

export interface FrameBudgetSectionStats {
  id: FrameBudgetSectionId;
  label: string;
  budgetMs: number;
  p95LimitMs: number;
  /** 最近一帧耗时 ms（未采样过为 0） */
  lastMs: number;
  /** 窗口内均值 ms */
  avgMs: number;
  /** 窗口内 P50 ms */
  p50Ms: number;
  /** 窗口内 P95 ms */
  p95Ms: number;
  /** 窗口内峰值 ms */
  maxMs: number;
  /** 窗口内样本数 */
  samples: number;
  /** 窗口内超平均预算次数 */
  overBudgetCount: number;
}

export class FrameBudget {
  /** 滚动窗口帧数（默认 300 ≈ 5s@60fps，足够观察抖动又不拖长 P95 反应） */
  readonly windowSize: number;
  private readonly now: () => number;
  private readonly starts = new Map<FrameBudgetSectionId, number>();
  private readonly samples = new Map<FrameBudgetSectionId, number[]>();
  private readonly overBudget = new Map<FrameBudgetSectionId, number>();

  constructor(windowSize = 300, now: () => number = () => performance.now()) {
    this.windowSize = windowSize;
    this.now = now;
    for (const def of FRAME_BUDGET_TABLE) {
      this.samples.set(def.id, []);
      this.overBudget.set(def.id, 0);
    }
  }

  /** 开始计时某段（覆盖未 end 的旧起点，防御嵌套/漏配对） */
  begin(id: FrameBudgetSectionId): void {
    this.starts.set(id, this.now());
  }

  /** 结束计时并计入窗口（无 begin 时静默忽略） */
  end(id: FrameBudgetSectionId): void {
    const start = this.starts.get(id);
    if (start === undefined) return;
    this.starts.delete(id);
    const elapsed = Math.max(0, this.now() - start);
    const window = this.samples.get(id);
    if (!window) return;
    window.push(elapsed);
    if (window.length > this.windowSize) window.shift();
    const def = FRAME_BUDGET_TABLE.find((d) => d.id === id);
    if (def && elapsed > def.budgetMs) {
      this.overBudget.set(id, (this.overBudget.get(id) ?? 0) + 1);
    }
  }

  /** 单段统计（采样用：低频调用，内部排序会分配） */
  stats(id: FrameBudgetSectionId): FrameBudgetSectionStats {
    const def = FRAME_BUDGET_TABLE.find((d) => d.id === id);
    const window = this.samples.get(id) ?? [];
    return {
      id,
      label: def?.label ?? id,
      budgetMs: def?.budgetMs ?? 0,
      p95LimitMs: def?.p95LimitMs ?? 0,
      lastMs: window.length > 0 ? window[window.length - 1] : 0,
      avgMs: window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : 0,
      p50Ms: percentile(window, 0.5),
      p95Ms: percentile(window, 0.95),
      maxMs: window.length > 0 ? Math.max(...window) : 0,
      samples: window.length,
      overBudgetCount: this.overBudget.get(id) ?? 0,
    };
  }

  /** 全段统计（面板/报告用） */
  allStats(): FrameBudgetSectionStats[] {
    return FRAME_BUDGET_TABLE.map((def) => this.stats(def.id));
  }

  /** 全部段都在平均预算内 */
  isWithinBudget(): boolean {
    return FRAME_BUDGET_TABLE.every((def) => this.stats(def.id).avgMs <= def.budgetMs);
  }

  reset(): void {
    this.starts.clear();
    for (const def of FRAME_BUDGET_TABLE) {
      this.samples.set(def.id, []);
      this.overBudget.set(def.id, 0);
    }
  }
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, ratio));
  const index = Math.ceil(clamped * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
