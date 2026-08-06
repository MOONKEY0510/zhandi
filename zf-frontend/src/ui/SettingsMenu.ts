import { loadGameSettings, type GameSettings } from '../config';
import { applyThemeRoot, UI_THEME } from './theme';
import { FocusManager } from './focusManager';

export class SettingsMenu {
  container: HTMLElement;
  private readonly elements: Record<
    'volumeMaster' | 'volumeSfx' | 'volumeMusic' | 'volumeVoice' | 'sensitivity' | 'adsSensitivity' | 'fov' | 'invertY' | 'graphics' | 'resolutionScale' | 'reduceScreenShake' | 'colorBlindMode' | 'crosshairStyle' | 'crosshairColor' | 'crosshairScale' | 'showSubtitles',
    HTMLInputElement | HTMLSelectElement | null
  > = {
    volumeMaster: null,
    volumeSfx: null,
    volumeMusic: null,
    volumeVoice: null,
    sensitivity: null,
    adsSensitivity: null,
    fov: null,
    invertY: null,
    graphics: null,
    resolutionScale: null,
    reduceScreenShake: null,
    colorBlindMode: null,
    crosshairStyle: null,
    crosshairColor: null,
    crosshairScale: null,
    showSubtitles: null,
  };

  onApply: ((settings: GameSettings) => void) | null = null;
  onCancel: (() => void) | null = null;

  private focusManager: FocusManager | null = null;

  constructor() {
    applyThemeRoot();
    this.container = this.createSettingsMenu();
  }

  setSettings(settings: GameSettings): void {
    if (this.elements.volumeMaster) this.elements.volumeMaster.value = String(settings.volumeMaster);
    if (this.elements.volumeSfx) this.elements.volumeSfx.value = String(settings.volumeSfx);
    if (this.elements.volumeMusic) this.elements.volumeMusic.value = String(settings.volumeMusic);
    if (this.elements.volumeVoice) this.elements.volumeVoice.value = String(settings.volumeVoice);
    if (this.elements.sensitivity) this.elements.sensitivity.value = String(settings.sensitivity);
    if (this.elements.adsSensitivity) {
      this.elements.adsSensitivity.value = String(Math.round(settings.adsSensitivityMultiplier * 100));
    }
    if (this.elements.fov) this.elements.fov.value = String(settings.fov);
    if (this.elements.invertY instanceof HTMLInputElement) this.elements.invertY.checked = settings.invertY;
    if (this.elements.graphics) this.elements.graphics.value = settings.graphics;
    if (this.elements.resolutionScale) {
      this.elements.resolutionScale.value = String(Math.round(settings.resolutionScale * 100));
    }
    if (this.elements.reduceScreenShake instanceof HTMLInputElement) {
      this.elements.reduceScreenShake.checked = settings.reduceScreenShake;
    }
    if (this.elements.colorBlindMode) this.elements.colorBlindMode.value = settings.colorBlindMode;
    if (this.elements.crosshairStyle) this.elements.crosshairStyle.value = settings.crosshairStyle;
    if (this.elements.crosshairColor instanceof HTMLInputElement) {
      this.elements.crosshairColor.value = settings.crosshairColor;
    }
    if (this.elements.crosshairScale) {
      this.elements.crosshairScale.value = String(Math.round(settings.crosshairScale * 100));
    }
    if (this.elements.showSubtitles instanceof HTMLInputElement) {
      this.elements.showSubtitles.checked = settings.showSubtitles;
    }
  }

