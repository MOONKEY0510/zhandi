import * as THREE from 'three';

export interface ProjectileState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  ageSeconds: number;
  distanceTravelled: number;
}

export interface ProjectileConfig {
  speed: number;
  gravity: number;
  maxLifetimeSeconds: number;
}

export class Projectile {
  readonly state: ProjectileState;

  constructor(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    readonly config: ProjectileConfig,
  ) {
    this.state = {
      position: origin.clone(),
      velocity: direction.clone().normalize().multiplyScalar(config.speed),
      ageSeconds: 0,
      distanceTravelled: 0,
    };
  }

  step(dt: number): ProjectileState {
    const previous = this.state.position.clone();
    this.state.velocity.y -= this.config.gravity * dt;
    this.state.position.addScaledVector(this.state.velocity, dt);
    this.state.ageSeconds += dt;
    this.state.distanceTravelled += previous.distanceTo(this.state.position);
    return this.state;
  }

  isExpired(): boolean {
    return this.state.ageSeconds >= this.config.maxLifetimeSeconds;
  }

  static flightTime(distance: number, speed: number): number {
    return distance / Math.max(speed, Number.EPSILON);
  }
}
