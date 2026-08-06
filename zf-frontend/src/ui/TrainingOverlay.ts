import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';
import type { TrainingMode } from '../training/TrainingMode';

/**
 * 新手训练场 HUD（阶段 10 P1）：左上步骤列表 + 底部当前提示 + 完成弹窗。
 * pointer-events 仅完成弹窗可交互，训练过程不挡鼠标/键盘操作。
 */
export class TrainingOverlay {
  container: HTMLElement;
  private stepsEl: HTMLElement;
  private hintEl: HTMLElement;
  private completePanel: HTMLElement;
  private completeButton: HTMLElement | null = null;
  private focusManager: FocusManager | null = null;

  onBackToMenu: (() => void) | null = null;

  constructor() {
    applyThemeRoot();
    this.injectStyles();
    this.container = document.createElement('div');
    this.container.id = 'training-overlay';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 180;
      font-family: ${UI_THEME.fontFamily};
      color: ${UI_THEME.colors.text};
      display: none;
    `;

    this.container.innerHTML = `
      <div id="training-steps" style="
        position: absolute; top: 16px; left: 16px;
        background: rgba(10, 12, 16, 0.72);
        border: 1px solid ${UI_THEME.colors.border};
        border-radius: ${UI_THEME.radius.md};
        padding: ${UI_THEME.spacing.sm} ${UI_THEME.spacing.md};
        min-width: 220px;
      "></div>

      <div id="training-hint" style="
        position: absolute; bottom: 130px; left: 50%; transform: translateX(-50%);
        background: rgba(10, 12, 16, 0.78);
        border: 1px solid ${UI_THEME.colors.border};
        border-radius: ${UI_THEME.radius.md};
        padding: 10px 20px;
        font-size: 18px;
        letter-spacing: 0.04em;
        white-space: nowrap;
      "></div>

      <div id="training-complete" style="
        position: absolute; inset: 0;
        display: none;
        align-items: center; justify-content: center;
        pointer-events: auto;
        background: rgba(0, 0, 0, 0.55);
      ">
        <div class="ui-panel" style="text-align: center; padding: 36px 56px;">
          <h2 style="margin: 0 0 12px; font-size: 34px; letter-spacing: 0.06em; color: ${UI_THEME.colors.gold};">
            🎖 训练完成
          </h2>
          <p style="margin: 0 0 24px; font-size: 16px; color: ${UI_THEME.colors.textDim};">
            你已掌握基础战斗操作，准备进入战场吧！
          </p>
          <button id="training-back" class="ui-btn ui-btn-primary" style="font-size: 18px; padding: 12px 36px;">
            返回主菜单
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.stepsEl = this.container.querySelector('#training-steps') as HTMLElement;
    this.hintEl = this.container.querySelector('#training-hint') as HTMLElement;
    this.completePanel = this.container.querySelector('#training-complete') as HTMLElement;
    this.completeButton = this.container.querySelector('#training-back');

    this.focusManager = new FocusManager(this.completePanel);
    this.completeButton?.addEventListener('click', () => this.onBackToMenu?.());
  }

  /** 幂等注入步骤列表样式 */
  private injectStyles(): void {
    if (document.getElementById('training-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'training-overlay-styles';
    style.textContent = `
      #training-overlay .ts-item {
        padding: 5px 8px;
        font-size: 15px;
        border-radius: 6px;
        color: rgba(220, 224, 230, 0.45);
        transition: color 0.2s;
      }
      #training-overlay .ts-item.current {
        color: #ffcc00;
        font-weight: 600;
        background: rgba(255, 204, 0, 0.10);
      }
      #training-overlay .ts-item.done {
        color: rgba(120, 220, 130, 0.9);
      }
    `;
    document.head.appendChild(style);
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  /** 用训练模式状态刷新步骤列表与底部提示 */
  update(mode: TrainingMode): void {
    const done = new Set(mode.completedIdsList);
    const current = mode.current;

    this.stepsEl.innerHTML = mode.steps
      .map((step) => {
        const cls = done.has(step.id) ? 'done' : current?.id === step.id ? 'current' : 'todo';
        const icon = done.has(step.id) ? '✓' : current?.id === step.id ? '▶' : '○';
        return `<div class="ts-item ${cls}">${icon} ${step.title}</div>`;
      })
      .join('');

    this.hintEl.textContent = current ? current.description : '训练完成！';
  }

  /** 完成弹窗：显示并聚焦「返回主菜单」 */
  showComplete(): void {
    this.completePanel.style.display = 'flex';
    this.focusManager?.focusFirst();
  }

  dispose(): void {
    this.focusManager?.dispose();
    this.focusManager = null;
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
