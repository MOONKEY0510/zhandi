import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';
import { REPORT_REASONS } from '../config/Reports';

/**
 * 举报玩家对话框（阶段 10 P1：回放/观战与举报入口）。
 * 结算界面「举报玩家」按钮打开：选择玩家 + 理由 + 备注 → 提交（本地记录，
 * 未来联网上报端点接入时替换提交实现）。键盘全程可导航。
 */

export interface ReportablePlayer {
  id: string;
  name: string;
  team?: string;
}

export interface ReportSubmission {
  targetId: string;
  targetName: string;
  reason: string;
  note: string;
}

export class ReportDialog {
  container: HTMLElement;
  private playerSelect: HTMLSelectElement | null = null;
  private reasonButtons: Map<string, HTMLButtonElement> = new Map();
  private noteInput: HTMLTextAreaElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private players: ReportablePlayer[] = [];
  private selectedReason = 'cheat';
  private focusManager: FocusManager | null = null;

  onSubmitted: ((report: ReportSubmission) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor() {
    applyThemeRoot();
    this.container = document.createElement('div');
    this.container.id = 'report-dialog';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      display: none;
      align-items: center; justify-content: center;
      z-index: 240;
      background: rgba(0, 0, 0, 0.6);
      font-family: ${UI_THEME.fontFamily};
      color: ${UI_THEME.colors.text};
    `;

    this.container.innerHTML = `
      <div class="ui-panel" style="width: 460px; max-width: 92vw; padding: 24px 28px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0; font-size: 24px; letter-spacing: 0.06em; color: ${UI_THEME.colors.gold};">举报玩家</h2>
          <button id="report-cancel" class="ui-btn ui-btn-ghost" style="padding: 6px 14px;">取消</button>
        </div>

        <label style="display: block; font-size: 14px; color: ${UI_THEME.colors.textDim}; margin-bottom: 6px;">选择玩家</label>
        <select id="report-player" style="
          width: 100%; padding: 9px 12px; margin-bottom: 16px;
          background: ${UI_THEME.colors.bgPanelSolid};
          color: ${UI_THEME.colors.text};
          border: 1px solid ${UI_THEME.colors.border};
          border-radius: ${UI_THEME.radius.sm};
          font-size: 15px; font-family: inherit;
        "></select>

        <label style="display: block; font-size: 14px; color: ${UI_THEME.colors.textDim}; margin-bottom: 6px;">举报理由</label>
        <div id="report-reasons" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;"></div>

        <label style="display: block; font-size: 14px; color: ${UI_THEME.colors.textDim}; margin-bottom: 6px;">备注（可选）</label>
        <textarea id="report-note" rows="3" maxlength="200" placeholder="补充描述…" style="
          width: 100%; padding: 9px 12px; margin-bottom: 18px; resize: vertical;
          background: ${UI_THEME.colors.bgPanelSolid};
          color: ${UI_THEME.colors.text};
          border: 1px solid ${UI_THEME.colors.border};
          border-radius: ${UI_THEME.radius.sm};
          font-size: 15px; font-family: inherit;
        "></textarea>

        <button id="report-submit" class="ui-btn ui-btn-primary" style="width: 100%; padding: 12px 0; font-size: 17px;">
          提交举报
        </button>
        <p id="report-hint" style="margin: 10px 0 0; font-size: 13px; color: ${UI_THEME.colors.textMuted}; text-align: center;">
          举报将本地记录；联网上报功能接入后自动同步。
        </p>
      </div>
    `;

    document.body.appendChild(this.container);

    this.playerSelect = this.container.querySelector('#report-player');
    this.noteInput = this.container.querySelector('#report-note');
    this.submitButton = this.container.querySelector('#report-submit');

    // 理由按钮组
    const reasonsEl = this.container.querySelector('#report-reasons') as HTMLElement;
    for (const reason of REPORT_REASONS) {
      const btn = document.createElement('button');
      btn.className = 'ui-btn ui-btn-ghost';
      btn.textContent = reason.label;
      btn.style.padding = '6px 12px';
      btn.style.fontSize = '14px';
      btn.dataset.reason = reason.id;
      btn.addEventListener('click', () => this.selectReason(reason.id));
      reasonsEl.appendChild(btn);
      this.reasonButtons.set(reason.id, btn);
    }

    this.container.querySelector('#report-cancel')?.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
    this.submitButton?.addEventListener('click', () => this.submit());
    this.playerSelect?.addEventListener('change', () => {
      if (this.submitButton) this.submitButton.disabled = false;
    });

    this.focusManager = new FocusManager(this.container);
    this.selectReason('cheat');
    this.applyReasonStyles();
  }

  private selectReason(reason: string): void {
    this.selectedReason = reason;
    this.applyReasonStyles();
  }

  private applyReasonStyles(): void {
    for (const [id, btn] of this.reasonButtons) {
      const active = id === this.selectedReason;
      btn.style.background = active ? UI_THEME.colors.bgActive : 'transparent';
      btn.style.borderColor = active ? UI_THEME.colors.accent : UI_THEME.colors.border;
      btn.style.color = active ? UI_THEME.colors.accent : UI_THEME.colors.textDim;
    }
  }

  /** 打开对话框：填充玩家下拉（首个玩家默认选中） */
  show(players: ReportablePlayer[]): void {
    this.players = players;
    this.selectedReason = 'cheat';
    this.applyReasonStyles();
    if (this.noteInput) this.noteInput.value = '';

    if (this.playerSelect) {
      this.playerSelect.innerHTML = players
        .map((p) => `<option value="${p.id}">${p.name}${p.team ? `（${p.team === 'A' ? '德军' : '苏军'}）` : ''}</option>`)
        .join('');
      if (players.length > 0 && this.submitButton) {
        this.submitButton.disabled = false;
      }
    }

    this.container.style.display = 'flex';
    this.focusManager?.focusFirst();
  }

  private submit(): void {
    const player = this.players.find((p) => p.id === this.playerSelect?.value);
    if (!player) return;
    const submission: ReportSubmission = {
      targetId: player.id,
      targetName: player.name,
      reason: this.selectedReason,
      note: this.noteInput?.value ?? '',
    };
    this.hide();
    this.onSubmitted?.(submission);
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
