import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FirstRunWizard } from './FirstRunWizard';

describe('FirstRunWizard（阶段 10 P0：首次设置向导）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show 渲染欢迎步骤（第 1/3 步）并聚焦「下一步」', () => {
    const wizard = new FirstRunWizard();
    wizard.show();
    expect(wizard.container.style.display).toBe('flex');
    expect(wizard.container.textContent).toContain('欢迎');
    expect(wizard.getStep()).toBe(0);
    expect(document.activeElement?.id).toBe('wizard-next');
    wizard.dispose();
  });

  it('下一步进入基础设置，含画质/音量/灵敏度控件', () => {
    const wizard = new FirstRunWizard();
    wizard.show();
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    expect(wizard.getStep()).toBe(1);
    expect(wizard.container.querySelector('#wizard-graphics')).not.toBeNull();
    expect(wizard.container.querySelector('#wizard-volume')).not.toBeNull();
    expect(wizard.container.querySelector('#wizard-sensitivity')).not.toBeNull();
    expect(wizard.container.querySelector('#wizard-back')).not.toBeNull();
    wizard.dispose();
  });

  it('上一步回退到欢迎页并聚焦「下一步」', () => {
    const wizard = new FirstRunWizard();
    wizard.show();
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    (wizard.container.querySelector('#wizard-back') as HTMLButtonElement).click();
    expect(wizard.getStep()).toBe(0);
    // 欢迎页无「上一步」按钮，聚焦唯一操作按钮「下一步」
    expect(document.activeElement?.id).toBe('wizard-next');
    wizard.dispose();
  });

  it('完成步骤收集昵称/画质/音量/灵敏度/字幕并回调', () => {
    const wizard = new FirstRunWizard();
    const complete = vi.fn();
    wizard.onComplete = complete;
    wizard.show();
    // 下一步 → 设置画质/音量/灵敏度
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    const graphics = wizard.container.querySelector('#wizard-graphics') as HTMLSelectElement;
    graphics.value = 'high';
    graphics.dispatchEvent(new Event('change'));
    const volume = wizard.container.querySelector('#wizard-volume') as HTMLInputElement;
    volume.value = '65';
    volume.dispatchEvent(new Event('input'));
    // 下一步 → 昵称与字幕
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    const nickname = wizard.container.querySelector('#wizard-nickname') as HTMLInputElement;
    nickname.value = ' 老兵 ';
    nickname.dispatchEvent(new Event('input'));
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({
      nickname: '老兵',
      graphics: 'high',
      volumeMaster: 65,
      sensitivity: 50,
      showSubtitles: true,
    });
    wizard.dispose();
  });

  it('空昵称完成时回退「士兵」', () => {
    const wizard = new FirstRunWizard();
    const complete = vi.fn();
    wizard.onComplete = complete;
    wizard.show();
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    (wizard.container.querySelector('#wizard-next') as HTMLButtonElement).click();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: '士兵' }),
    );
    wizard.dispose();
  });
});
