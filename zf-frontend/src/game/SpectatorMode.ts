import * as THREE from 'three';
import type { AIBot } from '../ai/AIBot';

/**
 * 观战模式（阶段 10 P1：回放/观战与举报入口）。
 * 玩家阵亡等待重生期间激活：WASD 自由飞行相机 + Tab 循环跟随 AI 视角；
 * 重生时停用。观战只移动相机，不干预游戏逻辑（死亡时玩家控制本就停摆）。
 */

export interface SpectatorInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export const SPECTATOR_SPEED = 12; // 自由飞行速度（m/s）
export const SPECTATOR_MOUSE_SENSITIVITY = 0.0022;
export const SPECTATOR_FOLLOW_OFFSET = new THREE.Vector3(0, 2.5, 4);

export class SpectatorMode {
  active = false;
  /** -1 = 自由飞行；>=0 = 跟随 bots[followIndex] */
  followIndex = -1;
  onTargetChanged: ((target: AIBot | null) => void) | null = null;

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.followIndex = -1;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.followIndex = -1;
    this.onTargetChanged?.(null);
  }

  /** Tab 循环切换跟随目标；无 bot 时保持自由飞行 */
  cycleTarget(bots: readonly AIBot[]): void {
    if (bots.length === 0) {
      this.followIndex = -1;
      this.onTargetChanged?.(null);
      return;
    }
    this.followIndex = (this.followIndex + 1) % bots.length;
    this.onTargetChanged?.(bots[this.followIndex] ?? null);
  }

  clearTarget(): void {
    this.followIndex = -1;
    this.onTargetChanged?.(null);
  }

  getFollowTarget(bots: readonly AIBot[]): AIBot | null {
    if (this.followIndex < 0 || this.followIndex >= bots.length) return null;
    return bots[this.followIndex] ?? null;
  }

  /**
   * 观战相机更新（仅在 active 时由 GameScene 每帧调用）。
   * 自由飞行：WASD 沿相机朝向移动 + 鼠标转向；跟随：平滑吸附到目标上方后方。
   */
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    input: SpectatorInput,
    mouse: { x: number; y: number },
    bots: readonly AIBot[],
  ): void {
    if (!this.active) return;

    // 鼠标视角
    camera.rotation.y -= mouse.x * SPECTATOR_MOUSE_SENSITIVITY;
    camera.rotation.x = THREE.MathUtils.clamp(
      camera.rotation.x - mouse.y * SPECTATOR_MOUSE_SENSITIVITY,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );

    const target = this.getFollowTarget(bots);
    if (target) {
      // 跟随模式：吸附到目标上方后方
      const desired = target.mesh.position.clone().add(SPECTATOR_FOLLOW_OFFSET);
      camera.position.lerp(desired, Math.min(1, dt * 5));
      camera.lookAt(target.mesh.position);
      return;
    }

    // 自由飞行
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const forward = dir.clone();
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (input.forward) move.add(forward);
    if (input.backward) move.sub(forward);
    if (input.right) move.add(right);
    if (input.left) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(SPECTATOR_SPEED * dt);
      camera.position.add(move);
    }
  }
}
