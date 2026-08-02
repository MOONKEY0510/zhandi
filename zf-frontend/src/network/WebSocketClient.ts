export interface PlayerUpdate {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  timestamp: number;
}

export interface NetworkMessage {
  type: 'join' | 'leave' | 'update' | 'ping' | 'pong';
  data: PlayerUpdate | { id: string } | { timestamp: number };
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval = 3000;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: number | null = null;
  private onMessageCallback: ((msg: NetworkMessage) => void) | null = null;
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.startPing();
          this.onConnectCallback?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg: NetworkMessage = JSON.parse(event.data);
            this.onMessageCallback?.(msg);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.onDisconnectCallback?.();
          this.stopPing();
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect failed, will try again
      });
    }, this.reconnectInterval);
  }

  send(msg: NetworkMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.pingInterval = window.setInterval(() => {
      this.send({
        type: 'ping',
        data: { timestamp: Date.now() },
      });
    }, 5000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  onMessage(callback: (msg: NetworkMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onConnect(callback: () => void): void {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
