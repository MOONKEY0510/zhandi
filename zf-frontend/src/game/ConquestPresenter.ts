import * as THREE from 'three';
import type { AIBot } from '../ai/AIBot';
import type { HealthSystem } from '../player/HealthSystem';
import type { ConquestMode } from './ConquestMode';

export interface ConquestEntitySnapshot {
  position: THREE.Vector3;
  team: import('./ConquestMode').TeamId;
}

export class ConquestPresenter {
  constructor(
    private readonly mode: ConquestMode,
    private readonly health: HealthSystem,
    private readonly bots: readonly AIBot[],
  ) {}

  collectEntities(playerPosition: { x: number; y: number; z: number } | null): ConquestEntitySnapshot[] {
    const entities: ConquestEntitySnapshot[] = [];

    if (playerPosition && !this.health.isDead) {
      const { x, y, z } = playerPosition;
      entities.push({ position: new THREE.Vector3(x, y, z), team: this.mode.playerTeam });
    }

    for (const bot of this.bots) {
      if (bot.state === 'dead') continue;
      entities.push({ position: bot.mesh.position.clone(), team: bot.team });
    }

    return entities;
  }

  update(dt: number, playerPosition: { x: number; y: number; z: number } | null): void {
    this.mode.update(dt, this.collectEntities(playerPosition));
  }

  getHudState(): {
    tickets: { axis: number; allies: number };
    controlPoints: {
      id: string;
      owner: string;
      progress: number;
      contested: boolean;
      axisCount: number;
      alliesCount: number;
    }[];
  } {
    return {
      tickets: this.mode.getTickets(),
      controlPoints: this.mode.getControlPointStatus(),
    };
  }
}
