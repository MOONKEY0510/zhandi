import type * as THREE from 'three';
import type { TeamId } from './ConquestMode';

export interface GameEvents {
  'combat:hit': {
    damage: number;
    headshot: boolean;
    point: THREE.Vector3;
    time: number;
  };
  'combat:kill': {
    source: 'weapon' | 'equipment';
    label: string;
    headshot: boolean;
    victimTeam: TeamId;
    victimId?: string;
    time: number;
  };
  'player:death': {
    team: TeamId;
    time: number;
  };
  'round:end': {
    winner: TeamId;
    winnerName: string;
    time: number;
  };
  'ui:message': {
    text: string;
    time: number;
  };
}
