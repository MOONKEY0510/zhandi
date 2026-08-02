import * as THREE from 'three';

export interface HitInfo {
  hit: boolean;
  point?: THREE.Vector3;
  normal?: THREE.Vector3;
  distance?: number;
  target?: THREE.Object3D;
  isHeadshot?: boolean;
  bodyPart?: 'head' | 'torso' | 'limb';
}

export class Raycast {
  raycaster: THREE.Raycaster;
  camera: THREE.Camera;

  constructor(camera: THREE.Camera) {
    this.raycaster = new THREE.Raycaster();
    this.camera = camera;
  }

  cast(direction: THREE.Vector3, maxDistance: number, targets: THREE.Object3D[]): HitInfo {
    this.raycaster.set(this.camera.getWorldPosition(new THREE.Vector3()), direction);
    this.raycaster.far = maxDistance;

    const intersects = this.raycaster.intersectObjects(targets, true);

    if (intersects.length === 0) {
      return { hit: false };
    }

    const hit = intersects[0];
    const bodyPart = this.determineBodyPart(hit.object);
    const isHeadshot = bodyPart === 'head';

    return {
      hit: true,
      point: hit.point.clone(),
      normal: hit.face?.normal?.clone() || new THREE.Vector3(),
      distance: hit.distance,
      target: hit.object,
      isHeadshot,
      bodyPart,
    };
  }

  private determineBodyPart(object: THREE.Object3D): 'head' | 'torso' | 'limb' {
    if (object.userData.bodyPart) {
      return object.userData.bodyPart;
    }

    const name = object.name.toLowerCase();
    if (name.includes('head')) return 'head';
    if (name.includes('arm') || name.includes('leg') || name.includes('hand') || name.includes('foot')) return 'limb';

    return 'torso';
  }
}

export interface DamageInfo {
  baseDamage: number;
  headshotMultiplier: number;
  limbMultiplier: number;
  range: number;
}

export function calculateDamage(info: DamageInfo, bodyPart: 'head' | 'torso' | 'limb', distance: number): number {
  const falloff = Math.max(0.3, 1 - (distance / info.range) * 0.7);
  let damage = info.baseDamage * falloff;

  if (bodyPart === 'head') {
    damage *= info.headshotMultiplier;
  } else if (bodyPart === 'limb') {
    damage *= info.limbMultiplier;
  }

  return damage;
}
