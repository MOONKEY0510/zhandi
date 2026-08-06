/**
 * 断线/重连状态覆盖层（阶段 10 P0：断线提示、重连状态、服务器错误提供可恢复操作）。
 * 顶部悬浮横幅：重连中（黄色提示，非阻塞）/ 连接失败（红色 + 重试/返回主菜单按钮）。
 */
export class ConnectionStatusOverlay {
  container: HTMLElement;
  private statusEl: HTMLElement;
  private actionsEl: HTMLElement;
  private retryBtn: HTMLButtonElement | null = null;
  private menuBtn: HTMLButtonElement | null = null;
  private onRetry: (() => void) | null = null;
  private onBackToMenu: (() => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; z-index: 200;
      display: none; flex-direction: column; align-items: center; gap: 10px;
      padding: 14px 20px; box-sizing: border-box;
      font-family: var(--ui-font); font-size: 15px; text-align: center;
      pointer-events: auto;
    `;
    this.statusEl = document.createElement('div');
    this.actionsEl = document.createElement('div');
    this.actionsEl.style.cssText = 'display: flex; gap: 12px;';
    this.container.appendChild(this.statusEl);
    this.container.appendChild(this.actionsEl);
  }

  attach(): void {
    if (!this.container.parentNode) document.body.appendChild(this.container);
  }

  detach(): void {
    if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
  }

  /** 断线重连中：黄色提示条（非阻塞，重连成功自动恢复） */
  showReconnecting(attempt: number, delayMs: number): void {
    this.attach();
    this.container.style.display = 'flex';
    this.container.style.background = 'rgba(60, 50, 10, 0.92)';
    this.container.style.borderBottom = '2px solid #e8c23a';
    this.statusEl.textContent = `连接中断，正在重连…（第 ${attempt} 次，${Math.max(1, Math.round(delayMs / 1000))}s 后重试）`;
    this.statusEl.style.color = '#ffe08a';
    this.actionsEl.style.display = 'none';
  }

  /** 连接正常/重连成功：隐藏覆盖层 */
  showConnected(): void {
    this.container.style.display = 'none';
  }

  /** 重连耗尽：红色失败横幅 + 可恢复操作（重试/返回主菜单） */
  showFailed(onRetry: () => void, onBackToMenu: () => void): void {
    this.onRetry = onRetry;
    this.onBackToMenu = onBackToMenu;
    this.attach();
    this.container.style.display = 'flex';
    this.container.style.background = 'rgba(70, 15, 15, 0.94)';
    this.container.style.borderBottom = '2px solid #ff5555';
    this.statusEl.textContent = '无法连接服务器：多次重试未恢复';
    this.statusEl.style.color = '#ffb0b0';

    this.actionsEl.style.display = 'flex';
    this.actionsEl.innerHTML = '';
    this.retryBtn = document.createElement('button');
    this.retryBtn.textContent = '重新连接';
    this.retryBtn.style.cssText = 'padding: 8px 18px; background: #ff4444; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;';
    this.retryBtn.addEventListener('click', () => this.onRetry?.());
    this.menuBtn = document.createElement('button');
    this.menuBtn.textContent = '返回主菜单';
    this.menuBtn.style.cssText = 'padding: 8px 18px; background: #555; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;';
    this.menuBtn.addEventListener('click', () => this.onBackToMenu?.());
    this.actionsEl.appendChild(this.retryBtn);
    this.actionsEl.appendChild(this.menuBtn);
  }

  dispose(): void {
    this.detach();
    this.retryBtn = null;
    this.menuBtn = null;
    this.onRetry = null;
    this.onBackToMenu = null;
  }
}
