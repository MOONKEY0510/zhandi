import RAPIER from '@dimforge/rapier3d-compat';

export interface GroundProbe {
  grounded: boolean;
  distance: number;
  normal: { x: number; y: number; z: number };
  slopeAngle: number;
}

export class PhysicsWorld {
  world: RAPIER.World;
  gravity = { x: 0, y: -9.81, z: 0 };
  bodies: Map<string, { rigidBody: RAPIER.RigidBody; collider: RAPIER.Collider }> = new Map();

  constructor() {
    this.world = new RAPIER.World(this.gravity);
  }

  static async init(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  createCapsule(
    id: string,
    radius: number,
    halfHeight: number,
    position: { x: number; y: number; z: number },
    mass = 1.0
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);

    const rigidBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setMass(mass)
      .setFriction(0.5)
      .setRestitution(0.0);

    const collider = this.world.createCollider(colliderDesc, rigidBody);
    this.bodies.set(id, { rigidBody, collider });
    return rigidBody;
  }

  createGround(size: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -size / 2, 0);
    const rigidBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
      .setFriction(0.8)
      .setRestitution(0.1);
    this.world.createCollider(colliderDesc, rigidBody);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  probeGround(id: string, maxDistance: number, maxSlopeAngle: number): GroundProbe {
    const body = this.bodies.get(id);
    if (!body) {
      return { grounded: false, distance: Infinity, normal: { x: 0, y: 1, z: 0 }, slopeAngle: 0 };
    }

    this.world.propagateModifiedBodyPositionsToColliders();
    const position = body.rigidBody.translation();
    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(position.x, position.y, position.z),
      new RAPIER.Vector3(0, -1, 0),
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      body.collider,
      body.rigidBody,
    );

    if (!hit) {
      return { grounded: false, distance: Infinity, normal: { x: 0, y: 1, z: 0 }, slopeAngle: 0 };
    }

    const normal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
    const slopeAngle = Math.acos(Math.max(-1, Math.min(1, normal.y)));
    return {
      grounded: hit.timeOfImpact <= maxDistance && slopeAngle <= maxSlopeAngle,
      distance: hit.timeOfImpact,
      normal,
      slopeAngle,
    };
  }

  getBodyPosition(id: string): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    const pos = body.rigidBody.translation();
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  setBodyPosition(id: string, pos: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(id);
    if (body) {
      body.rigidBody.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
    }
  }

  applyImpulse(id: string, impulse: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(id);
    if (body) {
      body.rigidBody.applyImpulse(new RAPIER.Vector3(impulse.x, impulse.y, impulse.z), true);
    }
  }

  setBodyLinearVelocity(id: string, velocity: { x: number; y: number; z: number }): void {
    const body = this.bodies.get(id);
    if (body) {
      body.rigidBody.setLinvel(new RAPIER.Vector3(velocity.x, velocity.y, velocity.z), true);
    }
  }

  getBodyLinearVelocity(id: string): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    const vel = body.rigidBody.linvel();
    return { x: vel.x, y: vel.y, z: vel.z };
  }
}
