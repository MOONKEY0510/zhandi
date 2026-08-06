import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';
import { REPLAY_EVENT_LABELS } from '../replay/ReplayRecorder';
import type { ReplayTimelineItem, ReplayEventType } from '../replay/ReplayRecorder';

/**
 * 战局回放面板（阶段 10 P1：回放/观战与举报入口）。
 * 结算界面「战局回放」按钮打开：本局关键事件时间线（击杀/阵亡/据点/载具），
 * 支持类型筛选，键盘全程可导航（FocusManager）。
 */

const FILTERS: { id: ReplayEventType | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'kill', label: '击杀' },
  { id: 'death', label: '阵亡' },
  { id: 'objective', label: '据点' },
  { id: 'vehicle', label: '载具' },
];

const TYPE_COLORS: Record<ReplayEventType, string> = {
  kill: '#ff6b6b',
  death: '#6ba6ff',
  objective: '#ffcc00',
  vehicle: '#c77dff',
  round_end: '#ffffff',
};

export class ReplayPanel {
  container: HTMLElement;
  private listEl: HTMLElement;
  private emptyEl: HTMLElement;
  private filterButtons: Map<ReplayEventType | 'all', HTMLButtonElement> = new Map();
  private currentFilter: ReplayEventType | 'all' = 'all';
  private items: ReplayTimelineItem[] = [];
  private focusManager: FocusManager | null = null;

  onClose: (() => void) | null = null;

  constructor() {
    applyThemeRoot();
    this.container = document.createElement('div');
    this.container.id = 'replay-panel';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      display: none;
      align-items: center; justify-content: center;
      z-index: 230;
      background: rgba(0, 0, 0, 0.6);
      font-family: ${UI_THEME.fontFamily};
      color: ${UI_THEME.colors.text};
    `;

    this.container.innerHTML = `
      <div class="ui-panel" style="width: 520px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; padding: 24px 28px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h2 style="margin: 0; font-size: 24px; letter-spacing: 0.06em; color: ${UI_THEME.colors.gold};">战局回放</h2>
          <button id="replay-close" class="ui-btn ui-btn-ghost" style="padding: 6px 14px;">关闭</button>
        </div>
        <div id="replay-filters" style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;"></div>
        <div id="replay-empty" style="display: none; padding: 24px 0; text-align: center; color: ${UI_THEME.colors.textMuted};">
          本局暂无该类型事件
        </div>
        <div id="replay-list" style="overflow-y: auto; flex: 1; min-height: 120px;"></div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.listEl = this.container.querySelector('#replay-list') as HTMLElement;
    this.emptyEl = this.container.querySelector('#replay-empty') as HTMLElement;

    const filtersEl = this.container.querySelector('#replay-filters') as HTMLElement;
    for (const filter of FILTERS) {
      const btn = document.createElement('button');
      btn.className = 'ui-btn ui-btn-ghost';
      btn.textContent = filter.label;
      btn.style.padding = '4px 14px';
      btn.style.fontSize = '14px';
      btn.dataset.filter = filter.id;
      btn.addEventListener('click', () => this.setFilter(filter.id));
      filtersEl.appendChild(btn);
      this.filterButtons.set(filter.id, btn);
    }

    const closeBtn = this.container.querySelector('#replay-close');
    closeBtn?.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });

    this.focusManager = new FocusManager(this.container);
    this.applyFilterStyles();
  }

  private applyFilterStyles(): void {
    for (const [id, btn] of this.filterButtons) {
      const active = id === this.currentFilter;
      btn.style.background = active ? UI_THEME.colors.bgActive : 'transparent';
      btn.style.borderColor = active ? UI_THEME.colors.accent : UI_THEME.colors.border;
      btn.style.color = active ? UI_THEME.colors.accent : UI_THEME.colors.textDim;
    }
  }

  private setFilter(filter: ReplayEventType | 'all'): void {
    this.currentFilter = filter;
    this.applyFilterStyles();
    this.render();
  }

  /** 传入本局时间线（已排序），按当前筛选渲染 */
  show(timeline: ReplayTimelineItem[]): void {
    this.items = timeline;
    this.currentFilter = 'all';
    this.applyFilterStyles();
    this.render();
    this.container.style.display = 'flex';
    this.focusManager?.focusFirst();
  }

  private render(): void {
    const filtered = this.currentFilter === 'all'
      ? this.items
      : this.items.filter((item) => item.type === this.currentFilter);

    this.emptyEl.style.display = filtered.length === 0 ? 'block' : 'none';
    this.listEl.innerHTML = filtered
      .map((item) => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-bottom: 1px solid ${UI_THEME.colors.border}; font-size: 15px;">
          <span style="color: ${UI_THEME.colors.textMuted}; font-variant-numeric: tabular-nums; min-width: 46px;">${item.clock}</span>
          <span style="color: ${TYPE_COLORS[item.type]}; min-width: 40px; font-size: 13px;">${REPLAY_EVENT_LABELS[item.type]}</span>
          <span style="flex: 1;">${item.label}</span>
        </div>
      `)
      .join('');
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.focusManager?.dispose();
    this.focusManager = null;
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
