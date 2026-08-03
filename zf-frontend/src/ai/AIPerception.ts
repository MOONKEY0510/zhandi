import * as THREE from 'three';

export interface PerceivedThreat {
  id: string;
  position: THREE.Vector3;
  lastSeenAt: number;
  lastHeardAt: number;
  visible: boolean;
  threat: number;
}

export class AIPerception {
  private readonly threats = new Map<string, PerceivedThreat>();

  constructor(readonly memoryDurationMs = 5_000) {}

  see(id: string, position: THREE.Vector3, threat: number, time: number): void {
    const existing = this.threats.get(id);
    this.threats.set(id, {
      id,
      position: position.clone(),
      lastSeenAt: time,
      lastHeardAt: existing?.lastHeardAt ?? -Infinity,
      visible: true,
      threat,
    });
  }

  hear(id: string, position: THREE.Vector3, loudness: number, time: number): void {
    const existing = this.threats.get(id);
    this.threats.set(id, {
      id,
      position: position.clone(),
      lastSeenAt: existing?.lastSeenAt ?? -Infinity,
      lastHeardAt: time,
      visible: existing?.visible ?? false,
      threat: Math.max(existing?.threat ?? 0, loudness),
    });
  }

  update(time: number): void {
    for (const [id, threat] of this.threats) {
      threat.visible = false;
      if (time - Math.max(threat.lastSeenAt, threat.lastHeardAt) > this.memoryDurationMs) {
        this.threats.delete(id);
      }
    }
  }

  getHighestThreat(origin: THREE.Vector3): PerceivedThreat | null {
    let best: PerceivedThreat | null = null;
    let bestScore = -Infinity;
    for (const threat of this.threats.values()) {
      const score = threat.threat * 100 - origin.distanceTo(threat.position);
      if (score > bestScore) {
        best = threat;
        bestScore = score;
      }
    }
    return best;
  }
}
