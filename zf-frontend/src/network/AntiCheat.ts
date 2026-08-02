import * as THREE from 'three';

export interface PlayerState {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  timestamp: number;
}

export interface CheatDetection {
  type: 'speed_hack' | 'fly_hack' | 'teleport' | 'aim_bot';
  confidence: number;
  playerId: string;
  timestamp: number;
  details: string;
}

export class AntiCheat {
  private playerStates: Map<string, PlayerState[]> = new Map();
  private maxHistorySize: number = 120;
  private speedThreshold: number = 15;
  private flyThreshold: number = 5;
  private teleportThreshold: number = 20;
  private aimBotThreshold: number = 0.95;
  private detections: CheatDetection[] = [];
  private bannedPlayers: Set<string> = new Set();

  addPlayerState(playerId: string, state: PlayerState): void {
    if (this.bannedPlayers.has(playerId)) return;

    let states = this.playerStates.get(playerId);
    if (!states) {
      states = [];
      this.playerStates.set(playerId, states);
    }

    states.push(state);
    if (states.length > this.maxHistorySize) {
      states.shift();
    }
  }

  checkSpeedHack(playerId: string): CheatDetection | null {
    const states = this.playerStates.get(playerId);
    if (!states || states.length < 2) return null;

    const current = states[states.length - 1];
    const previous = states[states.length - 2];
    const timeDiff = (current.timestamp - previous.timestamp) / 1000;

    if (timeDiff <= 0) return null;

    const distance = current.position.distanceTo(previous.position);
    const speed = distance / timeDiff;

    if (speed > this.speedThreshold) {
      return {
        type: 'speed_hack',
        confidence: Math.min(1, speed / this.speedThreshold - 1),
        playerId,
        timestamp: Date.now(),
        details: `Speed: ${speed.toFixed(2)} m/s (threshold: ${this.speedThreshold} m/s)`,
      };
    }

    return null;
  }

  checkFlyHack(playerId: string): CheatDetection | null {
    const states = this.playerStates.get(playerId);
    if (!states || states.length < 2) return null;

    const current = states[states.length - 1];
    const previous = states[states.length - 2];

    const heightDiff = current.position.y - previous.position.y;
    const timeDiff = (current.timestamp - previous.timestamp) / 1000;

    if (timeDiff <= 0) return null;

    const verticalVelocity = heightDiff / timeDiff;

    if (verticalVelocity > this.flyThreshold && current.position.y > 2) {
      return {
        type: 'fly_hack',
        confidence: Math.min(1, verticalVelocity / this.flyThreshold - 1),
        playerId,
        timestamp: Date.now(),
        details: `Vertical velocity: ${verticalVelocity.toFixed(2)} m/s (threshold: ${this.flyThreshold} m/s)`,
      };
    }

    return null;
  }

  checkTeleport(playerId: string): CheatDetection | null {
    const states = this.playerStates.get(playerId);
    if (!states || states.length < 2) return null;

    const current = states[states.length - 1];
    const previous = states[states.length - 2];

    const distance = current.position.distanceTo(previous.position);
    const timeDiff = (current.timestamp - previous.timestamp) / 1000;

    if (timeDiff <= 0) return null;

    const speed = distance / timeDiff;

    if (distance > this.teleportThreshold && speed > this.speedThreshold) {
      return {
        type: 'teleport',
        confidence: Math.min(1, distance / this.teleportThreshold - 1),
        playerId,
        timestamp: Date.now(),
        details: `Distance: ${distance.toFixed(2)}m in ${timeDiff.toFixed(2)}s`,
      };
    }

    return null;
  }

  checkAimBot(playerId: string, targetPosition: THREE.Vector3): CheatDetection | null {
    const states = this.playerStates.get(playerId);
    if (!states || states.length < 10) return null;

    let hitCount = 0;
    let totalShots = 0;

    for (let i = states.length - 10; i < states.length; i++) {
      const state = states[i];
      const distance = state.position.distanceTo(targetPosition);
      if (distance < 2) {
        hitCount++;
      }
      totalShots++;
    }

    const accuracy = totalShots > 0 ? hitCount / totalShots : 0;

    if (accuracy > this.aimBotThreshold) {
      return {
        type: 'aim_bot',
        confidence: accuracy,
        playerId,
        timestamp: Date.now(),
        details: `Accuracy: ${(accuracy * 100).toFixed(1)}% (threshold: ${(this.aimBotThreshold * 100).toFixed(1)}%)`,
      };
    }

    return null;
  }

  runAllChecks(playerId: string, targetPosition?: THREE.Vector3): CheatDetection[] {
    const detections: CheatDetection[] = [];

    const speedHack = this.checkSpeedHack(playerId);
    if (speedHack) detections.push(speedHack);

    const flyHack = this.checkFlyHack(playerId);
    if (flyHack) detections.push(flyHack);

    const teleport = this.checkTeleport(playerId);
    if (teleport) detections.push(teleport);

    if (targetPosition) {
      const aimBot = this.checkAimBot(playerId, targetPosition);
      if (aimBot) detections.push(aimBot);
    }

    this.detections.push(...detections);
    return detections;
  }

  banPlayer(playerId: string): void {
    this.bannedPlayers.add(playerId);
    this.playerStates.delete(playerId);
  }

  isBanned(playerId: string): boolean {
    return this.bannedPlayers.has(playerId);
  }

  getDetections(): CheatDetection[] {
    return [...this.detections];
  }

  clearDetections(): void {
    this.detections = [];
  }
}
