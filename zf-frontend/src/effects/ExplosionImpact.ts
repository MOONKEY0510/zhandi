import { distanceBetween, type VfxPosition } from './VfxPool';

/**
 * 爆炸冲击（阶段 6 特效 P0）。
 * 一次爆炸同时驱动四个通道：物理冲量、相机震动、耳鸣、扬尘；
 * 每个通道有独立的每秒预算，预算耗尽时该通道降级（强度归零并记录），
 * 避免 32 人混战时震动/耳鸣/冲量互相叠加导致体验与性能失控。
 */
export type ImpactChannel = 'shockwave' | 'camera_shake' | 'tinnitus' | 'dust';

export interface ExplosionImpactConfig {
  radius: number;
  /** 近距离最大物理冲量 */
  maxImpulse: number;
  /** 近距离最大相机震动幅度 0..1 */
  maxShakeAmplitude: number;
  shakeDurationMs: number;
  /** 耳鸣触发距离 = radius * factor */
  tinnitusRadiusFactor: number;
  tinnitusDurationMs: number;
  /** 扬尘触发距离 = radius * factor */
  dustRadiusFactor: number;
  dustDurationMs: number;
  /** 每秒预算（通道各自的强度·次数额度） */
  budgets: Record<ImpactChannel, number>;
}

export const DEFAULT_EXPLOSION_IMPACT_CONFIG: ExplosionImpactConfig = {
  radius: 12,
  maxImpulse: 40,
  maxShakeAmplitude: 1,
  shakeDurationMs: 800,
  tinnitusRadiusFactor: 0.5,
  tinnitusDurationMs: 4000,
  dustRadiusFactor: 0.8,
  dustDurationMs: 1500,
  budgets: { shockwave: 60, camera_shake: 6, tinnitus: 4, dust: 8 },
};

export interface ExplosionImpactResult {
  impulse: number;
  shakeAmplitude: number;
  shakeDurationMs: number;
  tinnitus: boolean;
  tinnitusIntensity: number;
  dust: boolean;
  dustIntensity: number;
  /** 因预算耗尽而被降级的通道（调试信息） */
  degraded: readonly ImpactChannel[];
}

const ZERO_USAGE: Record<ImpactChannel, number> = { shockwave: 0, camera_shake: 0, tinnitus: 0, dust: 0 };

export class ExplosionImpactSystem {
  private usage: Record<ImpactChannel, number> = { ...ZERO_USAGE };
  private lastResetMs = 0;

  constructor(private readonly config: ExplosionImpactConfig = DEFAULT_EXPLOSION_IMPACT_CONFIG) {}

  /** 在爆炸位置触发冲击，按监听者距离计算各通道强度 */
  trigger(position: VfxPosition, listener: VfxPosition, nowMs: number): ExplosionImpactResult {
    this.update(nowMs);

    const distance = distanceBetween(position, listener);
    const falloff = 1 - clamp01(distance / this.config.radius);
    const intensity = falloff * falloff;
    const degraded: ImpactChannel[] = [];

    const impulse = this.spend('shockwave', this.config.maxImpulse * intensity)
      ? this.config.maxImpulse * intensity
      : (degraded.push('shockwave'), 0);

    const shakeCost = this.config.maxShakeAmplitude * intensity;
    const shakeAmplitude = this.spend('camera_shake', shakeCost)
      ? shakeCost
      : (degraded.push('camera_shake'), 0);

    const tinnitusDistance = this.config.radius * this.config.tinnitusRadiusFactor;
    const tinnitusRaw = distance <= tinnitusDistance ? intensity : 0;
    const tinnitus = tinnitusRaw > 0 && this.spend('tinnitus', tinnitusRaw);
    if (tinnitusRaw > 0 && !tinnitus) degraded.push('tinnitus');

    const dustDistance = this.config.radius * this.config.dustRadiusFactor;
    const dustRaw = distance <= dustDistance ? intensity : 0;
    const dust = dustRaw > 0 && this.spend('dust', dustRaw);
    if (dustRaw > 0 && !dust) degraded.push('dust');

    return {
      impulse,
      shakeAmplitude,
      shakeDurationMs: shakeAmplitude > 0 ? this.config.shakeDurationMs : 0,
      tinnitus,
      tinnitusIntensity: tinnitus ? tinnitusRaw : 0,
      dust,
      dustIntensity: dust ? dustRaw : 0,
      degraded,
    };
  }

  /** 每秒滚动重置预算窗口 */
  update(nowMs: number): void {
    if (nowMs - this.lastResetMs >= 1000) {
      this.usage = { ...ZERO_USAGE };
      this.lastResetMs = nowMs;
    }
  }

  getBudgetUsage(): Readonly<Record<ImpactChannel, number>> {
    return { ...this.usage };
  }

  private spend(channel: ImpactChannel, cost: number): boolean {
    if (cost <= 0) return true;
    if (this.usage[channel] + cost > this.config.budgets[channel]) return false;
    this.usage[channel] += cost;
    return true;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
