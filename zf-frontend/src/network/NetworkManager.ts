import { WebSocketClient, type PlayerUpdate, type NetworkMessage } from './WebSocketClient';

export class NetworkManager {
  private wsClient: WebSocketClient;
  private localPlayerId: string;
  private remotePlayers: Map<string, PlayerUpdate> = new Map();
  private lastUpdate: Map<string, number> = new Map();
  private interpolationDelay = 50;

  constructor(wsUrl: string, playerId: string) {
    this.wsClient = new WebSocketClient(wsUrl);
    this.localPlayerId = playerId;
  }

  async connect(): Promise<void> {
    await this.wsClient.connect();
  }

  sendPosition(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const update: PlayerUpdate = {
      id: this.localPlayerId,
      x,
      y,
      z,
      yaw,
      pitch,
      timestamp: Date.now(),
    };

    this.wsClient.send({
      type: 'update',
      data: update,
    });
  }

  onMessage(callback: (msg: NetworkMessage) => void): void {
    this.wsClient.onMessage(callback);
  }

  onConnect(callback: () => void): void {
    this.wsClient.onConnect(callback);
  }

  onDisconnect(callback: () => void): void {
    this.wsClient.onDisconnect(callback);
  }

  getRemotePlayers(): Map<string, PlayerUpdate> {
    return new Map(this.remotePlayers);
  }

  getInterpolatedPlayer(id: string, currentTime: number): PlayerUpdate | null {
    const update = this.remotePlayers.get(id);
    if (!update) return null;

    const lastUpdateTime = this.lastUpdate.get(id);
    if (!lastUpdateTime) return update;

    const timeDiff = currentTime - lastUpdateTime;
    if (timeDiff > this.interpolationDelay) {
      return update;
    }

    return update;
  }

  updateRemotePlayers(currentTime: number): void {
    for (const [id, _update] of this.remotePlayers) {
      const lastUpdateTime = this.lastUpdate.get(id);
      if (!lastUpdateTime) {
        this.lastUpdate.set(id, currentTime);
        continue;
      }

      const timeDiff = currentTime - lastUpdateTime;
      if (timeDiff > this.interpolationDelay) {
        this.remotePlayers.delete(id);
        this.lastUpdate.delete(id);
      }
    }
  }

  disconnect(): void {
    this.wsClient.disconnect();
  }
}
