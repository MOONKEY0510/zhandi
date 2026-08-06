import * as THREE from 'three';
import type { AIBot } from '../ai/AIBot';

/**
 * 观战模式（阶段 10 P1：回放/观战与举报入口）。
 * 玩家阵亡等待重生期间激活：WASD 自由飞行相机 + Tab 循环跟随 AI 视角；
 * 重生时停用。观战只移动相机，不干预游戏逻辑（死亡时玩家控制本就停摆）。
 *
 * 阶段 10+ 新特性：击杀回放（killcam）——死亡后短暂展示击杀者视角 3 秒，
 * 然后自动切换普通观战模式。
 */

export interface SpectatorInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export const SPECTATOR_SPEED = 12;
export const SPECTATOR_MOUSE_SENSITIVITY = 0.0022;
export const SPECTATOR_FOLLOW_OFFSET = new THREE.Vector3(0, 2.5, 4);
export const KILLCAM_DURATION = 3.0;

export interface KillcamData {
  killerPosition: THREE.Vector3;
  killerRotation: number;
}

export class SpectatorMode {
  active = false;
  followIndex = -1;
  onTargetChanged: ((target: AIBot | null) => void) | null = null;

  // 击杀回放
  private killcamActive = false;
  private killcamData: KillcamData | null = null;
  private killcamEndTime = 0;
  private killcamTargetPos = new THREE.Vector3();
  private killcamLookTarget = new THREE.Vector3();

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.followIndex = -1;
  }

  deactivate(): void {
    if (!this.active && !this.killcamActive) return;
    this.active = false;
    this.followIndex = -1;
    this.killcamActive = false;
    this.killcamData = null;
    this.onTargetChanged?.(null);
  }

  /** 触发击杀回放 */
  startKillcam(data: KillcamData): void {
    this.killcamActive = true;
    this.killcamData = data;
    this.killcamEndTime = performance.now() / 1000 + KILLCAM_DURATION;
    // 初始相机：击杀者身后 3m
    this.killcamTargetPos.copy(data.killerPosition);
    this.killcamLookTarget.copy(data.killerPosition);
  }

  isKillcamActive(): boolean { return this.killcamActive; }

  cycleTarget(bots: readonly AIBot[]): void {
    if (bots.length === 0) { this.followIndex = -1; this.onTargetChanged?.(null); return; }
    this.followIndex = (this.followIndex + 1) % bots.length;
    this.onTargetChanged?.(bots[this.followIndex] ?? null);
  }

  clearTarget(): void { this.followIndex = -1; this.onTargetChanged?.(null); }

  getFollowTarget(bots: readonly AIBot[]): AIBot | null {
    if (this.followIndex < 0 || this.followIndex >= bots.length) return null;
    return bots[this.followIndex] ?? null;
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    input: SpectatorInput,
    mouse: { x: number; y: number },
    bots: readonly AIBot[],
  ): void {
    // 击杀回放优先
    if (this.killcamActive) {
      this.updateKillcam(camera);
      return;
    }
    if (!this.active) return;

    camera.rotation.y -= mouse.x * SPECTATOR_MOUSE_SENSITIVITY;
    camera.rotation.x = THREE.MathUtils.clamp(
      camera.rotation.x - mouse.y * SPECTATOR_MOUSE_SENSITIVITY,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );

    const target = this.getFollowTarget(bots);
    if (target) {
      const desired = target.mesh.position.clone().add(SPECTATOR_FOLLOW_OFFSET);
      camera.position.lerp(desired, Math.min(1, dt * 5));
      camera.lookAt(target.mesh.position);
      return;
    }

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const forward = dir.clone(); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (input.forward) move.add(forward);
    if (input.backward) move.sub(forward);
    if (input.right) move.add(right);
    if (input.left) move.sub(right);
    if (move.lengthSq() > 0) { move.normalize().multiplyScalar(SPECTATOR_SPEED * dt); camera.position.add(move); }
  }

  /** 击杀回放：相机吸附到击杀者身后 3m，缓慢旋转视角 */
  private updateKillcam(camera: THREE.PerspectiveCamera): void {
    if (!this.killcamData) return;
    const now = performance.now() / 1000;
    if (now >= this.killcamEndTime) {
      // 回放结束 → 切换到普通观战
      this.killcamActive = false;
      this.killcamData = null;
      this.activate();
      return;
    }

    const elapsed = KILLCAM_DURATION - (this.killcamEndTime - now);
    const progress = elapsed / KILLCAM_DURATION;

    // 相机从击杀者身后缓慢旋转
    const angle = this.killcamData.killerRotation + Math.sin(progress * Math.PI * 0.5) * 0.6;
    const behind = new THREE.Vector3(
      -Math.sin(angle) * 4,
      2.5,
      -Math.cos(angle) * 4,
    );
    const desired = this.killcamData.killerPosition.clone().add(behind);
    camera.position.lerp(desired, Math.min(1, 0.05));

    // 看向击杀者位置（略微抬高）
    const lookAt = this.killcamData.killerPosition.clone();
    lookAt.y += 1.2;
    camera.lookAt(lookAt);
  }
}