/**
 * 统一 UI 视觉系统（阶段 10 P0：字体、色板、边框、间距、圆角、动效、焦点状态）。
 * 集中定义设计令牌，取代各组件内联硬编码；applyThemeRoot 注入全局 CSS 变量与焦点样式。
 */

export const UI_THEME = {
  fontFamily:
    "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', 'Arial', sans-serif",
  colors: {
    /** 场景/菜单底色 */
    bg: '#14141e',
    bgGradient: 'linear-gradient(135deg, #14141e 0%, #28283c 100%)',
    bgPanel: 'rgba(20, 20, 30, 0.95)',
    bgPanelSolid: '#1e202c',
    bgHover: 'rgba(255, 255, 255, 0.08)',
    bgActive: 'rgba(255, 204, 0, 0.14)',
    text: '#ffffff',
    textDim: 'rgba(255, 255, 255, 0.72)',
    textMuted: 'rgba(255, 255, 255, 0.45)',
    /** 主强调色（金色系，沿用现有 HUD 主色） */
    accent: '#ffcc00',
    accentAlt: '#ff9900',
    accentText: '#1a1a1a',
    gold: '#d8ad43',
    border: 'rgba(255, 255, 255, 0.18)',
    borderStrong: 'rgba(255, 255, 255, 0.38)',
    danger: '#ff4444',
    dangerBg: 'rgba(255, 68, 68, 0.18)',
    axis: '#ff4444',
    allies: '#4488ff',
    /** 焦点环 */
    focus: '#ffcc00',
  },
  radius: { sm: '5px', md: '8px', lg: '12px' },
  spacing: { xs: '6px', sm: '12px', md: '20px', lg: '28px' },
  duration: { fast: '120ms', normal: '240ms' },
  shadow: {
    panel: '0 8px 32px rgba(0, 0, 0, 0.5)',
    focus: '0 0 0 3px rgba(255, 204, 0, 0.35)',
  },
} as const;

/** 可聚焦元素选择器（FocusManager 与 Tab 导航共用） */
export const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

const ROOT_CSS_VARS = `
  :root {
    --ui-font: ${UI_THEME.fontFamily};
    --ui-bg: ${UI_THEME.colors.bg};
    --ui-bg-panel: ${UI_THEME.colors.bgPanel};
    --ui-bg-panel-solid: ${UI_THEME.colors.bgPanelSolid};
    --ui-text: ${UI_THEME.colors.text};
    --ui-text-dim: ${UI_THEME.colors.textDim};
    --ui-text-muted: ${UI_THEME.colors.textMuted};
    --ui-accent: ${UI_THEME.colors.accent};
    --ui-accent-alt: ${UI_THEME.colors.accentAlt};
    --ui-accent-text: ${UI_THEME.colors.accentText};
    --ui-gold: ${UI_THEME.colors.gold};
    --ui-border: ${UI_THEME.colors.border};
    --ui-border-strong: ${UI_THEME.colors.borderStrong};
    --ui-danger: ${UI_THEME.colors.danger};
    --ui-focus: ${UI_THEME.colors.focus};
    --ui-radius-sm: ${UI_THEME.radius.sm};
    --ui-radius-md: ${UI_THEME.radius.md};
    --ui-radius-lg: ${UI_THEME.radius.lg};
    --ui-space-xs: ${UI_THEME.spacing.xs};
    --ui-space-sm: ${UI_THEME.spacing.sm};
    --ui-space-md: ${UI_THEME.spacing.md};
    --ui-space-lg: ${UI_THEME.spacing.lg};
    --ui-duration-fast: ${UI_THEME.duration.fast};
    --ui-duration-normal: ${UI_THEME.duration.normal};
    --ui-shadow-panel: ${UI_THEME.shadow.panel};
    --ui-shadow-focus: ${UI_THEME.shadow.focus};
  }
`;

const GLOBAL_STYLES = `
  /* 统一字体基线 */
  body, button, input, select, textarea {
    font-family: var(--ui-font);
  }
  /* 键盘焦点可见（鼠标点击不显示焦点环） */
  :focus {
    outline: none;
  }
  :focus-visible {
    outline: 2px solid var(--ui-focus);
    outline-offset: 2px;
  }
  .ui-focus-ring {
    outline: 2px solid var(--ui-focus);
    outline-offset: 2px;
  }
  /* 通用按钮基线（各组件可通过 class 快速取用） */
  .ui-btn {
    font-family: var(--ui-font);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    transition: background var(--ui-duration-fast), border-color var(--ui-duration-fast),
      transform var(--ui-duration-fast);
  }
  .ui-btn:active {
    transform: translateY(1px);
  }
  .ui-btn-primary {
    background: linear-gradient(135deg, var(--ui-accent), var(--ui-accent-alt));
    border: 0;
    color: var(--ui-accent-text);
    font-weight: bold;
  }
  .ui-btn-ghost {
    background: transparent;
    border: 2px solid var(--ui-border-strong);
    color: var(--ui-text);
  }
  .ui-btn-ghost:hover {
    background: var(--ui-bg-hover);
    border-color: var(--ui-accent);
  }
  .ui-panel {
    background: var(--ui-bg-panel);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-panel);
    color: var(--ui-text);
  }
`;

let applied = false;

/** 注入全局 CSS 变量与焦点/按钮/面板样式（幂等，重复调用无副作用） */
export function applyThemeRoot(doc: Document = document): void {
  if (applied) return;
  const style = doc.createElement('style');
  style.id = 'zhandi-ui-theme';
  style.textContent = ROOT_CSS_VARS + GLOBAL_STYLES;
  doc.head.appendChild(style);
  applied = true;
}

/** 供测试重置注入状态（每个 jsdom 环境只注入一次） */
export function resetThemeRootForTest(): void {
  applied = false;
}
