import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

export interface FirstRunResult {
  nickname: string;
  graphics: 'low' | 'medium' | 'high';
  volumeMaster: number;
  sensitivity: number;
  showSubtitles: boolean;
}

const STEPS = ['欢迎', '基础设置', '昵称'];

/**
 * 首次设置向导（阶段 10 P0：完整流程「首次设置 → 主菜单」）。
 * 三步：欢迎 → 画质/音量/灵敏度 → 昵称与字幕；完成后 onComplete 回调。
 * 接入统一主题与 FocusManager（键盘全程可导航）。
 */
export class FirstRunWizard {
  readonly container: HTMLElement;
  onComplete: ((result: FirstRunResult) => void) | null = null;

  private step = 0;
  private nickname = '';
  private graphics: FirstRunResult['graphics'] = 'medium';
  private volumeMaster = 80;
  private sensitivity = 50;
  private showSubtitles = true;
  private focusManager: FocusManager | null = null;

  constructor() {
    applyThemeRoot();
    this.container = document.createElement('div');
    this.container.id = 'first-run-wizard';
    this.container.style.cssText = `
      position: fixed; inset: 0; z-index: 1200;
      background: ${UI_THEME.colors.bgGradient};
      display: none; align-items: center; justify-content: center;
      font-family: ${UI_THEME.fontFamily}; color: ${UI_THEME.colors.text};
    `;
    document.body.appendChild(this.container);
    this.render();
  }

  show(): void {
    this.step = 0;
    this.render();
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.focusManager?.dispose();
    this.focusManager = null;
    this.container.remove();
  }

  getStep(): number {
    return this.step;
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="ui-panel" style="width:min(560px, 90vw); padding:${UI_THEME.spacing.lg};">
        <header style="text-align:center; margin-bottom:${UI_THEME.spacing.md};">
          <div style="color:${UI_THEME.colors.gold}; letter-spacing:0.18em; font-size:13px;">首次设置</div>
          <h1 style="margin:8px 0 4px; font-size:28px;">ZHANDI</h1>
          <div style="color:${UI_THEME.colors.textMuted}; font-size:14px;">第 ${this.step + 1} / ${STEPS.length} 步 · ${STEPS[this.step]}</div>
          <div style="display:flex; gap:6px; justify-content:center; margin-top:12px;">
            ${STEPS.map((_, i) => `<div style="width:28px; height:4px; border-radius:2px; background:${i <= this.step ? UI_THEME.colors.accent : UI_THEME.colors.border};"></div>`).join('')}
          </div>
        </header>
        ${this.stepContent()}
        <footer style="display:flex; gap:10px; margin-top:${UI_THEME.spacing.md};">
          ${this.step > 0 ? '<button id="wizard-back" class="ui-btn ui-btn-ghost" style="flex:1; padding:12px;">上一步</button>' : ''}
          <button id="wizard-next" class="ui-btn ui-btn-primary" style="flex:1; padding:12px;">${this.step === STEPS.length - 1 ? '完成' : '下一步'}</button>
        </footer>
      </div>
    `;

    this.container.querySelector('#wizard-back')?.addEventListener('click', () => {
      this.step -= 1;
      this.render();
      this.focusManager?.focusFirst();
    });
    this.container.querySelector('#wizard-next')?.addEventListener('click', () => {
      this.advance();
    });
    this.container.querySelector('#wizard-nickname')?.addEventListener('input', (e) => {
      this.nickname = (e.target as HTMLInputElement).value;
    });
    this.container.querySelector('#wizard-graphics')?.addEventListener('change', (e) => {
      this.graphics = (e.target as HTMLSelectElement).value as FirstRunResult['graphics'];
    });
    this.container.querySelector('#wizard-volume')?.addEventListener('input', (e) => {
      this.volumeMaster = Number((e.target as HTMLInputElement).value);
    });
    this.container.querySelector('#wizard-sensitivity')?.addEventListener('input', (e) => {
      this.sensitivity = Number((e.target as HTMLInputElement).value);
    });
    this.container.querySelector('#wizard-subtitles')?.addEventListener('change', (e) => {
      this.showSubtitles = (e.target as HTMLInputElement).checked;
    });

    this.focusManager?.dispose();
    this.focusManager = new FocusManager(this.container);
    this.focusManager.focusFirst();
  }

  private stepContent(): string {
    switch (this.step) {
      case 0:
        return `
          <p style="color:${UI_THEME.colors.textDim}; line-height:1.8; text-align:center;">
            欢迎来到 ZHANDI！这是一次性基础设置，约 30 秒即可完成，之后随时可在「设置」中调整。
          </p>
          <ul style="color:${UI_THEME.colors.textMuted}; font-size:14px; line-height:2; margin:16px 0 0; padding-left:20px;">
            <li>画质与音量</li>
            <li>鼠标灵敏度</li>
            <li>昵称与字幕</li>
          </ul>
        `;
      case 1:
        return `
          <label style="display:block; margin-bottom:18px;">画质
            <select id="wizard-graphics" style="width:100%; padding:10px; margin-top:8px; background:#2a2a2a; border:1px solid #555; color:white; border-radius:5px;">
              <option value="low" ${this.graphics === 'low' ? 'selected' : ''}>低（流畅优先）</option>
              <option value="medium" ${this.graphics === 'medium' ? 'selected' : ''}>中（平衡）</option>
              <option value="high" ${this.graphics === 'high' ? 'selected' : ''}>高（画质优先）</option>
            </select>
          </label>
          <label style="display:block; margin-bottom:18px;">主音量
            <input type="range" id="wizard-volume" min="0" max="100" value="${this.volumeMaster}" style="width:100%; margin-top:8px;">
          </label>
          <label style="display:block; margin-bottom:18px;">鼠标灵敏度
            <input type="range" id="wizard-sensitivity" min="1" max="100" value="${this.sensitivity}" style="width:100%; margin-top:8px;">
          </label>
        `;
      case 2:
        return `
          <label style="display:block; margin-bottom:18px;">玩家昵称
            <input id="wizard-nickname" type="text" maxlength="24" placeholder="输入昵称（默认：士兵）"
              value="${this.nickname}" style="width:100%; padding:10px; margin-top:8px; box-sizing:border-box; background:#2a2a2a; border:1px solid #555; color:white; border-radius:5px;">
          </label>
          <label style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
            <input type="checkbox" id="wizard-subtitles" ${this.showSubtitles ? 'checked' : ''}> 显示字幕（关键音频信息的视觉替代）
          </label>
        `;
      default:
        return '';
    }
  }

  private advance(): void {
    if (this.step < STEPS.length - 1) {
      this.step += 1;
      this.render();
      this.focusManager?.focusFirst();
      return;
    }
    this.onComplete?.({
      nickname: this.nickname.trim() || '士兵',
      graphics: this.graphics,
      volumeMaster: this.volumeMaster,
      sensitivity: this.sensitivity,
      showSubtitles: this.showSubtitles,
    });
  }
}
