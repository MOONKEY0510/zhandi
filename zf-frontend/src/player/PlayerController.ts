import * as THREE from 'three';
import { DEFAULT_GAME_CONFIG, DEFAULT_GAME_SETTINGS, type GameSettings } from '../config';
import type { InputState } from '../input/InputManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const PLAYER_CONFIG = DEFAULT_GAME_CONFIG.player;
const PLAYER_HEIGHT = PLAYER_CONFIG.height;
const CROUCH_HEIGHT = PLAYER_CONFIG.crouchHeight;
const PLAYER_RADIUS = PLAYER_CONFIG.radius;
const WALK_SPEED = PLAYER_CONFIG.walkSpeed;
const SPRINT_SPEED = PLAYER_CONFIG.sprintSpeed;
const CROUCH_SPEED = PLAYER_CONFIG.crouchSpeed;
const JUMP_FORCE = PLAYER_CONFIG.jumpForce;
const AIR_CONTROL = PLAYER_CONFIG.airControl;
const MOUSE_SENSITIVITY = PLAYER_CONFIG.mouseSensitivity;
const ACCELERATION = PLAYER_CONFIG.acceleration;

// 体力系统
const MAX_STAMINA = PLAYER_CONFIG.maxStamina;
const STAMINA_DRAIN_RATE = PLAYER_CONFIG.staminaDrainRate;
const STAMINA_REGEN_RATE = PLAYER_CONFIG.staminaRegenRate;
const STAMINA_MIN_TO_SPRINT = PLAYER_CONFIG.staminaMinToSprint;

// 坠落伤害
const FALL_DAMAGE_THRESHOLD = PLAYER_CONFIG.fallDamageThreshold;
const FALL_DAMAGE_MULTIPLIER = PLAYER_CONFIG.fallDamageMultiplier;

// 头部摆动
const BOB_FREQUENCY = 10;
const BOB_AMPLITUDE_X = 0.03;
const BOB_AMPLITUDE_Y = 0.05;

// FOV
const BASE_FOV = PLAYER_CONFIG.baseFov;
const SPRINT_FOV = PLAYER_CONFIG.sprintFov;
const ADS_FOV = PLAYER_CONFIG.adsFov;
const FOV_LERP_SPEED = PLAYER_CONFIG.fovLerpSpeed;

export class PlayerController {
  private physicsWorld: PhysicsWorld;
  private bodyId: string;
  private camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pitch = 0;
  private isGrounded = false;
  private wasJumpPressed = false;
  private prevVelocityY = 0;

  // 体力
  stamina = MAX_STAMINA;
  private isSprinting = false;

  // 屏幕震动
  private shakeAmount = 0;
  private shakeDecay = 0;
  /** 阶段 10：屏幕震动幅度乘数（reduceScreenShake=0.3，默认 1） */
  private shakeMultiplier = 1;

  // 头部摆动
  private bobPhase = 0;
  private bobIntensity = 0;

  // 蹲下
  private isCrouching = false;
  private currentHeight = PLAYER_HEIGHT;

  // FOV
  private currentFov = BASE_FOV;
  private targetFov = BASE_FOV;
  private isAiming = false;
  private settings: Pick<GameSettings, 'sensitivity' | 'adsSensitivityMultiplier' | 'fov' | 'invertY'> = {
    sensitivity: DEFAULT_GAME_SETTINGS.sensitivity,
    adsSensitivityMultiplier: DEFAULT_GAME_SETTINGS.adsSensitivityMultiplier,
    fov: DEFAULT_GAME_SETTINGS.fov,
    invertY: DEFAULT_GAME_SETTINGS.invertY,
  };

  // 相机后坐力
  private cameraRecoilPitch = 0;
  private cameraRecoilYaw = 0;

  constructor(physicsWorld: PhysicsWorld, camera: THREE.PerspectiveCamera) {
    this.physicsWorld = physicsWorld;
    this.camera = camera;
    this.bodyId = 'player';

    physicsWorld.createCapsule(
      this.bodyId,
      PLAYER_RADIUS,
      (PLAYER_HEIGHT / 2) - PLAYER_RADIUS,
      { x: 0, y: PLAYER_HEIGHT / 2 + 2, z: 0 },
      70.0
    );

    physicsWorld.setBodyLinearVelocity(this.bodyId, { x: 0, y: 0, z: 0 });
  }

  update(input: InputState, mouseMovement: { x: number; y: number }, dt: number): void {
    this.updateRotation(mouseMovement);
    this.updateMovement(input, dt);
    this.updateStamina(input, dt);
    this.updateCrouch(input, dt);
    this.updateBob(input, dt);
    this.updateFov(dt);
    this.updateCameraRecoil(dt);
    this.syncCamera(dt);
  }

