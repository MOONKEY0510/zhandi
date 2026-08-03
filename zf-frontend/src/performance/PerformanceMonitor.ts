export interface PerformanceSnapshot {
  timestamp: number;
  fps: number;
  frameTimeMs: number;
  frameTimeP50Ms: number;
  frameTimeP95Ms: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  entities: number;
}

export interface PerformanceReport {
  startedAt: string;
  generatedAt: string;
  samples: PerformanceSnapshot[];
  latest: PerformanceSnapshot;
}

export class PerformanceMonitor {
  private readonly startedAt = new Date().toISOString();
  private readonly frameTimes: number[] = [];
  private readonly samples: PerformanceSnapshot[] = [];
  private lastFrameTime: number | null = null;
  private fps = 0;
  private frameTimeMs = 0;
  private drawCalls = 0;
  private triangles = 0;
  private textures = 0;
  private geometries = 0;
  private entities = 0;

  constructor(
    private readonly sampleWindowSize = 600,
    private readonly maxSamples = 1_800,
  ) {}

  update(currentTime = performance.now()): void {
    if (this.lastFrameTime === null) {
      this.lastFrameTime = currentTime;
      return;
    }

    this.frameTimeMs = Math.max(0, currentTime - this.lastFrameTime);
    this.lastFrameTime = currentTime;

    if (this.frameTimeMs > 0) {
      this.fps = 1_000 / this.frameTimeMs;
      this.frameTimes.push(this.frameTimeMs);
      if (this.frameTimes.length > this.sampleWindowSize) this.frameTimes.shift();
    }
  }

  setRendererStats(stats: {
    drawCalls: number;
    triangles: number;
    textures: number;
    geometries: number;
  }): void {
    this.drawCalls = stats.drawCalls;
    this.triangles = stats.triangles;
    this.textures = stats.textures;
    this.geometries = stats.geometries;
  }

  setEntityCount(count: number): void {
    this.entities = Math.max(0, count);
  }

  capture(timestamp = performance.now()): PerformanceSnapshot {
    const snapshot = this.getSnapshot(timestamp);
    this.samples.push(snapshot);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return snapshot;
  }

  getSnapshot(timestamp = performance.now()): PerformanceSnapshot {
    return {
      timestamp,
      fps: this.fps,
      frameTimeMs: this.frameTimeMs,
      frameTimeP50Ms: percentile(this.frameTimes, 0.5),
      frameTimeP95Ms: percentile(this.frameTimes, 0.95),
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      textures: this.textures,
      geometries: this.geometries,
      entities: this.entities,
    };
  }

  exportReport(): PerformanceReport {
    return {
      startedAt: this.startedAt,
      generatedAt: new Date().toISOString(),
      samples: [...this.samples],
      latest: this.getSnapshot(),
    };
  }

  getFrameTime(): number {
    return this.frameTimeMs;
  }

  getStats(): PerformanceSnapshot {
    return this.getSnapshot();
  }

  reset(): void {
    this.frameTimes.length = 0;
    this.samples.length = 0;
    this.lastFrameTime = null;
    this.fps = 0;
    this.frameTimeMs = 0;
  }
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.ceil(clampedRatio * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
