import { WebSocketClient, type NetworkMessage, type PlayerUpdate } from './WebSocketClient';

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  ammo: number;
  weapon: string;
  timestamp: number;
}

export class NetworkSync {
  private wsClient: WebSocketClient;
  private localPlayerId: string;
  private remotePlayers: Map<string, PlayerState> = new Map();
  private lastUpdateTime: number = 0;
  private updateInterval: number = 50;
  private interpolationDelay: number = 100;
  private predictionEnabled: boolean = true;

  constructor(wsUrl: string, playerId: string) {
    this.wsClient = new WebSocketClient(wsUrl);
    this.localPlayerId = playerId;
  }

  async connect(): Promise<void> {
    await this.wsClient.connect();
    this.wsClient.onMessage((msg: NetworkMessage) => {
      this.handleMessage(msg);
    });
  }

  private handleMessage(msg: NetworkMessage): void {
    switch (msg.type) {
      case 'update': {
        const update = msg.data as PlayerUpdate;
        if (update.id !== this.localPlayerId) {
          this.remotePlayers.set(update.id, {
            ...update,
            health: 100,
            ammo: 30,
            weapon: 'rifle',
            timestamp: Date.now(),
          });
        }
        break;
      }
      case 'leave': {
        const leaveData = msg.data as { id: string };
        this.remotePlayers.delete(leaveData.id);
        break;
      }
    }
  }

  sendPosition(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    this.wsClient.send({
      type: 'update',
      data: {
        id: this.localPlayerId,
        x,
        y,
        z,
        yaw,
        pitch,
        timestamp: now,
      } as PlayerUpdate,
    });
  }

  getRemotePlayers(): Map<string, PlayerState> {
    return new Map(this.remotePlayers);
  }

  getInterpolatedPosition(playerId: string, currentTime: number): PlayerState | null {
    const player = this.remotePlayers.get(playerId);
    if (!player) return null;

    const timeDiff = currentTime - player.timestamp;
    if (timeDiff > this.interpolationDelay) {
      return player;
    }

    return player;
  }

  disconnect(): void {
    this.wsClient.disconnect();
  }
}
