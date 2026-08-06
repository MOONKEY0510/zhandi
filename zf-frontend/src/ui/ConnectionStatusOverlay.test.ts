import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionStatusOverlay } from './ConnectionStatusOverlay';

describe('ConnectionStatusOverlay（阶段 10 P0：断线提示/重连状态/可恢复操作）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('showReconnecting：显示黄色重连提示与次数/秒数，无操作按钮', () => {
    const overlay = new ConnectionStatusOverlay();
    overlay.showReconnecting(2, 1500);
    expect(overlay.container.style.display).toBe('flex');
    expect(overlay.container.textContent).toContain('正在重连');
    expect(overlay.container.textContent).toContain('第 2 次');
    expect(overlay.container.textContent).toContain('2s');
    expect(overlay.container.querySelector('button')).toBeNull();
    overlay.dispose();
  });

  it('showConnected：隐藏覆盖层', () => {
    const overlay = new ConnectionStatusOverlay();
    overlay.showReconnecting(1, 500);
    overlay.showConnected();
    expect(overlay.container.style.display).toBe('none');
    overlay.dispose();
  });

  it('showFailed：红色失败横幅 + 重试/返回主菜单按钮，点击触发回调', () => {
    const overlay = new ConnectionStatusOverlay();
    const retry = vi.fn();
    const menu = vi.fn();
    overlay.showFailed(retry, menu);
    expect(overlay.container.textContent).toContain('无法连接服务器');
    const buttons = overlay.container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    (buttons[0] as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
    (buttons[1] as HTMLButtonElement).click();
    expect(menu).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it('dispose：移除 DOM 与回调', () => {
    const overlay = new ConnectionStatusOverlay();
    overlay.showFailed(() => undefined, () => undefined);
    expect(document.body.contains(overlay.container)).toBe(true);
    overlay.dispose();
    expect(document.body.contains(overlay.container)).toBe(false);
  });
});
