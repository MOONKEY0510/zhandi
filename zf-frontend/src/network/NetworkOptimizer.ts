import type { NetworkMessage } from './WebSocketClient';

export class NetworkOptimizer {
  private compressionEnabled: boolean = true;
  private lastSentData: Map<string, number> = new Map();
  private updateRate: number = 20;
  private lastUpdateTime: number = 0;
  private deltaCompressionThreshold: number = 0.01;
  private objectPool: NetworkMessage[] = [];
  private poolSize: number = 100;

  constructor() {
    this.initializePool();
  }

  private initializePool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.objectPool.push({
        type: 'update',
        data: { id: '', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, timestamp: 0 },
      });
    }
  }

  acquireMessage(): NetworkMessage {
    if (this.objectPool.length > 0) {
      return this.objectPool.pop()!;
    }
    return { type: 'update', data: { id: '', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, timestamp: 0 } };
  }

  releaseMessage(msg: NetworkMessage): void {
    if (this.objectPool.length < this.poolSize) {
      this.objectPool.push(msg);
    }
  }

  compressData(data: Record<string, unknown>): string {
    if (!this.compressionEnabled) {
      return JSON.stringify(data);
    }

    const compressed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number') {
        compressed[key] = Math.round(value * 100) / 100;
      } else {
        compressed[key] = value;
      }
    }

    return JSON.stringify(compressed);
  }

  shouldSendUpdate(key: string, currentValue: number): boolean {
    const lastValue = this.lastSentData.get(key);
    if (lastValue === undefined) {
      this.lastSentData.set(key, currentValue);
      return true;
    }

    const diff = Math.abs(currentValue - lastValue);
    if (diff > this.deltaCompressionThreshold) {
      this.lastSentData.set(key, currentValue);
      return true;
    }

    return false;
  }

  shouldUpdate(): boolean {
    const now = Date.now();
    if (now - this.lastUpdateTime >= 1000 / this.updateRate) {
      this.lastUpdateTime = now;
      return true;
    }
    return false;
  }

  setUpdateRate(rate: number): void {
    this.updateRate = Math.max(1, Math.min(60, rate));
  }

  getUpdateRate(): number {
    return this.updateRate;
  }

  setCompressionEnabled(enabled: boolean): void {
    this.compressionEnabled = enabled;
  }

  getCompressionEnabled(): boolean {
    return this.compressionEnabled;
  }

  reset(): void {
    this.lastSentData.clear();
    this.lastUpdateTime = 0;
  }
}
