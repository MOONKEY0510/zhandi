import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { evaluateAIVisibility } from './AIVisibility';

const observer = new THREE.Vector3(0, 1.7, 0);
const target = new THREE.Vector3(20, 1.7, 0);

describe('AI visibility', () => {
  it('rejects targets beyond detection range', () => {
    expect(
      evaluateAIVisibility(observer, target, { maxDistance: 10, occludedByWorld: false, smokeVolumes: [] }),
    ).toEqual({ visible: false, reason: 'out_of_range' });
  });

  it('rejects targets behind world geometry', () => {
    expect(
      evaluateAIVisibility(observer, target, { maxDistance: 50, occludedByWorld: true, smokeVolumes: [] }),
    ).toEqual({ visible: false, reason: 'world_occlusion' });
  });

  it('rejects targets when smoke intersects the sight segment', () => {
    expect(
      evaluateAIVisibility(observer, target, {
        maxDistance: 50,
        occludedByWorld: false,
        smokeVolumes: [{ center: new THREE.Vector3(10, 1.7, 0), radius: 4 }],
      }),
    ).toEqual({ visible: false, reason: 'smoke_occlusion' });
  });

  it('keeps targets visible when smoke is outside the sight segment', () => {
    expect(
      evaluateAIVisibility(observer, target, {
        maxDistance: 50,
        occludedByWorld: false,
        smokeVolumes: [{ center: new THREE.Vector3(10, 1.7, 10), radius: 2 }],
      }).visible,
    ).toBe(true);
  });
});
