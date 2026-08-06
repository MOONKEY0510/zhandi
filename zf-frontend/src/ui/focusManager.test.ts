import { describe, expect, it, beforeEach } from 'vitest';
import { FocusManager } from './focusManager';

function buttonMenu(): { container: HTMLElement; buttons: HTMLButtonElement[] } {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = `
    <button id="b1">一</button>
    <button id="b2">二</button>
    <button id="b3">三</button>
    <button id="b4" disabled>四（禁用）</button>
  `;
  document.body.appendChild(container);
  const buttons = ['#b1', '#b2', '#b3'].map(
    (sel) => container.querySelector(sel) as HTMLButtonElement,
  );
  return { container, buttons };
}

function formMenu(): { container: HTMLElement; range: HTMLInputElement; select: HTMLSelectElement } {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = `
    <input type="range" id="r1">
    <select id="s1"><option>a</option><option>b</option></select>
  `;
  document.body.appendChild(container);
  return {
    container,
    range: container.querySelector('#r1') as HTMLInputElement,
    select: container.querySelector('#s1') as HTMLSelectElement,
  };
}

describe('FocusManager（阶段 10 P0：统一焦点状态/键盘导航）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focusFirst 聚焦第一个可聚焦元素并跳过禁用项', () => {
    const { container, buttons } = buttonMenu();
    const fm = new FocusManager(container);
    fm.focusFirst();
    expect(document.activeElement).toBe(buttons[0]);
    // 可聚焦项 = 3 个按钮（跳过 disabled）
    expect(fm.getItemCount()).toBe(3);
    fm.dispose();
  });

  it('ArrowDown/ArrowUp 在按钮间循环导航', () => {
    const { container, buttons } = buttonMenu();
    const fm = new FocusManager(container);
    fm.focusFirst();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    // 到底循环回第一个
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    // 向上循环到最后一个
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    fm.dispose();
  });

  it('焦点在表单控件上时方向键不劫持（滑块保留原生调值/下拉原生切换）', () => {
    const { container, range, select } = formMenu();
    const fm = new FocusManager(container);
    fm.focusFirst();
    expect(document.activeElement).toBe(range);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(range);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(range);
    // Tab 原生跳到下拉
    select.focus();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(select);
    fm.dispose();
  });

  it('Home/End 跳到首/末，移动时补 .ui-focus-ring 且只保留当前项', () => {
    const { container, buttons } = buttonMenu();
    const fm = new FocusManager(container);
    fm.focusFirst();
    expect(buttons[0].classList.contains('ui-focus-ring')).toBe(true);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2].classList.contains('ui-focus-ring')).toBe(true);
    expect(buttons[0].classList.contains('ui-focus-ring')).toBe(false);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    fm.dispose();
  });

  it('dispose 后键盘事件不再响应', () => {
    const { container, buttons } = buttonMenu();
    const fm = new FocusManager(container);
    fm.focusFirst();
    fm.dispose();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('collect 重新收集动态渲染的按钮（DeploymentMenu 重绘场景）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fm = new FocusManager(container);
    expect(fm.getItemCount()).toBe(0);
    const btn = document.createElement('button');
    btn.textContent = '动态';
    container.appendChild(btn);
    fm.collect();
    expect(fm.getItemCount()).toBe(1);
    fm.dispose();
  });
});
