import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export enum ColliderType {
  STATIC = 'static',
  DYNAMIC = 'dynamic',
  TRIGGER = 'trigger',
}

export interface ColliderConfig {
  type: ColliderType;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  shape: 'box' | 'sphere' | 'capsule' | 'cylinder';
  size: { x: number; y: number; z: number };
  mass?: number;
  friction?: number;
  restitution?: number;
  userData?: Record<string, unknown>;
}

export class CollisionSystem {
  world: RAPIER.World;
  colliders: Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider }> = new Map();
  triggerEvents: Map<string, Set<string>> = new Map();

  constructor(world: RAPIER.World) {
    this.world = world;
  }

  createCollider(id: string, config: ColliderConfig): void {
    let bodyDesc: RAPIER.RigidBodyDesc;

    switch (config.type) {
      case ColliderType.STATIC:
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
        break;
      case ColliderType.DYNAMIC:
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
        break;
      case ColliderType.TRIGGER:
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
        break;
    }

    bodyDesc.setTranslation(config.position.x, config.position.y, config.position.z);

    if (config.rotation) {
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(config.rotation.x, config.rotation.y, config.rotation.z)
      );
      bodyDesc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    }

    const body = this.world.createRigidBody(bodyDesc);

    let colliderDesc: RAPIER.ColliderDesc;
    switch (config.shape) {
      case 'box':
        colliderDesc = RAPIER.ColliderDesc.cuboid(config.size.x / 2, config.size.y / 2, config.size.z / 2);
        break;
      case 'sphere':
        colliderDesc = RAPIER.ColliderDesc.ball(config.size.x);
        break;
      case 'capsule':
        colliderDesc = RAPIER.ColliderDesc.capsule(config.size.y / 2, config.size.x);
        break;
      case 'cylinder':
        colliderDesc = RAPIER.ColliderDesc.cylinder(config.size.y / 2, config.size.x);
        break;
    }

    if (config.mass !== undefined) {
      colliderDesc.setMass(config.mass);
    }
    if (config.friction !== undefined) {
      colliderDesc.setFriction(config.friction);
    }
    if (config.restitution !== undefined) {
      colliderDesc.setRestitution(config.restitution);
    }

    if (config.type === ColliderType.TRIGGER) {
      colliderDesc.setSensor(true);
    }

    const collider = this.world.createCollider(colliderDesc, body);

    if (config.userData) {
      // Store user data on the body since collider doesn't have setUserData
      (body as unknown as Record<string, unknown>).userData = config.userData;
    }

    this.colliders.set(id, { body, collider });
  }

  removeCollider(id: string): void {
    const collider = this.colliders.get(id);
    if (collider) {
      this.world.removeRigidBody(collider.body);
      this.colliders.delete(id);
    }
  }

  getColliderPosition(id: string): { x: number; y: number; z: number } | null {
    const collider = this.colliders.get(id);
    if (!collider) return null;
    const pos = collider.body.translation();
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  setColliderPosition(id: string, position: { x: number; y: number; z: number }): void {
    const collider = this.colliders.get(id);
    if (collider) {
      collider.body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
    }
  }

  castRay(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, maxDistance: number): { hit: boolean; point?: { x: number; y: number; z: number }; distance?: number } {
    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(origin.x, origin.y, origin.z),
      new RAPIER.Vector3(direction.x, direction.y, direction.z)
    );

    const hit = this.world.castRay(ray, maxDistance, true);

    if (hit) {
      const point = ray.pointAt(hit.timeOfImpact);
      return {
        hit: true,
        point: { x: point.x, y: point.y, z: point.z },
        distance: hit.timeOfImpact,
      };
    }

    return { hit: false };
  }

  checkTriggerOverlap(triggerId: string): string[] {
    const trigger = this.colliders.get(triggerId);
    if (!trigger) return [];

    const overlapping: string[] = [];
    for (const [id, collider] of this.colliders) {
      if (id !== triggerId && this.checkIntersection(trigger.collider, collider.collider)) {
        overlapping.push(id);
      }
    }

    return overlapping;
  }

  private checkIntersection(a: RAPIER.Collider, b: RAPIER.Collider): boolean {
    const aPos = a.translation();
    const bPos = b.translation();
    const distance = Math.sqrt(
      Math.pow(aPos.x - bPos.x, 2) +
      Math.pow(aPos.y - bPos.y, 2) +
      Math.pow(aPos.z - bPos.z, 2)
    );
    return distance < 2;
  }

  dispose(): void {
    for (const [id, collider] of this.colliders) {
      this.world.removeRigidBody(collider.body);
    }
    this.colliders.clear();
  }
}
