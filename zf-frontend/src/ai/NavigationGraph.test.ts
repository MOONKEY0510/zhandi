import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NavigationGraph } from './NavigationGraph';

function createGraph(): NavigationGraph {
  const graph = new NavigationGraph();
  graph.addNode({ id: 'A', position: new THREE.Vector3(0, 0, 0), neighbors: ['B', 'D'] });
  graph.addNode({ id: 'B', position: new THREE.Vector3(5, 0, 0), neighbors: ['A', 'C'] });
  graph.addNode({ id: 'C', position: new THREE.Vector3(10, 0, 0), neighbors: ['B'] });
  graph.addNode({ id: 'D', position: new THREE.Vector3(0, 0, 20), neighbors: ['A'] });
  graph.addNode({ id: 'X', position: new THREE.Vector3(100, 0, 100), neighbors: [] });
  return graph;
}

describe('NavigationGraph', () => {
  it('finds the shortest reachable path with A*', () => {
    expect(createGraph().findPath('A', 'C').map((node) => node.id)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty path for unreachable nodes', () => {
    expect(createGraph().findPath('A', 'X')).toEqual([]);
  });

  it('finds the closest waypoint to a world position', () => {
    expect(createGraph().findClosest(new THREE.Vector3(8, 0, 1))?.id).toBe('C');
  });
});
