import * as THREE from 'three';

export interface NavigationNode {
  id: string;
  position: THREE.Vector3;
  neighbors: readonly string[];
}

export class NavigationGraph {
  private readonly nodes = new Map<string, NavigationNode>();

  addNode(node: NavigationNode): void {
    this.nodes.set(node.id, node);
  }

  getNode(id: string): NavigationNode | null {
    return this.nodes.get(id) ?? null;
  }

  findClosest(position: THREE.Vector3): NavigationNode | null {
    let closest: NavigationNode | null = null;
    let closestDistance = Infinity;
    for (const node of this.nodes.values()) {
      const distance = node.position.distanceToSquared(position);
      if (distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }
    return closest;
  }

  findPath(startId: string, goalId: string): NavigationNode[] {
    const start = this.nodes.get(startId);
    const goal = this.nodes.get(goalId);
    if (!start || !goal) return [];

    const open = new Set([startId]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startId, 0]]);
    const fScore = new Map<string, number>([[startId, start.position.distanceTo(goal.position)]]);

    while (open.size > 0) {
      const currentId = [...open].reduce((best, id) =>
        (fScore.get(id) ?? Infinity) < (fScore.get(best) ?? Infinity) ? id : best,
      );
      if (currentId === goalId) return this.reconstruct(cameFrom, currentId);
      open.delete(currentId);

      const current = this.nodes.get(currentId)!;
      for (const neighborId of current.neighbors) {
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;
        const tentative = (gScore.get(currentId) ?? Infinity) + current.position.distanceTo(neighbor.position);
        if (tentative >= (gScore.get(neighborId) ?? Infinity)) continue;
        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentative);
        fScore.set(neighborId, tentative + neighbor.position.distanceTo(goal.position));
        open.add(neighborId);
      }
    }

    return [];
  }

  private reconstruct(cameFrom: Map<string, string>, currentId: string): NavigationNode[] {
    const path = [this.nodes.get(currentId)!];
    while (cameFrom.has(currentId)) {
      currentId = cameFrom.get(currentId)!;
      path.unshift(this.nodes.get(currentId)!);
    }
    return path;
  }
}