  private updateRotation(mouseMovement: { x: number; y: number }): void {
    const sensitivity = MOUSE_SENSITIVITY * (this.settings.sensitivity / 50);
    const aimingMultiplier = this.isAiming ? this.settings.adsSensitivityMultiplier : 1;
    const invertY = this.settings.invertY ? -1 : 1;
    this.yaw -= mouseMovement.x * sensitivity * aimingMultiplier;
    this.pitch -= mouseMovement.y * sensitivity * aimingMultiplier * invertY;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  }

  private updateMovement(input: InputState, dt: number): void {
    const velocity = this.physicsWorld.getBodyLinearVelocity(this.bodyId);
    if (!velocity) return;

    const pos = this.physicsWorld.getBodyPosition(this.bodyId);
    if (!pos) return;

    const wasGrounded = this.isGrounded;
    const ground = this.physicsWorld.probeGround(
      this.bodyId,
      PLAYER_CONFIG.groundProbeDistance,
      THREE.MathUtils.degToRad(PLAYER_CONFIG.maxSlopeAngleDegrees),
    );
    this.isGrounded = ground.grounded;

    // 坠落伤害检测
    if (!wasGrounded && this.isGrounded && this.prevVelocityY < -FALL_DAMAGE_THRESHOLD) {
      const fallDamage = (-this.prevVelocityY - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_MULTIPLIER;
      this.onFallDamage?.(fallDamage);
    }
    this.prevVelocityY = velocity.y;

    // 冲刺需要体力
    const canSprint = input.sprint && this.stamina > STAMINA_MIN_TO_SPRINT && !input.crouch;
    this.isSprinting = canSprint && (input.forward || input.backward);

    const speed = this.isSprinting ? SPRINT_SPEED : input.crouch ? CROUCH_SPEED : WALK_SPEED;
    const controlFactor = this.isGrounded ? 1.0 : AIR_CONTROL;

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const targetVel = new THREE.Vector3(0, 0, 0);

    if (input.forward) targetVel.add(forward);
    if (input.backward) targetVel.sub(forward);
    if (input.left) targetVel.sub(right);
    if (input.right) targetVel.add(right);

    if (targetVel.lengthSq() > 0) {
      targetVel.normalize().multiplyScalar(speed * controlFactor);
    }

    // 平滑加速（替代简单摩擦混合）
    const accel = this.isGrounded ? ACCELERATION : ACCELERATION * AIR_CONTROL;
    const newVelX = velocity.x + (targetVel.x - velocity.x) * Math.min(1, accel * dt);
    const newVelZ = velocity.z + (targetVel.z - velocity.z) * Math.min(1, accel * dt);

    let newVelY = velocity.y;
    if (input.jump && this.isGrounded && !this.wasJumpPressed) {
      newVelY = JUMP_FORCE;
      this.isGrounded = false;
    }
    this.wasJumpPressed = input.jump;

    this.physicsWorld.setBodyLinearVelocity(this.bodyId, {
      x: newVelX,
      y: newVelY,
      z: newVelZ,
    });
  }

  private updateStamina(input: InputState, dt: number): void {
    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN_RATE * dt);
    }
  }

  private updateCrouch(input: InputState, dt: number): void {
    let wantsCrouch = input.crouch;
    if (!wantsCrouch && this.isCrouching) {
      const standingHalfHeight = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
      const centerOffset = (PLAYER_HEIGHT - CROUCH_HEIGHT) / 2;
      wantsCrouch = !this.physicsWorld.canResizeCapsule(
        this.bodyId,
        PLAYER_RADIUS,
        standingHalfHeight,
        centerOffset,
      );
    }

    if (wantsCrouch !== this.isCrouching) {
      this.isCrouching = wantsCrouch;
      const colliderHeight = this.isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
      this.physicsWorld.resizeCapsule(
        this.bodyId,
        PLAYER_RADIUS,
        colliderHeight / 2 - PLAYER_RADIUS,
      );
    }

    const targetHeight = this.isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    this.currentHeight += (targetHeight - this.currentHeight) * Math.min(1, 10 * dt);
  }

  private updateBob(input: InputState, dt: number): void {
    const isMoving = input.forward || input.backward || input.left || input.right;
    const speedFactor = this.isSprinting ? 1.5 : this.isCrouching ? 0.5 : 1.0;

    if (isMoving && this.isGrounded) {
      this.bobPhase += dt * BOB_FREQUENCY * speedFactor;
      this.bobIntensity = Math.min(1, this.bobIntensity + dt * 5);
    } else {
      this.bobIntensity = Math.max(0, this.bobIntensity - dt * 5);
    }
  }

  private updateFov(dt: number): void {
    // ADS 优先级最高，其次是冲刺
    if (this.isAiming) {
      this.targetFov = ADS_FOV;
    } else if (this.isSprinting) {
      this.targetFov = SPRINT_FOV;
    } else {
      this.targetFov = this.settings.fov;
    }
    this.currentFov += (this.targetFov - this.currentFov) * Math.min(1, FOV_LERP_SPEED * dt);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  // 设置瞄准状态（由 GameScene 调用）
  setAiming(aiming: boolean): void {
    this.isAiming = aiming;
  }

  applySettings(settings: GameSettings): void {
    this.settings = {
      sensitivity: settings.sensitivity,
      adsSensitivityMultiplier: settings.adsSensitivityMultiplier,
      fov: settings.fov,
      invertY: settings.invertY,
    };
    // 阶段 10：可访问性——减少屏幕震动（乘 0.3）
    this.shakeMultiplier = settings.reduceScreenShake ? 0.3 : 1;
  }

  private updateCameraRecoil(dt: number): void {
    // 相机后坐力恢复
    this.cameraRecoilPitch *= Math.max(0, 1 - 8 * dt);
    this.cameraRecoilYaw *= Math.max(0, 1 - 8 * dt);
  }

  // 添加相机后坐力（射击时调用）
  addCameraRecoil(pitchAmount: number, yawAmount: number): void {
    this.cameraRecoilPitch += pitchAmount;
    this.cameraRecoilYaw += (Math.random() - 0.5) * yawAmount;
  }

  private syncCamera(dt: number): void {
    const pos = this.physicsWorld.getBodyPosition(this.bodyId);
    if (!pos) return;

    const eyeHeight = this.currentHeight - 0.1;
    let camX = pos.x;
    let camY = pos.y + eyeHeight - (this.currentHeight / 2);
    let camZ = pos.z;

    // 头部摆动
    if (this.bobIntensity > 0) {
      const bobX = Math.sin(this.bobPhase) * BOB_AMPLITUDE_X * this.bobIntensity;
      const bobY = Math.abs(Math.cos(this.bobPhase)) * BOB_AMPLITUDE_Y * this.bobIntensity;
      camX += bobX * Math.cos(this.yaw) - bobY * Math.sin(this.yaw) * 0.3;
      camY += bobY;
      camZ += bobX * Math.sin(this.yaw) + bobY * Math.cos(this.yaw) * 0.3;
    }

    // 屏幕震动
    if (this.shakeAmount > 0) {
      camX += (Math.random() - 0.5) * this.shakeAmount;
      camY += (Math.random() - 0.5) * this.shakeAmount;
      camZ += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount = Math.max(0, this.shakeAmount - this.shakeDecay * dt);
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.cameraRecoilYaw;
    this.camera.rotation.x = this.pitch + this.cameraRecoilPitch;
  }

  // 触发屏幕震动（阶段 10：reduceScreenShake 时幅度乘 0.3）
  addShake(amount: number, decay: number = 5): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount * this.shakeMultiplier);
    this.shakeDecay = decay;
  }

  // 重置坠落伤害追踪（重生/传送时调用）
  resetFallState(): void {
    this.prevVelocityY = 0;
    this.isGrounded = true;
    this.shakeAmount = 0;
    this.bobPhase = 0;
    this.bobIntensity = 0;
    this.cameraRecoilPitch = 0;
    this.cameraRecoilYaw = 0;
  }

  // 坠落伤害回调
  onFallDamage?: (damage: number) => void;

  getPosition(): { x: number; y: number; z: number } | null {
    return this.physicsWorld.getBodyPosition(this.bodyId);
  }

  /**
   * 联网权威回写：水平位置向服务端预测轨迹收敛（保留 y 与刚体速度，
   * 不破坏跳跃/下蹲/物理碰撞手感；垂直由本地物理负责，服务端移动模型暂无 y 轴）。
   * 仅供联网模式（GameScene 每帧调用），单机模式不触发。
   */
  teleportHorizontal(x: number, z: number): void {
    const pos = this.physicsWorld.getBodyPosition(this.bodyId);
    if (!pos) return;
    this.physicsWorld.setBodyPosition(this.bodyId, { x, y: pos.y, z });
  }

  getRotation(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  getStaminaPercentage(): number {
    return (this.stamina / MAX_STAMINA) * 100;
  }

  isSprintActive(): boolean {
    return this.isSprinting;
  }

  isCrouchActive(): boolean {
    return this.isCrouching;
  }
}
