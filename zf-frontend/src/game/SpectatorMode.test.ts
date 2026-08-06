import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SpectatorMode, SPECTATOR_SPEED } from './SpectatorMode';
import type { AIBot } from '../ai/AIBot';

function makeBot(index: number): AIBot {
  return {
    mesh: { position: new THREE.Vector3(index * 5, 0, 0) },
  } as unknown as AIBot;
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  return camera;
}

describe('SpectatorMode（阶段 10 P1：观战模式）', () => {
  let mode: SpectatorMode;
  beforeEach(() => {
    mode = new SpectatorMode();
  });

  it('初始非激活；activate 激活并复位自由飞行', () => {
    expect(mode.active).toBe(false);
    mode.activate();
    expect(mode.active).toBe(true);
    expect(mode.followIndex).toBe(-1);
  });

  it('deactivate 停用并回调 null（重复停用幂等）', () => {
    const cb = vi.fn();
    mode.onTargetChanged = cb;
    mode.activate();
    mode.deactivate();
    expect(mode.active).toBe(false);
    expect(cb).toHaveBeenCalledWith(null);
    mode.deactivate(); // 幂等
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cycleTarget 在 bot 间循环，无 bot 时保持自由飞行', () => {
    const bots = [makeBot(0), makeBot(1), makeBot(2)];
    const cb = vi.fn();
    mode.onTargetChanged = cb;
    mode.activate();

    mode.cycleTarget(bots);
    expect(mode.followIndex).toBe(0);
    expect(mode.getFollowTarget(bots)).toBe(bots[0]);

    mode.cycleTarget(bots);
    expect(mode.followIndex).toBe(1);
    expect(mode.getFollowTarget(bots)).toBe(bots[1]);

    mode.cycleTarget(bots);
    expect(mode.followIndex).toBe(2);
    // 循环回 0
    mode.cycleTarget(bots);
    expect(mode.followIndex).toBe(0);
    expect(cb).toHaveBeenCalledTimes(4);

    mode.cycleTarget([]);
    expect(mode.followIndex).toBe(-1);
    expect(mode.getFollowTarget(bots)).toBeNull();
  });

  it('update 非激活时不改变相机', () => {
    const camera = makeCamera();
    const before = camera.position.clone();
    mode.update(0.1, camera, { forward: true, backward: false, left: false, right: false }, { x: 10, y: 0 }, []);
    expect(camera.position.distanceTo(before)).toBeLessThan(0.001);
  });

  it('update 自由飞行：前进沿相机朝向水平移动', () => {
    const camera = makeCamera();
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, -10); // 朝 -Z
    mode.activate();
    mode.update(1, camera, { forward: true, backward: false, left: false, right: false }, { x: 0, y: 0 }, []);
    // 1 秒前进 SPECTATOR_SPEED 米（z 减小）
    expect(camera.position.z).toBeCloseTo(-SPECTATOR_SPEED, 1);
    expect(camera.position.x).toBeCloseTo(0, 5);
  });

  it('update 跟随模式：相机朝目标移动并看向目标', () => {
    const bots = [makeBot(0)];
    bots[0].mesh.position.set(10, 0, 0);
    const camera = makeCamera();
    camera.position.set(0, 1.6, 0);
    mode.activate();
    mode.cycleTarget(bots);
    // 多帧收敛
    for (let i = 0; i < 120; i++) {
      mode.update(0.05, camera, { forward: false, backward: false, left: false, right: false }, { x: 0, y: 0 }, bots);
    }
    expect(camera.position.distanceTo(new THREE.Vector3(10, 2.5, 4))).toBeLessThan(0.5);
  });
});
