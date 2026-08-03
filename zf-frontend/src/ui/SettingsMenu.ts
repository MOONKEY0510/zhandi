import { loadGameSettings, type GameSettings } from '../config';

export class SettingsMenu {
  container: HTMLElement;
  private readonly elements: Record<
    'volume' | 'sensitivity' | 'adsSensitivity' | 'fov' | 'invertY' | 'graphics',
    HTMLInputElement | HTMLSelectElement | null
  > = {
    volume: null,
    sensitivity: null,
    adsSensitivity: null,
    fov: null,
    invertY: null,
    graphics: null,
  };

  onApply: ((settings: GameSettings) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor() {
    this.container = this.createSettingsMenu();
  }

  setSettings(settings: GameSettings): void {
    if (this.elements.volume) this.elements.volume.value = String(settings.volume);
    if (this.elements.sensitivity) this.elements.sensitivity.value = String(settings.sensitivity);
    if (this.elements.adsSensitivity) {
      this.elements.adsSensitivity.value = String(Math.round(settings.adsSensitivityMultiplier * 100));
    }
    if (this.elements.fov) this.elements.fov.value = String(settings.fov);
    if (this.elements.invertY instanceof HTMLInputElement) this.elements.invertY.checked = settings.invertY;
    if (this.elements.graphics) this.elements.graphics.value = settings.graphics;
  }

  show(): void {
    this.setSettings(loadGameSettings());
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.container.remove();
  }

  private createSettingsMenu(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'settings-menu';
    container.style.cssText = `
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8); display: none;
      align-items: center; justify-content: center; z-index: 1001;
      font-family: Arial, sans-serif; color: white;
    `;
    container.innerHTML = `
      <div style="background:rgba(20,20,30,.95);padding:32px;border-radius:10px;width:420px;max-height:85vh;overflow:auto">
        <h2 style="text-align:center;margin:0 0 24px">设置</h2>
        ${this.slider('volume', '主音量', 0, 100, 80)}
        ${this.slider('sensitivity', '鼠标灵敏度', 1, 100, 50)}
        ${this.slider('ads-sensitivity', 'ADS 灵敏度倍率（%）', 10, 100, 80)}
        ${this.slider('fov', '视野 FOV', 60, 100, 75)}
        <label style="display:flex;gap:10px;align-items:center;margin-bottom:20px">
          <input type="checkbox" id="invert-y"> 反转 Y 轴
        </label>
        <label style="display:block;margin-bottom:24px">画质
          <select id="graphics" style="width:100%;padding:10px;margin-top:8px;background:#2a2a2a;border:1px solid #555;color:white;border-radius:5px">
            <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select>
        </label>
        <div style="display:flex;gap:10px">
          <button id="apply-button" style="flex:1;padding:12px;background:#ffcc00;border:0;border-radius:5px;font-weight:bold;cursor:pointer">应用</button>
          <button id="cancel-button" style="flex:1;padding:12px;background:transparent;border:2px solid #666;border-radius:5px;color:white;cursor:pointer">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    this.elements.volume = container.querySelector('#volume');
    this.elements.sensitivity = container.querySelector('#sensitivity');
    this.elements.adsSensitivity = container.querySelector('#ads-sensitivity');
    this.elements.fov = container.querySelector('#fov');
    this.elements.invertY = container.querySelector('#invert-y');
    this.elements.graphics = container.querySelector('#graphics');

    container.querySelector('#apply-button')?.addEventListener('click', () => this.onApply?.(this.readSettings()));
    container.querySelector('#cancel-button')?.addEventListener('click', () => this.onCancel?.());
    this.setSettings(loadGameSettings());
    return container;
  }

  private readSettings(): GameSettings {
    return {
      volume: Number(this.elements.volume?.value ?? 80),
      sensitivity: Number(this.elements.sensitivity?.value ?? 50),
      adsSensitivityMultiplier: Number(this.elements.adsSensitivity?.value ?? 80) / 100,
      fov: Number(this.elements.fov?.value ?? 75),
      invertY: this.elements.invertY instanceof HTMLInputElement && this.elements.invertY.checked,
      graphics: (this.elements.graphics?.value ?? 'medium') as GameSettings['graphics'],
    };
  }

  private slider(id: string, label: string, min: number, max: number, value: number): string {
    return `<label style="display:block;margin-bottom:18px">${label}
      <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" style="width:100%;margin-top:8px">
    </label>`;
  }
}

export type { GameSettings } from '../config';
