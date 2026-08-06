import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplayPanel } from './ReplayPanel';
import type { ReplayTimelineItem } from '../replay/ReplayRecorder';

function makeTimeline(): ReplayTimelineItem[] {
  return [
    { clock: '00:05', type: 'kill', label: '步枪 击杀 AI Bot' },
    { clock: '00:20', type: 'death', label: '你被击杀了' },
    { clock: '01:10', type: 'objective', label: '「据点 B」被苏军占领' },
    { clock: '02:00', type: 'vehicle', label: '坦克 被摧毁' },
    { clock: '03:30', type: 'round_end', label: '游戏结束！苏军 获胜！' },
  ];
}

describe('ReplayPanel（阶段 10 P1：战局回放面板）', () => {
  let panel: ReplayPanel;
  beforeEach(() => {
    panel = new ReplayPanel();
  });
  afterEach(() => {
    panel.dispose();
  });

  it('初始隐藏；show 后可见且渲染全部事件', () => {
    expect(panel.container.style.display).toBe('none');
    panel.show(makeTimeline());
    expect(panel.container.style.display).toBe('flex');
    const rows = panel.container.querySelectorAll('#replay-list > div');
    expect(rows).toHaveLength(5);
  });

  it('筛选按钮切换类型过滤', () => {
    panel.show(makeTimeline());
    const killBtn = panel.container.querySelector('[data-filter="kill"]') as HTMLButtonElement;
    killBtn.click();
    let rows = panel.container.querySelectorAll('#replay-list > div');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('击杀');

    const objectiveBtn = panel.container.querySelector('[data-filter="objective"]') as HTMLButtonElement;
    objectiveBtn.click();
    rows = panel.container.querySelectorAll('#replay-list > div');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('据点');

    // 空类型显示空状态
    const vehicleBtn = panel.container.querySelector('[data-filter="vehicle"]') as HTMLButtonElement;
    vehicleBtn.click();
    expect(panel.container.querySelectorAll('#replay-list > div')).toHaveLength(1);
  });

  it('无匹配事件时显示空状态', () => {
    panel.show([{ clock: '00:01', type: 'kill', label: '击杀' }]);
    const deathBtn = panel.container.querySelector('[data-filter="death"]') as HTMLButtonElement;
    deathBtn.click();
    const empty = panel.container.querySelector('#replay-empty') as HTMLElement;
    expect(empty.style.display).toBe('block');
    expect(panel.container.querySelectorAll('#replay-list > div')).toHaveLength(0);
  });

  it('关闭按钮触发 onClose 并隐藏', () => {
    const onClose = vi.fn();
    panel.onClose = onClose;
    panel.show([]);
    const closeBtn = panel.container.querySelector('#replay-close') as HTMLButtonElement;
    closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel.container.style.display).toBe('none');
  });

  it('时间线行含时间戳与类型标签', () => {
    panel.show(makeTimeline());
    const rows = panel.container.querySelectorAll('#replay-list > div');
    expect(rows[0].textContent).toContain('00:05');
    expect(rows[0].textContent).toContain('击杀');
  });
});
