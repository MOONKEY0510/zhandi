/**
 * 字幕覆盖层（阶段 10 P0：操作可访问性——关键音频信息有视觉替代）。
 * 屏幕底部中央显示战场"播报"字幕（回合阶段/击杀/据点易主/胜负等关键音频信息的视觉替代）。
 * 支持：新字幕替换旧字幕、淡入淡出、设置开关（showSubtitles，关闭时立即隐藏并丢弃后续字幕）。
 */
export class SubtitleOverlay {
  container: HTMLElement;
  private textEl: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;
  private visible = false;

  /** 默认显示时长（毫秒） */
  static readonly DEFAULT_DURATION_MS = 3000;
  /** 淡出后延迟隐藏容器的缓冲（毫秒） */
  private static readonly FADE_OUT_MS = 240;

  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed; left: 50%; bottom: 12%; transform: translateX(-50%);
      z-index: 190; max-width: min(720px, 86vw); box-sizing: border-box;
      display: none; justify-content: center; pointer-events: none;
    `;
    this.textEl = document.createElement('div');
    this.textEl.style.cssText = `
      padding: 10px 22px; border-radius: 8px;
      background: rgba(0, 0, 0, 0.72); border: 1px solid rgba(255, 255, 255, 0.18);
      color: #fff; font-family: var(--ui-font); font-size: 17px; font-weight: 600;
      text-align: center; letter-spacing: 0.5px;
      opacity: 0; transition: opacity 220ms ease;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    `;
    this.container.appendChild(this.textEl);
  }

  attach(): void {
    if (!this.container.parentNode) document.body.appendChild(this.container);
  }

  detach(): void {
    if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
  }

  /** 是否开启字幕（设置：显示字幕）。关闭时立即隐藏并丢弃后续字幕。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hideNow();
  }

  /**
   * 显示一条字幕：新字幕替换旧字幕并重置显示计时。
   * @param text 字幕文案（关键音频信息的视觉替代）
   * @param durationMs 显示时长，默认 3s；据点易主/胜负等关键播报可传更长
   */
  show(text: string, durationMs = SubtitleOverlay.DEFAULT_DURATION_MS): void {
    if (!this.enabled) return;
    this.attach();
    this.textEl.textContent = text;
    this.container.style.display = 'flex';
    // 强制重排，确保从 opacity 0 触发过渡
    void this.textEl.offsetWidth;
    this.textEl.style.opacity = '1';
    this.visible = true;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(
      () => this.hideNow(),
      Math.max(500, durationMs),
    );
  }

  /** 当前是否可见（测试/诊断用） */
  isVisible(): boolean {
    return this.visible;
  }

  private hideNow(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.textEl.style.opacity = '0';
    this.visible = false;
    // 淡出动画结束后再隐藏容器，避免残留不可见元素
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      if (!this.visible && this.container.style.display !== 'none') {
        this.container.style.display = 'none';
      }
    }, SubtitleOverlay.FADE_OUT_MS);
  }

  dispose(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.detach();
  }
}
