import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { applyThemeRoot, resetThemeRootForTest, UI_THEME, FOCUSABLE_SELECTOR } from './theme';

describe('theme（阶段 10 P0：统一 UI 视觉系统）', () => {
  beforeEach(() => {
    resetThemeRootForTest();
    document.head.querySelector('#zhandi-ui-theme')?.remove();
  });

  afterEach(() => {
    resetThemeRootForTest();
  });

  it('applyThemeRoot 注入 CSS 变量与全局焦点样式（幂等）', () => {
    applyThemeRoot();
    const style = document.head.querySelector('#zhandi-ui-theme');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('--ui-font');
    expect(style?.textContent).toContain('--ui-accent');
    expect(style?.textContent).toContain(':focus-visible');
    // 幂等：重复调用不重复注入
    applyThemeRoot();
    expect(document.head.querySelectorAll('#zhandi-ui-theme').length).toBe(1);
  });

  it('设计令牌完整：字体/色板/圆角/间距/动效/焦点环齐备', () => {
    expect(UI_THEME.fontFamily).toContain('Segoe UI');
    expect(UI_THEME.colors.accent).toBe('#ffcc00');
    expect(UI_THEME.colors.focus).toBe('#ffcc00');
    expect(UI_THEME.colors.danger).toBe('#ff4444');
    expect(UI_THEME.radius.md).toBe('8px');
    expect(UI_THEME.spacing.md).toBe('20px');
    expect(UI_THEME.duration.normal).toBe('240ms');
    expect(UI_THEME.shadow.panel).toContain('0 8px 32px');
    expect(UI_THEME.shadow.focus).toContain('0 0 0 3px');
  });

  it('FOCUSABLE_SELECTOR 覆盖按钮/输入/下拉/链接/显式 tabindex', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button');
    expect(FOCUSABLE_SELECTOR).toContain('input');
    expect(FOCUSABLE_SELECTOR).toContain('select');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]');
  });
});