  show(): void {
    this.setSettings(loadGameSettings());
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

  private createSettingsMenu(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'settings-menu';
    container.style.cssText = `
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8); display: none;
      align-items: center; justify-content: center; z-index: 1001;
      font-family: ${UI_THEME.fontFamily}; color: ${UI_THEME.colors.text};
    `;
    container.innerHTML = `
      <div class="ui-panel" style="padding:${UI_THEME.spacing.lg};width:420px;max-height:85vh;overflow:auto">
        <h2 style="text-align:center;margin:0 0 24px">设置</h2>
        <h3 style="margin:0 0 12px;font-size:14px;color:#aaa">音量</h3>
        ${this.slider('volume-master', '主音量', 0, 100, 80)}
        ${this.slider('volume-sfx', '战斗音效', 0, 100, 80)}
        ${this.slider('volume-music', '环境音乐', 0, 100, 60)}
        ${this.slider('volume-voice', '语音/UI 提示', 0, 100, 80)}
        <h3 style="margin:20px 0 12px;font-size:14px;color:#aaa">操作</h3>
        ${this.slider('sensitivity', '鼠标灵敏度', 1, 100, 50)}
        ${this.slider('ads-sensitivity', 'ADS 灵敏度倍率（%）', 10, 100, 80)}
        ${this.slider('fov', '视野 FOV', 60, 100, 75)}
        <label style="display:flex;gap:10px;align-items:center;margin-bottom:20px">
          <input type="checkbox" id="invert-y"> 反转 Y 轴
        </label>
        <h3 style="margin:20px 0 12px;font-size:14px;color:#aaa">画面</h3>
        <label style="display:block;margin-bottom:24px">画质
          <select id="graphics" style="width:100%;padding:10px;margin-top:8px;background:#2a2a2a;border:1px solid #555;color:white;border-radius:5px">
            <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select>
        </label>
        ${this.slider('resolution-scale', '渲染分辨率比例（%）', 50, 150, 100)}
        <h3 style="margin:20px 0 12px;font-size:14px;color:#aaa">可访问性</h3>
        <label style="display:block;margin-bottom:18px">减少屏幕震动
          <input type="checkbox" id="reduce-screen-shake" style="margin-top:8px">
        </label>
        <label style="display:block;margin-bottom:18px">色觉模式
          <select id="color-blind-mode" style="width:100%;padding:10px;margin-top:8px;background:#2a2a2a;border:1px solid #555;color:white;border-radius:5px">
            <option value="none">正常</option>
            <option value="deuteranopia">绿色弱（deuteranopia）</option>
            <option value="protanopia">红色弱（protanopia）</option>
            <option value="tritanopia">蓝黄色弱（tritanopia）</option>
          </select>
        </label>
        <label style="display:block;margin-bottom:18px">准星样式
          <select id="crosshair-style" style="width:100%;padding:10px;margin-top:8px;background:#2a2a2a;border:1px solid #555;color:white;border-radius:5px">
            <option value="default">四段</option>
            <option value="dot">点</option>
            <option value="none">无</option>
          </select>
        </label>
        <label style="display:block;margin-bottom:18px">准星颜色
          <input type="color" id="crosshair-color" value="#ffffff" style="width:100%;margin-top:8px;height:36px;background:#2a2a2a;border:1px solid #555;border-radius:5px">
        </label>
        ${this.slider('crosshair-scale', '准星大小（%）', 50, 200, 100)}
        <label style="display:block;margin-bottom:18px">显示字幕（关键音频信息的视觉替代）
          <input type="checkbox" id="show-subtitles" style="margin-top:8px">
        </label>
        <div style="display:flex;gap:10px">
          <button id="apply-button" class="ui-btn ui-btn-primary" style="flex:1;padding:12px">应用</button>
          <button id="cancel-button" class="ui-btn ui-btn-ghost" style="flex:1;padding:12px">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    this.elements.volumeMaster = container.querySelector('#volume-master');
    this.elements.volumeSfx = container.querySelector('#volume-sfx');
    this.elements.volumeMusic = container.querySelector('#volume-music');
    this.elements.volumeVoice = container.querySelector('#volume-voice');
    this.elements.sensitivity = container.querySelector('#sensitivity');
    this.elements.adsSensitivity = container.querySelector('#ads-sensitivity');
    this.elements.fov = container.querySelector('#fov');
    this.elements.invertY = container.querySelector('#invert-y');
    this.elements.graphics = container.querySelector('#graphics');
    this.elements.resolutionScale = container.querySelector('#resolution-scale');
    this.elements.reduceScreenShake = container.querySelector('#reduce-screen-shake');
    this.elements.colorBlindMode = container.querySelector('#color-blind-mode');
    this.elements.crosshairStyle = container.querySelector('#crosshair-style');
    this.elements.crosshairColor = container.querySelector('#crosshair-color');
    this.elements.crosshairScale = container.querySelector('#crosshair-scale');
    this.elements.showSubtitles = container.querySelector('#show-subtitles');

    container.querySelector('#apply-button')?.addEventListener('click', () => this.onApply?.(this.readSettings()));
    container.querySelector('#cancel-button')?.addEventListener('click', () => this.onCancel?.());
    this.focusManager = new FocusManager(container);
    this.setSettings(loadGameSettings());
    return container;
  }

  private readSettings(): GameSettings {
    return {
      volumeMaster: Number(this.elements.volumeMaster?.value ?? 80),
      volumeSfx: Number(this.elements.volumeSfx?.value ?? 80),
      volumeMusic: Number(this.elements.volumeMusic?.value ?? 60),
      volumeVoice: Number(this.elements.volumeVoice?.value ?? 80),
      sensitivity: Number(this.elements.sensitivity?.value ?? 50),
      adsSensitivityMultiplier: Number(this.elements.adsSensitivity?.value ?? 80) / 100,
      fov: Number(this.elements.fov?.value ?? 75),
      invertY: this.elements.invertY instanceof HTMLInputElement && this.elements.invertY.checked,
      graphics: (this.elements.graphics?.value ?? 'medium') as GameSettings['graphics'],
      resolutionScale: Number(this.elements.resolutionScale?.value ?? 100) / 100,
      reduceScreenShake:
        this.elements.reduceScreenShake instanceof HTMLInputElement && this.elements.reduceScreenShake.checked,
      colorBlindMode: (this.elements.colorBlindMode?.value ?? 'none') as GameSettings['colorBlindMode'],
      crosshairStyle: (this.elements.crosshairStyle?.value ?? 'default') as GameSettings['crosshairStyle'],
      crosshairColor: this.elements.crosshairColor instanceof HTMLInputElement
        ? this.elements.crosshairColor.value
        : '#ffffff',
      crosshairScale: Number(this.elements.crosshairScale?.value ?? 100) / 100,
      showSubtitles:
        this.elements.showSubtitles instanceof HTMLInputElement && this.elements.showSubtitles.checked,
    };
  }

  private slider(id: string, label: string, min: number, max: number, value: number): string {
    return `<label style="display:block;margin-bottom:18px">${label}
      <input type="range" id="${id}" min="${min}" max="${max}" value="${value}" style="width:100%;margin-top:8px">
    </label>`;
  }
}

export type { GameSettings } from '../config';
