export class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private fps = 0;
  private frameTime = 0;
  private drawCalls = 0;
  private triangles = 0;
  private memoryUsage = 0;

  update(): void {
    this.frameCount++;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;

    if (deltaTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.frameCount = 0;
      this.lastTime = currentTime;
    }

    this.frameTime = deltaTime;
  }

  getFPS(): number {
    return this.fps;
  }

  getFrameTime(): number {
    return this.frameTime;
  }

  setDrawCalls(count: number): void {
    this.drawCalls = count;
  }

  getDrawCalls(): number {
    return this.drawCalls;
  }

  setTriangles(count: number): void {
    this.triangles = count;
  }

  getTriangles(): number {
    return this.triangles;
  }

  setMemoryUsage(bytes: number): void {
    this.memoryUsage = bytes;
  }

  getMemoryUsageMB(): string {
    return (this.memoryUsage / (1024 * 1024)).toFixed(2);
  }

  getStats(): {
    fps: number;
    frameTime: number;
    drawCalls: number;
    triangles: number;
    memoryMB: string;
  } {
    return {
      fps: this.fps,
      frameTime: this.frameTime,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      memoryMB: this.getMemoryUsageMB(),
    };
  }

  reset(): void {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 0;
    this.frameTime = 0;
  }
}
