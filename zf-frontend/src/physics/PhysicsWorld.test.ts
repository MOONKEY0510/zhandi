import { beforeAll, describe, expect, it } from 'vitest';
import { ensureRapierLoaded } from './PhysicsLoader';
import { PhysicsWorld } from './PhysicsWorld';

describe('PhysicsWorld', () => {
  beforeAll(async () => {
    await ensureRapierLoaded();
  });

  it('applies the explicit fixed timestep to Rapier', () => {
    const physics = new PhysicsWorld();

    physics.step(1 / 30);

    expect(physics.world.timestep).toBeCloseTo(1 / 30);
  });

  it('detects walkable ground below a player capsule', () => {
    const physics = new PhysicsWorld();
    physics.createGround(120);
    physics.createCapsule('player', 0.4, 0.45, { x: 0, y: 0.85, z: 0 }, 70);
    physics.step(1 / 60);

    const ground = physics.probeGround('player', 1.05, Math.PI / 3);

    expect(ground.grounded).toBe(true);
    expect(ground.normal.y).toBeCloseTo(1);
    expect(ground.slopeAngle).toBeCloseTo(0);
  });

  it('resizes the player capsule for crouch transitions', () => {
    const physics = new PhysicsWorld();
    physics.createGround(120);
    physics.createCapsule('player', 0.4, 0.45, { x: 0, y: 0.85, z: 0 }, 70);

    physics.resizeCapsule('player', 0.4, 0.1);

    expect(physics.bodies.get('player')?.collider.halfHeight()).toBeCloseTo(0.1);
  });

  it('reports no ground when the capsule is airborne', () => {
    const physics = new PhysicsWorld();
    physics.createGround(120);
    physics.createCapsule('player', 0.4, 0.45, { x: 0, y: 10, z: 0 }, 70);
    physics.step(1 / 60);

    expect(physics.probeGround('player', 1.05, Math.PI / 3).grounded).toBe(false);
  });
});
