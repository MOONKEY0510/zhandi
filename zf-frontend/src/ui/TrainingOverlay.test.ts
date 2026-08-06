import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrainingOverlay } from './TrainingOverlay';
import { TrainingMode, TRAINING_STEPS } from '../training/TrainingMode';
import { resetThemeRootForTest } from './theme';

describe('TrainingOverlay（阶段 10 P1：训练 HUD——步骤列表/提示/完成弹窗）', () => {
  let overlay: TrainingOverlay;
  let mode: TrainingMode;

  beforeEach(() => {
    resetThemeRootForTest();
    document.body.innerHTML = '';
    overlay = new TrainingOverlay();
    mode = new TrainingMode();
  });

  afterEach(() => {
    overlay.dispose();
    document.body.innerHTML = '';
  });

  it('初始隐藏，show 后可见', () => {
    expect(overlay.container.style.display).toBe('none');
    overlay.show();
    expect(overlay.container.style.display).toBe('block');
    overlay.hide();
    expect(overlay.container.style.display).toBe('none');
  });

  it('update 渲染全部步骤，第一步为当前步骤', () => {
    overlay.update(mode);
    const items = overlay.container.querySelectorAll('.ts-item');
    expect(items.length).toBe(TRAINING_STEPS.length);
    expect(items[0].className).toContain('current');
    expect(items[0].textContent).toContain('移动');
    expect(items[1].className).not.toContain('current');
  });

  it('完成步骤显示 done，当前步骤随进度推进', () => {
    mode.completeStep('move');
    mode.completeStep('mobility');
    overlay.update(mode);
    const items = overlay.container.querySelectorAll('.ts-item');
    expect(items[0].className).toContain('done');
    expect(items[1].className).toContain('done');
    expect(items[2].className).toContain('current');
    expect(items[2].textContent).toContain('射击');
  });

  it('底部提示显示当前步骤描述', () => {
    overlay.update(mode);
    const hint = overlay.container.querySelector('#training-hint');
    expect(hint?.textContent).toContain('WASD');
    mode.completeStep('move');
    overlay.update(mode);
    expect(hint?.textContent).toContain('冲刺');
  });

  it('完成弹窗：showComplete 显示并聚焦返回按钮', () => {
    const panel = overlay.container.querySelector('#training-complete') as HTMLElement;
    expect(panel.style.display).toBe('none');
    overlay.showComplete();
    expect(panel.style.display).toBe('flex');
    const button = overlay.container.querySelector('#training-back') as HTMLElement;
    expect(document.activeElement).toBe(button);
  });

  it('点击返回按钮触发 onBackToMenu 回调', () => {
    const cb = vi.fn();
    overlay.onBackToMenu = cb;
    overlay.showComplete();
    const button = overlay.container.querySelector('#training-back') as HTMLElement;
    button.click();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('dispose 移除 DOM 并解绑', () => {
    overlay.dispose();
    expect(document.querySelector('#training-overlay')).toBeNull();
  });
});
