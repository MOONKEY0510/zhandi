/**
 * 动态分辨率（阶段 6 渲染 P0 / 阶段 9 性能）。
 * 根据帧时间平滑调整渲染像素比：持续超预算时逐档降低，恢复后带滞回与冷却再升回，
 * 避免画质在临界帧率附近频繁抖动。接入层把返回的 scale 乘到 renderer.setPixelRatio。
 */
export interface DynamicResolutionOptions {
  /** 最低渲染比例（0..1） */
  minScale: number;
  /** 最高渲染比例（0..1），通常为 1 */
  maxScale: number;
  /** 目标帧时间 ms（60 FPS ≈ 16.7） */
  targetFrameTimeMs: number;
  /** 目标死区 ms：帧时间落在 target ± tolerance 内不调整 */
  toleranceMs: number;
  /** 滞回 ms：进入降档需要超过 high+hysteresis，升回需要低于 low-hysteresis */
  hysteresisMs: number;
  /** 单次调整步长 */
  step: number;
  /** 两次调整的最短间隔 ms，防止抖动 */
  minIntervalMs: number;
}

export const DEFAULT_DYNAMIC_RESOLUTION_OPTIONS: DynamicResolutionOptions = {
  minScale: 0.5,
  maxScale: 1,
  targetFrameTimeMs: 16.7,
  toleranceMs: 2,
  hysteresisMs: 3,
  step: 0.05,
  minIntervalMs: 500,
};

export class DynamicResolution {
  private scale: number;
  private lastChangeTimeMs = -Infinity;

  constructor(private readonly options: DynamicResolutionOptions = DEFAULT_DYNAMIC_RESOLUTION_OPTIONS) {
    this.scale = options.maxScale;
  }

  /** 每帧调用，返回当前建议 scale */
  update(frameTimeMs: number, nowMs: number): number {
    const { targetFrameTimeMs, toleranceMs, hysteresisMs, step, minIntervalMs, minScale, maxScale } = this.options;
    const highThreshold = targetFrameTimeMs + toleranceMs + hysteresisMs;
    const lowThreshold = targetFrameTimeMs - toleranceMs - hysteresisMs;

    if (frameTimeMs > highThreshold && this.scale > minScale) {
      if (nowMs - this.lastChangeTimeMs >= minIntervalMs) {
        this.scale = Math.max(minScale, this.scale - step);
        this.lastChangeTimeMs = nowMs;
      }
    } else if (frameTimeMs < lowThreshold && this.scale < maxScale) {
      if (nowMs - this.lastChangeTimeMs >= minIntervalMs) {
        this.scale = Math.min(maxScale, this.scale + step);
        this.lastChangeTimeMs = nowMs;
      }
    }

    return this.scale;
  }

  getScale(): number {
    return this.scale;
  }

  reset(): void {
    this.scale = this.options.maxScale;
    this.lastChangeTimeMs = -Infinity;
  }
}
