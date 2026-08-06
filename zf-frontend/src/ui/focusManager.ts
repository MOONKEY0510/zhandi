import { FOCUSABLE_SELECTOR } from './theme';

/**
 * 键盘焦点导航（阶段 10 P0：统一焦点状态，验收「键盘全程可导航菜单」）。
 * 收集容器内可聚焦元素，方向键/Home/End 循环移动焦点，Enter/Space 触发按钮，
 * Tab 交还浏览器原生顺序。打开菜单时 focusFirst() 聚焦首个元素。
 */
export class FocusManager {
  private container: HTMLElement;
  private items: HTMLElement[] = [];
  private index = -1;
  private readonly selector: string;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(container: HTMLElement, selector: string = FOCUSABLE_SELECTOR) {
    this.container = container;
    this.selector = selector;
    this.collect();
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.container.addEventListener('keydown', this.onKeyDown);
  }

  /** 重新收集可聚焦元素（动态渲染后调用） */
  collect(): void {
    const items = Array.from(
      this.container.querySelectorAll<HTMLElement>(this.selector),
    ).filter((el) => !this.isDisabled(el));
    this.items = items;
    if (this.index >= this.items.length) this.index = this.items.length - 1;
  }

  /** 聚焦第一个可聚焦元素（菜单打开时调用） */
  focusFirst(): void {
    this.collect();
    if (this.items.length === 0) return;
    this.focusIndex(0);
  }

  /** 聚焦最后一个（可选，Esc 反向场景） */
  focusLast(): void {
    this.collect();
    if (this.items.length === 0) return;
    this.focusIndex(this.items.length - 1);
  }

  /** 当前是否持有焦点元素 */
  hasFocus(): boolean {
    return this.index >= 0 && this.items[this.index] === document.activeElement;
  }

  getFocusedIndex(): number {
    return this.index;
  }

  getItemCount(): number {
    return this.items.length;
  }

  dispose(): void {
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.items = [];
    this.index = -1;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.items.length === 0) return;
    // 表单控件（滑块/下拉/输入框）交给原生键盘行为：方向键调值、Space 切换，不劫持
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusFirst();
        break;
      case 'End':
        event.preventDefault();
        this.focusLast();
        break;
      default:
        break;
    }
  }

  private move(step: number): void {
    this.collect();
    if (this.items.length === 0) return;
    if (this.index < 0) {
      this.focusIndex(step > 0 ? 0 : this.items.length - 1);
    } else {
      this.focusIndex((this.index + step + this.items.length) % this.items.length);
    }
  }

  private focusIndex(i: number): void {
    this.index = i;
    const el = this.items[i];
    el.focus();
    // 给非原生可聚焦元素补焦点环类（滚动/朗读辅助）
    el.classList.add('ui-focus-ring');
    this.clearFocusRingExcept(el);
  }

  private clearFocusRingExcept(keep: HTMLElement): void {
    for (const item of this.items) {
      if (item !== keep) item.classList.remove('ui-focus-ring');
    }
  }

  private isDisabled(el: HTMLElement): boolean {
    if (el.hasAttribute('disabled')) return true;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return style?.display === 'none' || style?.visibility === 'hidden';
  }
}
