import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubtitleOverlay } from './SubtitleOverlay';

describe('SubtitleOverlay（阶段 10 P0：关键音频信息视觉替代——字幕）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('show：屏幕底部显示字幕文案并可见', () => {
    const overlay = new SubtitleOverlay();
    overlay.show('战斗开始');
    expect(overlay.container.style.display).toBe('flex');
    expect(overlay.container.textContent).toContain('战斗开始');
    expect(overlay.isVisible()).toBe(true);
    expect(document.body.contains(overlay.container)).toBe(true);
    overlay.dispose();
  });

  it('show：新字幕替换旧字幕并重置计时', () => {
    const overlay = new SubtitleOverlay();
    overlay.show('部署阶段');
    // 第一个字幕显示 2s 后替换
    vi.advanceTimersByTime(2000);
    overlay.show('战斗开始');
    expect(overlay.container.textContent).toContain('战斗开始');
    expect(overlay.container.textContent).not.toContain('部署阶段');
    expect(overlay.isVisible()).toBe(true);
    // 重置计时生效：替换后又过 2s（累计 4s）仍可见（若未重置，第一个 3s 计时早该隐藏）
    vi.advanceTimersByTime(2000);
    expect(overlay.isVisible()).toBe(true);
    // 第二个字幕满 3s 后隐藏
    vi.advanceTimersByTime(1001);
    expect(overlay.isVisible()).toBe(false);
    overlay.dispose();
  });

  it('超时后自动隐藏', () => {
    const overlay = new SubtitleOverlay();
    overlay.show('你被击杀了', 3000);
    vi.advanceTimersByTime(2999);
    expect(overlay.isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(overlay.isVisible()).toBe(false);
    overlay.dispose();
  });

  it('setEnabled(false)：立即隐藏且后续字幕不显示', () => {
    const overlay = new SubtitleOverlay();
    overlay.show('战斗开始');
    overlay.setEnabled(false);
    expect(overlay.isVisible()).toBe(false);
    overlay.show('你被击杀了');
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.container.textContent).not.toContain('你被击杀了');
    overlay.dispose();
  });

  it('setEnabled(true)：重新开启后字幕恢复显示', () => {
    const overlay = new SubtitleOverlay();
    overlay.setEnabled(false);
    overlay.show('战斗开始');
    expect(overlay.isVisible()).toBe(false);
    overlay.setEnabled(true);
    overlay.show('你被击杀了');
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.container.textContent).toContain('你被击杀了');
    overlay.dispose();
  });

  it('dispose：移除 DOM', () => {
    const overlay = new SubtitleOverlay();
    overlay.show('战斗开始');
    expect(document.body.contains(overlay.container)).toBe(true);
    overlay.dispose();
    expect(document.body.contains(overlay.container)).toBe(false);
  });
});
