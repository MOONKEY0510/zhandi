/**
 * 色觉模式阵营配色（阶段 10 P0：操作可访问性——色觉模式）。
 * 红/蓝阵营色在红绿色弱（deuteranopia/protanopia）下红侧偏暗难辨，
 * 蓝黄色弱（tritanopia）下蓝侧与黄混淆。各模式提供高对比替代色。
 */
export type ColorBlindMode = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';

export interface TeamColorScheme {
  /** 德军主色（据点/兵力/敌军标记） */
  axis: string;
  /** 德军浅色（辅助文字/描边） */
  axisLight: string;
  /** 苏军主色（据点/兵力/友军标记） */
  allies: string;
  /** 苏军浅色（辅助文字/描边） */
  alliesLight: string;
}

export const COLOR_BLIND_MODES: readonly ColorBlindMode[] = [
  'none',
  'deuteranopia',
  'protanopia',
  'tritanopia',
];

export const COLOR_BLIND_LABELS: Readonly<Record<ColorBlindMode, string>> = {
  none: '正常',
  deuteranopia: '绿色弱（deuteranopia）',
  protanopia: '红色弱（protanopia）',
  tritanopia: '蓝黄色弱（tritanopia）',
};

export const TEAM_COLOR_SCHEMES: Readonly<Record<ColorBlindMode, TeamColorScheme>> = {
  none: {
    axis: '#ff4444',
    axisLight: '#ff8888',
    allies: '#4488ff',
    alliesLight: '#88bbff',
  },
  // 绿色弱：红侧改橙（红绿难分、橙蓝对比强），蓝侧基本保留
  deuteranopia: {
    axis: '#ff8800',
    axisLight: '#ffaa44',
    allies: '#2f7fff',
    alliesLight: '#66aaff',
  },
  // 红色弱：红侧改亮黄橙，蓝侧加深
  protanopia: {
    axis: '#ffaa00',
    axisLight: '#ffcc66',
    allies: '#1f77ff',
    alliesLight: '#5599ff',
  },
  // 蓝黄色弱：蓝侧改青绿（蓝黄混淆下青绿可辨），红侧保留
  tritanopia: {
    axis: '#ff5555',
    axisLight: '#ff8888',
    allies: '#22c8a8',
    alliesLight: '#66e0c8',
  },
};

export function getTeamColors(mode: ColorBlindMode): TeamColorScheme {
  return TEAM_COLOR_SCHEMES[mode] ?? TEAM_COLOR_SCHEMES.none;
}

export function isColorBlindMode(value: unknown): value is ColorBlindMode {
  return typeof value === 'string' && COLOR_BLIND_MODES.includes(value as ColorBlindMode);
}

/** hex (#rrggbb) → rgba(r,g,b,a) 字符串（HUD 半透明背景用） */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(128,128,128,${alpha})`;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
