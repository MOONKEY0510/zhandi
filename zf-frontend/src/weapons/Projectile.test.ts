import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Projectile } from './Projectile';

describe('Projectile', () => {
  it('integrates velocity, gravity and distance at a fixed timestep', () => {
    const projectile = new Projectile(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, -1),
      { speed: 100, gravity: 9.81, maxLifetimeSeconds: 2 },
    );

    for (let tick = 0; tick < 60; tick++) projectile.step(1 / 60);

    expect(projectile.state.position.z).toBeCloseTo(-100, 5);
    expect(projectile.state.position.y).toBeLessThan(1);
    expect(projectile.state.ageSeconds).toBeCloseTo(1, 8);
  });

  it('reports weapon flight times for target distances', () => {
    expect(Projectile.flightTime(60, 620)).toBeCloseTo(0.0968, 3);
    expect(Projectile.flightTime(200, 760)).toBeCloseTo(0.2632, 3);
  });
});
