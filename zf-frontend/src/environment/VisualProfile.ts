import { WeatherType } from './WeatherSystem';

/**
 * 视觉美术基线（阶段 6 渲染 P0）。
 * 定义晴天 / 阴天 / 黄昏三套基线，统一曝光、色调映射输入、雾、光照色温与阴影强度，
 * 避免每帧散落魔法数字。接入层负责把参数应用到 Renderer / Scene / 灯光。
 */
export type VisualProfileId = 'day_clear' | 'day_overcast' | 'dusk';

export interface VisualProfile {
  id: VisualProfileId;
  /** 展示名，供调试面板使用 */
  name: string;
  /** ACES 胶片色调映射下的曝光补偿（EV），建议范围 0.5–1.2 */
  exposure: number;
  /** 天空颜色（hex） */
  skyColor: string;
  /** 雾颜色（hex），与天空色同源但可微调 */
  fogColor: string;
  /** FogExp2 密度，越大能见度越低 */
  fogDensity: number;
  ambientIntensity: number;
  ambientColor: string;
  directionalIntensity: number;
  /** 方向光（太阳）色温，K；越低越暖 */
  directionalColorTemperatureK: number;
  /** 阴影强度 0..1，阴天与低光时减弱 */
  shadowStrength: number;
  /** 归一化太阳方向 */
  sunDirection: { x: number; y: number; z: number };
  /** 该基线允许叠加的天气 */
  compatibleWeather: readonly WeatherType[];
}

export const VISUAL_PROFILES: Record<VisualProfileId, VisualProfile> = {
  day_clear: {
    id: 'day_clear',
    name: '晴天',
    exposure: 1.0,
    skyColor: '#87ceeb',
    fogColor: '#b8d4e8',
    fogDensity: 0.002,
    ambientIntensity: 0.6,
    ambientColor: '#cfe0f0',
    directionalIntensity: 1.0,
    directionalColorTemperatureK: 6000,
    shadowStrength: 0.9,
    sunDirection: { x: 0.4, y: 0.85, z: 0.3 },
    compatibleWeather: [WeatherType.CLEAR],
  },
  day_overcast: {
    id: 'day_overcast',
    name: '阴天（雨/雪/雾/沙尘）',
    exposure: 0.85,
    skyColor: '#8a95a3',
    fogColor: '#9aa4ad',
    fogDensity: 0.012,
    ambientIntensity: 0.45,
    ambientColor: '#aeb8c2',
    directionalIntensity: 0.6,
    directionalColorTemperatureK: 5200,
    shadowStrength: 0.4,
    sunDirection: { x: 0.4, y: 0.5, z: 0.3 },
    compatibleWeather: [WeatherType.RAIN, WeatherType.SNOW, WeatherType.FOG, WeatherType.SANDSTORM],
  },
  dusk: {
    id: 'dusk',
    name: '黄昏/黎明',
    exposure: 0.7,
    skyColor: '#ff8a4a',
    fogColor: '#d98a66',
    fogDensity: 0.008,
    ambientIntensity: 0.35,
    ambientColor: '#8a6a7a',
    directionalIntensity: 0.55,
    directionalColorTemperatureK: 3200,
    shadowStrength: 0.7,
    sunDirection: { x: 0.85, y: 0.12, z: 0.45 },
    compatibleWeather: Object.values(WeatherType),
  },
};

/**
 * 低光时段窗口（timeOfDay 0=午夜、0.25=日出、0.5=正午、0.75=日落）。
 * 黎明与黄昏共用 `dusk` 基线。
 */
export const DUSK_WINDOWS: readonly { start: number; end: number }[] = [
  { start: 0.18, end: 0.32 },
  { start: 0.68, end: 0.82 },
];

/** 按天气与一天中的时刻解析美术基线 ID */
export function resolveVisualProfileId(weather: WeatherType, timeOfDay: number): VisualProfileId {
  const inDusk = DUSK_WINDOWS.some((window) => timeOfDay >= window.start && timeOfDay <= window.end);
  if (inDusk) return 'dusk';
  if (weather === WeatherType.CLEAR) return 'day_clear';
  return 'day_overcast';
}

/**
 * 色温（开尔文）转线性 RGB，Tanner Helland 近似。
 * 返回 0..1 分量，可直接用于 THREE.Color。
 */
export function colorTemperatureToRGB(kelvin: number): { r: number; g: number; b: number } {
  const clamped = Math.min(40000, Math.max(1000, kelvin)) / 100;

  let r: number;
  if (clamped <= 66) r = 255;
  else r = 329.698727446 * Math.pow(clamped - 60, -0.1332047592);

  let g: number;
  if (clamped <= 66) g = 99.4708025861 * Math.log(clamped) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(clamped - 60, -0.0755148492);

  let b: number;
  if (clamped >= 66) b = 255;
  else if (clamped <= 19) b = 0;
  else b = 138.5177312231 * Math.log(clamped - 10) - 305.0447927307;

  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255) };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
