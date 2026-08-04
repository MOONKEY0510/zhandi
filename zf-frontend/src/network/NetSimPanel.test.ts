import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetSimPanel } from './NetSimPanel.ts';
import { NetSimulator } from './NetSimulator.ts';

describe('NetSimPanel（阶段 8 网络模拟面板）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F4 切换可见性并显示统计', () => {
    const sim = new NetSimulator();
    const panel = new NetSimPanel(sim, { toggleKey: 'F4' });
    expect(panel.isVisible).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
    expect(panel.isVisible).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
    expect(panel.isVisible).toBe(false);
    panel.dispose();
  });

  it('拖动滑块实时更新 simulator 参数', () => {
    const sim = new NetSimulator();
    const panel = new NetSimPanel(sim, { toggleKey: 'F4' });
    const latency = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(latency).not.toBeNull();
    latency.value = '150';
    latency.dispatchEvent(new Event('input'));
    expect(sim.stats).toBeDefined();
    // 通过模拟器行为验证参数生效：150ms 延迟下包不立即投递
    let received = 0;
    sim.onReceive = () => { received += 1; };
    sim.send(new Uint8Array([1]));
    expect(received).toBe(0);
    panel.dispose();
  });

  it('丢包滑块换算为 0..1 概率', () => {
    const sim = new NetSimulator();
    const panel = new NetSimPanel(sim, { toggleKey: 'F4' });
    const sliders = document.querySelectorAll<HTMLInputElement>('input[type="range"]');
    // 第 3 个滑块是丢包（延迟/抖动/丢包/乱序/带宽）
    const loss = sliders[2];
    loss.value = '30';
    loss.dispatchEvent(new Event('input'));
    // 丢包判定在 send 时同步完成（投递走定时器）：固定随机 0.5 > 0.3 → 不丢
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    sim.send(new Uint8Array([1]));
    expect(sim.stats.dropped).toBe(0);
    // 固定随机 0.1 < 0.3 → 丢
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    sim.send(new Uint8Array([2]));
    expect(sim.stats.dropped).toBe(1);
    expect(sim.stats.sent).toBe(2);
    panel.dispose();
  });

  it('统计刷新显示发送/接收/丢弃计数', () => {
    const sim = new NetSimulator();
    const panel = new NetSimPanel(sim, { toggleKey: 'F4' });
    sim.send(new Uint8Array([1]));
    sim.send(new Uint8Array([2]));
    panel.refreshStats();
    const statsText = document.querySelector<HTMLPreElement>('#netsim-panel pre')!.textContent!;
    expect(statsText).toContain('SENT   2');
    expect(statsText).toContain('RECV   0');
    panel.dispose();
  });
});
