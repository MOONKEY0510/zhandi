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
});
