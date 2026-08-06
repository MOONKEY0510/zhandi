import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

export class MainMenu {
  container: HTMLElement;
  elements: {
    title: HTMLElement | null;
    playButton: HTMLElement | null;
    trainingButton: HTMLElement | null;
    settingsButton: HTMLElement | null;
    quitButton: HTMLElement | null;
    version: HTMLElement | null;
  } = {
    title: null,
    playButton: null,
    trainingButton: null,
    settingsButton: null,
    quitButton: null,
    version: null,
  };

  onPlay: (() => void) | null = null;
  onTraining: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  private focusManager: FocusManager | null = null;

  private selectedMap: 'berlin_ruins' | 'ardennes' | 'normandy_beach' = 'berlin_ruins';

  getSelectedMap(): 'berlin_ruins' | 'ardennes' | 'normandy_beach' {
    return this.selectedMap;
  }

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

        <div style="display: flex; gap: 8px; justify-content: center;">
          <button id="map-berlin" class="ui-btn ui-btn-ghost map-select" style="padding: 10px 12px; font-size: 13px; border: 2px solid ${UI_THEME.colors.accent};">柏林</button>
          <button id="map-ardennes" class="ui-btn ui-btn-ghost map-select" style="padding: 10px 12px; font-size: 13px;">阿登</button>
          <button id="map-normandy" class="ui-btn ui-btn-ghost map-select" style="padding: 10px 12px; font-size: 13px;">诺曼底</button>
        </div>
        <p id="map-hint" style="font-size: 13px; color: ${UI_THEME.colors.textDim}; text-align: center; margin-top: -4px;">当前地图：柏林废墟</p>

        <button id="training-button" class="ui-btn ui-btn-ghost" style="
          padding: 15px 40px;
          font-size: 18px;
        ">训练场</button>

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
    this.elements.trainingButton = container.querySelector('#training-button');
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

    // 地图选择（阶段 10+ 新特性：第二张地图）
    const berlinBtn = this.container.querySelector<HTMLElement>('#map-berlin');
    const ardennesBtn = this.container.querySelector<HTMLElement>('#map-ardennes');
    const normandyBtn = this.container.querySelector<HTMLElement>('#map-normandy');
    const mapHint = this.container.querySelector<HTMLElement>('#map-hint');
    const MAP_LABELS = { berlin_ruins: '柏林废墟', ardennes: '阿登森林', normandy_beach: '诺曼底海滩' } as const;
    const highlight = (selected: 'berlin_ruins' | 'ardennes' | 'normandy_beach') => {
      berlinBtn?.style.setProperty('border-color', selected === 'berlin_ruins' ? UI_THEME.colors.accent : 'transparent');
      ardennesBtn?.style.setProperty('border-color', selected === 'ardennes' ? UI_THEME.colors.accent : 'transparent');
      normandyBtn?.style.setProperty('border-color', selected === 'normandy_beach' ? UI_THEME.colors.accent : 'transparent');
      if (mapHint) mapHint.textContent = `当前地图：${MAP_LABELS[selected]}`;
    };
    berlinBtn?.addEventListener('click', () => {
      this.selectedMap = 'berlin_ruins';
      highlight('berlin_ruins');
    });
    ardennesBtn?.addEventListener('click', () => {
      this.selectedMap = 'ardennes';
      highlight('ardennes');
    });
    normandyBtn?.addEventListener('click', () => {
      this.selectedMap = 'normandy_beach';
      highlight('normandy_beach');
    });

    if (this.elements.trainingButton) {
      this.elements.trainingButton.addEventListener('click', () => {
        this.onTraining?.();
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
