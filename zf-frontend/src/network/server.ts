import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

interface PlayerUpdate {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  timestamp: number;
}

interface NetworkMessage {
  type: 'join' | 'leave' | 'update' | 'ping' | 'pong';
  data: PlayerUpdate | { id: string } | { timestamp: number };
}

const server = createServer();
const wss = new WebSocketServer({ server });

const clients = new Map<string, WebSocket>();
const playerStates = new Map<string, PlayerUpdate>();

wss.on('connection', (ws: WebSocket) => {
  const playerId = generatePlayerId();
  clients.set(playerId, ws);
  console.log(`Player ${playerId} connected. Total: ${clients.size}`);

  ws.on('message', (data: Buffer) => {
    try {
      const msg: NetworkMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case 'update': {
          const update = msg.data as PlayerUpdate;
          update.id = playerId;
          playerStates.set(playerId, update);
          broadcast(msg, playerId);
          break;
        }
        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            data: { timestamp: Date.now() },
          }));
          break;
        }
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(playerId);
    playerStates.delete(playerId);
    console.log(`Player ${playerId} disconnected. Total: ${clients.size}`);
    broadcast({
      type: 'leave',
      data: { id: playerId },
    }, playerId);
  });

  ws.send(JSON.stringify({
    type: 'join',
    data: { id: playerId },
  }));
});

function broadcast(msg: NetworkMessage, excludeId: string): void {
  for (const [id, client] of clients) {
    if (id !== excludeId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}

function generatePlayerId(): string {
  return Math.random().toString(36).substring(2, 15);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
