import * as THREE from 'three';
import { WeatherType } from './WeatherSystem';

/**
 * 天气与材质联动（阶段 6 渲染 P0）。
 * 雨天降低粗糙度模拟湿润，雪天把材质向冷白混合，沙尘压低亮度。
 * 记录材质原值，`restore()` 可完整还原，`clear()` 释放引用。
 */
export interface WeatherMaterialOverrides {
  /** 湿润时粗糙度乘数（<1 更光滑） */
  roughnessMultiplier: number;
  /** 颜色混合目标（hex），null 表示不混合 */
  tintColor: string | null;
  /** 颜色混合比例 0..1 */
  tintStrength: number;
  /** 整体亮度缩放 */
  brightnessScale: number;
}

export const WEATHER_MATERIAL_OVERRIDES: Record<WeatherType, WeatherMaterialOverrides> = {
  [WeatherType.CLEAR]: { roughnessMultiplier: 1, tintColor: null, tintStrength: 0, brightnessScale: 1 },
  [WeatherType.RAIN]: { roughnessMultiplier: 0.6, tintColor: '#3a4a5a', tintStrength: 0.08, brightnessScale: 0.95 },
  [WeatherType.SNOW]: { roughnessMultiplier: 0.9, tintColor: '#e8ecf2', tintStrength: 0.45, brightnessScale: 1.05 },
  [WeatherType.FOG]: { roughnessMultiplier: 1, tintColor: '#9aa0a8', tintStrength: 0.15, brightnessScale: 0.92 },
  [WeatherType.SANDSTORM]: { roughnessMultiplier: 1, tintColor: '#c8a050', tintStrength: 0.35, brightnessScale: 0.85 },
};

interface MaterialSnapshot {
  roughness: number | null;
  colorHex: number | null;
}

export class WeatherMaterialLink {
  private readonly snapshot = new Map<THREE.Material, MaterialSnapshot>();
  private appliedWeather: WeatherType | null = null;

  get currentWeather(): WeatherType | null {
    return this.appliedWeather;
  }

  /** 对给定材质应用天气覆盖；同一材质只记录一次原值 */
  apply(weather: WeatherType, materials: readonly THREE.Material[]): void {
    const overrides = WEATHER_MATERIAL_OVERRIDES[weather];
    for (const material of materials) {
      const snap = this.remember(material);

      const roughness = getRoughness(material);
      if (roughness !== null && snap.roughness !== null) {
        (material as THREE.MeshStandardMaterial).roughness = snap.roughness * overrides.roughnessMultiplier;
      }

      const color = getColor(material);
      if (color && snap.colorHex !== null) {
        const base = new THREE.Color(snap.colorHex);
        const tint = overrides.tintColor ? new THREE.Color(overrides.tintColor) : new THREE.Color(0xffffff);
        color.copy(base.clone().lerp(tint, overrides.tintStrength).multiplyScalar(overrides.brightnessScale));
      }
    }
    this.appliedWeather = weather;
  }

  /** 还原所有已记录材质到初始状态 */
  restore(): void {
    for (const [material, snap] of this.snapshot) {
      const roughness = getRoughness(material);
      if (roughness !== null && snap.roughness !== null) {
        (material as THREE.MeshStandardMaterial).roughness = snap.roughness;
      }
      const color = getColor(material);
      if (color && snap.colorHex !== null) {
        color.setHex(snap.colorHex);
      }
    }
    this.appliedWeather = null;
  }

  /** 清空记录，释放材质引用 */
  clear(): void {
    this.snapshot.clear();
    this.appliedWeather = null;
  }

  /** 已记录的材质数量（调试用） */
  getLinkedCount(): number {
    return this.snapshot.size;
  }

  private remember(material: THREE.Material): MaterialSnapshot {
    const existing = this.snapshot.get(material);
    if (existing) return existing;

    const snap: MaterialSnapshot = {
      roughness: getRoughness(material),
      colorHex: getColor(material)?.getHex() ?? null,
    };
    this.snapshot.set(material, snap);
    return snap;
  }
}

function getRoughness(material: THREE.Material): number | null {
  const candidate = (material as unknown as { roughness?: unknown }).roughness;
  return typeof candidate === 'number' ? candidate : null;
}

function getColor(material: THREE.Material): THREE.Color | null {
  const candidate = (material as unknown as { color?: unknown }).color;
  return candidate instanceof THREE.Color ? candidate : null;
}
