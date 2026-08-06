import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

export class MainMenu {
  container: HTMLElement;
  elements: {
    title: HTMLElement | null;
    playButton: HTMLElement | null;
    settingsButton: HTMLElement | null;
    quitButton: HTMLElement | null;
    version: HTMLElement | null;
  } = {
    title: null,
    playButton: null,
    settingsButton: null,
    quitButton: null,
    version: null,
  };

  onPlay: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  private focusManager: FocusManager | null = null;

  constructor() {
    applyThemeRoot();
    this.container = this.createMainMenu();
  }

  private createMainMenu(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'main-menu';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${UI_THEME.colors.bgGradient};
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: ${UI_THEME.fontFamily};
      color: ${UI_THEME.colors.text};
    `;

    container.innerHTML = `
      <h1 id="title" style="font-size: 72px; margin-bottom: 10px; text-shadow: 0 0 20px rgba(255, 204, 0, 0.5); letter-spacing: 0.08em;">ZHANDI</h1>
      <p style="font-size: 18px; color: ${UI_THEME.colors.textDim}; margin-bottom: 60px;">Tactical FPS</p>

      <div style="display: flex; flex-direction: column; gap: ${UI_THEME.spacing.sm}; width: 300px;">
        <button id="play-button" class="ui-btn ui-btn-primary" style="
          padding: 15px 40px;
          font-size: 20px;
        ">开始游戏</button>

        <button id="settings-button" class="ui-btn ui-btn-ghost" style="
          padding: 15px 40px;
          font-size: 18px;
        ">设置</button>

        <button id="quit-button" class="ui-btn ui-btn-ghost" style="
          padding: 15px 40px;
          font-size: 18px;
        ">退出</button>
      </div>

      <p id="version" style="position: absolute; bottom: 20px; font-size: 14px; color: ${UI_THEME.colors.textMuted};">v1.0.0</p>
    `;

    document.body.appendChild(container);

    this.elements.title = container.querySelector('#title');
    this.elements.playButton = container.querySelector('#play-button');
    this.elements.settingsButton = container.querySelector('#settings-button');
    this.elements.quitButton = container.querySelector('#quit-button');
    this.elements.version = container.querySelector('#version');

    this.focusManager = new FocusManager(container);
    this.setupEventListeners();

    return container;
  }

  private setupEventListeners(): void {
    if (this.elements.playButton) {
      this.elements.playButton.addEventListener('click', () => {
        this.onPlay?.();
      });
    }

    if (this.elements.settingsButton) {
      this.elements.settingsButton.addEventListener('click', () => {
        this.onSettings?.();
      });
    }

    if (this.elements.quitButton) {
      this.elements.quitButton.addEventListener('click', () => {
        this.onQuit?.();
      });
    }
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
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
