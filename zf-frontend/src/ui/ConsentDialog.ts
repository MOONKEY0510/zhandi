import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

/**
 * 崩溃/错误匿名统计同意对话框（阶段 10 P0）。
 * 首次询问「是否同意匿名统计帮助改进游戏」，onResult(granted) 回调；
 * 接入统一主题与 FocusManager（键盘可导航）。
 */
export class ConsentDialog {
  readonly container: HTMLElement;
  onResult: ((granted: boolean) => void) | null = null;

  private focusManager: FocusManager | null = null;

  constructor() {
    applyThemeRoot();
    this.container = document.createElement('div');
    this.container.id = 'consent-dialog';
    this.container.style.cssText = `
      position: fixed; inset: 0; z-index: 1250;
      background: rgba(0, 0, 0, 0.75);
      display: none; align-items: center; justify-content: center;
      font-family: ${UI_THEME.fontFamily}; color: ${UI_THEME.colors.text};
    `;
    this.container.innerHTML = `
      <div class="ui-panel" style="width:min(520px, 90vw); padding:${UI_THEME.spacing.lg};">
        <h2 style="margin:0 0 12px; font-size:22px;">帮助我们改进 ZHANDI</h2>
        <p style="color:${UI_THEME.colors.textDim}; line-height:1.8; margin:0 0 8px;">
          是否允许我们收集<strong style="color:${UI_THEME.colors.text};">匿名的崩溃与错误统计</strong>？
          仅包含错误类型、发生时间等运行信息，<strong style="color:${UI_THEME.colors.text};">不包含昵称、聊天或任何个人信息</strong>，可随时在设置中更改。
        </p>
        <div style="display:flex; gap:10px; margin-top:${UI_THEME.spacing.md};">
          <button id="consent-accept" class="ui-btn ui-btn-primary" style="flex:1; padding:12px;">同意并帮助改进</button>
          <button id="consent-decline" class="ui-btn ui-btn-ghost" style="flex:1; padding:12px;">拒绝</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);
    this.container.querySelector('#consent-accept')?.addEventListener('click', () => {
      this.onResult?.(true);
    });
    this.container.querySelector('#consent-decline')?.addEventListener('click', () => {
      this.onResult?.(false);
    });
    this.focusManager = new FocusManager(this.container);
  }

  show(): void {
    this.container.style.display = 'flex';
    this.focusManager?.focusFirst();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.focusManager?.dispose();
    this.focusManager = null;
    this.container.remove();
  }
}
