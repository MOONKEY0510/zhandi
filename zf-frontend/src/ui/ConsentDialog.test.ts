import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConsentDialog } from './ConsentDialog';

describe('ConsentDialog（阶段 10 P0：崩溃统计同意机制）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show 渲染同意文案与两个按钮，聚焦「同意」', () => {
    const dialog = new ConsentDialog();
    dialog.show();
    expect(dialog.container.style.display).toBe('flex');
    expect(dialog.container.textContent).toContain('匿名的崩溃与错误统计');
    expect(dialog.container.textContent).toContain('不包含昵称');
    expect(dialog.container.querySelectorAll('button').length).toBe(2);
    expect(document.activeElement?.id).toBe('consent-accept');
    dialog.dispose();
  });

  it('点击「同意并帮助改进」回调 true', () => {
    const dialog = new ConsentDialog();
    const result = vi.fn();
    dialog.onResult = result;
    dialog.show();
    (dialog.container.querySelector('#consent-accept') as HTMLButtonElement).click();
    expect(result).toHaveBeenCalledWith(true);
    dialog.dispose();
  });

  it('点击「拒绝」回调 false', () => {
    const dialog = new ConsentDialog();
    const result = vi.fn();
    dialog.onResult = result;
    dialog.show();
    (dialog.container.querySelector('#consent-decline') as HTMLButtonElement).click();
    expect(result).toHaveBeenCalledWith(false);
    dialog.dispose();
  });

  it('hide/dispose 清理', () => {
    const dialog = new ConsentDialog();
    dialog.show();
    dialog.hide();
    expect(dialog.container.style.display).toBe('none');
    dialog.dispose();
    expect(document.body.contains(dialog.container)).toBe(false);
  });
});
