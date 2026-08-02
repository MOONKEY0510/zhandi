export class SettingsMenu {
  container: HTMLElement;
  elements: {
    volumeSlider: HTMLInputElement | null;
    sensitivitySlider: HTMLInputElement | null;
    graphicsSelect: HTMLSelectElement | null;
    applyButton: HTMLElement | null;
    cancelButton: HTMLElement | null;
  } = {
    volumeSlider: null,
    sensitivitySlider: null,
    graphicsSelect: null,
    applyButton: null,
    cancelButton: null,
  };

  onApply: ((settings: GameSettings) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor() {
    this.container = this.createSettingsMenu();
  }

  private createSettingsMenu(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'settings-menu';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1001;
      font-family: 'Arial', sans-serif;
      color: white;
    `;

    container.innerHTML = `
      <div style="background: rgba(20, 20, 30, 0.95); padding: 40px; border-radius: 10px; width: 400px;">
        <h2 style="text-align: center; margin-bottom: 30px;">设置</h2>

        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 10px;">主音量</label>
          <input type="range" id="volume-slider" min="0" max="100" value="80" style="width: 100%;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 10px;">鼠标灵敏度</label>
          <input type="range" id="sensitivity-slider" min="1" max="100" value="50" style="width: 100%;">
        </div>

        <div style="margin-bottom: 30px;">
          <label style="display: block; margin-bottom: 10px;">画质</label>
          <select id="graphics-select" style="width: 100%; padding: 10px; background: #2a2a2a; border: 1px solid #444; color: white; border-radius: 5px;">
            <option value="low">低</option>
            <option value="medium" selected>中</option>
            <option value="high">高</option>
          </select>
        </div>

        <div style="display: flex; gap: 10px;">
          <button id="apply-button" style="flex: 1; padding: 12px; background: #ffcc00; border: none; border-radius: 5px; color: #1a1a1a; font-weight: bold; cursor: pointer;">应用</button>
          <button id="cancel-button" style="flex: 1; padding: 12px; background: transparent; border: 2px solid #666; border-radius: 5px; color: white; cursor: pointer;">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    this.elements.volumeSlider = container.querySelector('#volume-slider');
    this.elements.sensitivitySlider = container.querySelector('#sensitivity-slider');
    this.elements.graphicsSelect = container.querySelector('#graphics-select');
    this.elements.applyButton = container.querySelector('#apply-button');
    this.elements.cancelButton = container.querySelector('#cancel-button');

    this.setupEventListeners();

    return container;
  }

  private setupEventListeners(): void {
    if (this.elements.applyButton) {
      this.elements.applyButton.addEventListener('click', () => {
        const settings: GameSettings = {
          volume: parseInt(this.elements.volumeSlider?.value || '80'),
          sensitivity: parseInt(this.elements.sensitivitySlider?.value || '50'),
          graphics: this.elements.graphicsSelect?.value || 'medium',
        };
        this.onApply?.(settings);
      });
    }

    if (this.elements.cancelButton) {
      this.elements.cancelButton.addEventListener('click', () => {
        this.onCancel?.();
      });
    }
  }

  show(): void {
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

export interface GameSettings {
  volume: number;
  sensitivity: number;
  graphics: string;
}
