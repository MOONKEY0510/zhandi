/**
 * 网络模拟调参面板（阶段 8 P0：网络模拟面板）。
 * F4 切换；对 NetSimulator 实时调参（延迟/抖动/丢包/乱序/带宽）并显示统计。
 * 纯 DOM + 可注入 simulator，jsdom 可单测。
 */

import { NetSimulator, type NetSimOptions } from './NetSimulator.ts';

interface SliderSpec {
  key: keyof NetSimOptions;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 展示值换算（如丢包率 0..1 显示为 0..100%） */
  displayScale?: number;
  /** 展示单位后缀 */
  unit?: string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'latencyMs', label: '延迟', min: 0, max: 500, step: 10, unit: 'ms' },
  { key: 'jitterMs', label: '抖动', min: 0, max: 250, step: 10, unit: 'ms' },
  { key: 'lossRate', label: '丢包', min: 0, max: 100, step: 1, displayScale: 100, unit: '%' },
  { key: 'reorderRate', label: '乱序', min: 0, max: 100, step: 1, displayScale: 100, unit: '%' },
  { key: 'bandwidthBps', label: '带宽', min: 0, max: 1024, step: 32, displayScale: 1024, unit: 'KB/s' },
];

export interface NetSimPanelOptions {
  /** 切换面板的按键（默认 F4） */
  toggleKey?: string;
}

export class NetSimPanel {
  private readonly container: HTMLDivElement;
  private readonly stats: HTMLPreElement;
  private readonly sliders: { spec: SliderSpec; input: HTMLInputElement }[] = [];
  private readonly toggleKey: string;
  private visible = false;

  constructor(
    private readonly simulator: NetSimulator,
    options: NetSimPanelOptions = {},
  ) {
    this.toggleKey = options.toggleKey ?? 'F4';

    this.container = document.createElement('div');
    this.container.id = 'netsim-panel';
    this.container.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2000',
      'display:none',
      'min-width:240px',
      'padding:10px 12px',
      'border:1px solid rgba(255,200,120,0.35)',
      'border-radius:6px',
      'background:rgba(18,12,8,0.9)',
      'color:#ffe8c8',
      'font:12px/1.45 Consolas,monospace',
      'pointer-events:auto',
      'box-shadow:0 6px 20px rgba(0,0,0,0.35)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'NET SIM [F4]';
    title.style.cssText = 'font-weight:700;color:#ffc878;margin-bottom:6px';
    this.container.append(title);

    for (const spec of SLIDERS) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0';

      const label = document.createElement('span');
      label.textContent = spec.label;
      label.style.cssText = 'width:36px;color:#ffc878';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(0);
      input.style.cssText = 'flex:1';

      const value = document.createElement('span');
      value.textContent = this.formatValue(0, spec);
      value.style.cssText = 'width:64px;text-align:right;color:#d8f6ff';

      input.addEventListener('input', () => {
        value.textContent = this.formatValue(Number(input.value), spec);
        this.simulator.updateOptions({ [spec.key]: this.toActual(Number(input.value), spec) });
      });

      this.sliders.push({ spec, input });
      row.append(label, input, value);
      this.container.append(row);
    }

    this.stats = document.createElement('pre');
    this.stats.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;color:#9adca0';
    this.container.append(this.stats);

    document.body.appendChild(this.container);
    document.addEventListener('keydown', this.onKeyDown);
    this.refreshStats();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.style.display = visible ? 'block' : 'none';
    if (visible) this.refreshStats();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** 刷新统计（外部每帧或显示时调用） */
  refreshStats(): void {
    const s = this.simulator.stats;
    this.stats.textContent = [
      `SENT   ${s.sent}`,
      `RECV   ${s.received}`,
      `DROP   ${s.dropped}`,
      `REORD  ${s.reordered}`,
      `DELAY  ${s.delayed}`,
    ].join('\n');
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.container.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== this.toggleKey) return;
    event.preventDefault();
    this.setVisible(!this.visible);
  };

  private formatValue(raw: number, spec: SliderSpec): string {
    const v = raw / (spec.displayScale ?? 1);
    return `${v}${spec.unit ?? ''}`;
  }

  private toActual(raw: number, spec: SliderSpec): number {
    const v = raw / (spec.displayScale ?? 1);
    // 带宽 0 = 不限（界面显示 0 KB/s）
    return spec.key === 'bandwidthBps' ? Math.round(v) : v;
  }
}
