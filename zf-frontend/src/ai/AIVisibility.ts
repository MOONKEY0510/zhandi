import * as THREE from 'three';

export interface SmokeVolume {
  center: THREE.Vector3;
  radius: number;
}

export interface AIVisibilityContext {
  maxDistance: number;
  occludedByWorld: boolean;
  smokeVolumes: readonly SmokeVolume[];
}

export interface AIVisibilityResult {
  visible: boolean;
  reason: 'visible' | 'out_of_range' | 'world_occlusion' | 'smoke_occlusion';
}

export function evaluateAIVisibility(
  observer: THREE.Vector3,
  target: THREE.Vector3,
  context: AIVisibilityContext,
): AIVisibilityResult {
  if (observer.distanceTo(target) > context.maxDistance) {
    return { visible: false, reason: 'out_of_range' };
  }
  if (context.occludedByWorld) {
    return { visible: false, reason: 'world_occlusion' };
  }
  if (context.smokeVolumes.some((smoke) => segmentIntersectsSphere(observer, target, smoke))) {
    return { visible: false, reason: 'smoke_occlusion' };
  }
  return { visible: true, reason: 'visible' };
}

function segmentIntersectsSphere(start: THREE.Vector3, end: THREE.Vector3, smoke: SmokeVolume): boolean {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return start.distanceToSquared(smoke.center) <= smoke.radius * smoke.radius;
  const t = Math.max(0, Math.min(1, smoke.center.clone().sub(start).dot(segment) / lengthSquared));
  const closest = start.clone().addScaledVector(segment, t);
  return closest.distanceToSquared(smoke.center) <= smoke.radius * smoke.radius;
}
