import type { PerformanceMonitor, PerformanceSnapshot } from './PerformanceMonitor';

/** 阶段 6 预算统计：音频 voice 与特效池的实时占用 */
export interface PerformanceExtras {
  voicesReal: number;
  voicesVirtual: number;
  vfxActive: number;
}

export class PerformancePanel {
  private readonly container: HTMLDivElement;
  private readonly values: HTMLPreElement;
  private readonly exportButton: HTMLButtonElement;
  private visible = false;

  constructor(private readonly monitor: PerformanceMonitor) {
    this.container = document.createElement('div');
    this.container.id = 'performance-panel';
    this.container.style.cssText = [
      'position:fixed',
      'left:12px',
      'bottom:12px',
      'z-index:2000',
      'display:none',
      'min-width:220px',
      'padding:10px 12px',
      'border:1px solid rgba(255,255,255,0.25)',
      'border-radius:6px',
      'background:rgba(8,12,18,0.88)',
      'color:#d8f6ff',
      'font:12px/1.45 Consolas,monospace',
      'pointer-events:auto',
      'box-shadow:0 6px 20px rgba(0,0,0,0.35)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'PERFORMANCE [F3]';
    title.style.cssText = 'font-weight:700;color:#67d8ff;margin-bottom:6px';

    this.values = document.createElement('pre');
    this.values.style.cssText = 'margin:0;white-space:pre-wrap';

    this.exportButton = document.createElement('button');
    this.exportButton.type = 'button';
    this.exportButton.textContent = '导出 JSON';
    this.exportButton.style.cssText = [
      'margin-top:8px',
      'padding:4px 8px',
      'border:1px solid #67d8ff',
      'border-radius:4px',
      'background:transparent',
      'color:#d8f6ff',
      'cursor:pointer',
      'font:12px Consolas,monospace',
    ].join(';');
    this.exportButton.addEventListener('click', this.exportReport);

    this.container.append(title, this.values, this.exportButton);
    document.body.appendChild(this.container);
    document.addEventListener('keydown', this.onKeyDown);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.style.display = visible ? 'block' : 'none';
  }

  update(snapshot: PerformanceSnapshot, benchmarkEnabled: boolean, extras?: PerformanceExtras): void {
    if (!this.visible) return;

    const lines = [
      `MODE   ${benchmarkEnabled ? 'BENCHMARK' : 'GAME'}`,
      `FPS    ${snapshot.fps.toFixed(1)}`,
      `FRAME  ${snapshot.frameTimeMs.toFixed(2)} ms`,
      `P50    ${snapshot.frameTimeP50Ms.toFixed(2)} ms`,
      `P95    ${snapshot.frameTimeP95Ms.toFixed(2)} ms`,
      `CALLS  ${snapshot.drawCalls}`,
      `TRIS   ${snapshot.triangles.toLocaleString()}`,
      `TEX/G  ${snapshot.textures}/${snapshot.geometries}`,
      `ENTITY ${snapshot.entities}`,
    ];
    if (extras) {
      lines.push(
        `VOICE  ${extras.voicesReal} real / ${extras.voicesVirtual} virt`,
        `VFX    ${extras.vfxActive} active`,
      );
    }
    this.values.textContent = lines.join('\n');
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.exportButton.removeEventListener('click', this.exportReport);
    this.container.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F3') return;
    event.preventDefault();
    this.setVisible(!this.visible);
  };

  private readonly exportReport = (): void => {
    const report = JSON.stringify(this.monitor.exportReport(), null, 2);
    const blob = new Blob([report], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zhandi-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
}
