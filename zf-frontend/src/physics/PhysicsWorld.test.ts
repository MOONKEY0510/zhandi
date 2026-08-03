import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from './PhysicsWorld';

describe('PhysicsWorld', () => {
  beforeAll(async () => {
    await RAPIER.init();
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

  it('reports no ground when the capsule is airborne', () => {
    const physics = new PhysicsWorld();
    physics.createGround(120);
    physics.createCapsule('player', 0.4, 0.45, { x: 0, y: 10, z: 0 }, 70);
    physics.step(1 / 60);

    expect(physics.probeGround('player', 1.05, Math.PI / 3).grounded).toBe(false);
  });
});
