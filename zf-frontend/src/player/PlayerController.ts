import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { InputState } from '../input/InputManager';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 5.0;
const SPRINT_SPEED = 8.0;
const CROUCH_SPEED = 2.5;
const JUMP_FORCE = 7.0;
const GROUND_FRICTION = 0.9;
const AIR_CONTROL = 0.3;
const MOUSE_SENSITIVITY = 0.002;

export class PlayerController {
  private physicsWorld: PhysicsWorld;
  private bodyId: string;
  private camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pitch = 0;
  private isGrounded = false;
  private wasJumpPressed = false;

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
    this.syncCamera();
  }

  private updateRotation(mouseMovement: { x: number; y: number }): void {
    this.yaw -= mouseMovement.x * MOUSE_SENSITIVITY;
    this.pitch -= mouseMovement.y * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
  }

  private updateMovement(input: InputState, _dt: number): void {
    const velocity = this.physicsWorld.getBodyLinearVelocity(this.bodyId);
    if (!velocity) return;

    const pos = this.physicsWorld.getBodyPosition(this.bodyId);
    if (!pos) return;

    this.isGrounded = pos.y <= PLAYER_HEIGHT / 2 + 0.05;

    const speed = input.sprint ? SPRINT_SPEED : input.crouch ? CROUCH_SPEED : WALK_SPEED;
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

    const newVelX = velocity.x * GROUND_FRICTION + targetVel.x * (1 - GROUND_FRICTION);
    const newVelZ = velocity.z * GROUND_FRICTION + targetVel.z * (1 - GROUND_FRICTION);

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

  private syncCamera(): void {
    const pos = this.physicsWorld.getBodyPosition(this.bodyId);
    if (!pos) return;

    const eyeHeight = PLAYER_HEIGHT - 0.1;
    this.camera.position.set(pos.x, pos.y + eyeHeight - (PLAYER_HEIGHT / 2), pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  getPosition(): { x: number; y: number; z: number } | null {
    return this.physicsWorld.getBodyPosition(this.bodyId);
  }

  getRotation(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
