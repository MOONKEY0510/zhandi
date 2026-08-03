import { describe, expect, it } from 'vitest';
import { PerformanceMonitor, percentile } from './PerformanceMonitor';

describe('PerformanceMonitor', () => {
  it('calculates deterministic percentiles', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('captures frame and renderer statistics', () => {
    const monitor = new PerformanceMonitor(10);
    monitor.update(100);
    monitor.update(116);
    monitor.update(134);
    monitor.setRendererStats({ drawCalls: 120, triangles: 42_000, textures: 12, geometries: 20 });
    monitor.setEntityCount(11);

    const snapshot = monitor.capture(134);

    expect(snapshot.frameTimeMs).toBe(18);
    expect(snapshot.frameTimeP50Ms).toBe(16);
    expect(snapshot.frameTimeP95Ms).toBe(18);
    expect(snapshot.drawCalls).toBe(120);
    expect(snapshot.entities).toBe(11);
    expect(monitor.exportReport().samples).toHaveLength(1);
  });
});
