/**
 * Node（ws 包）WebSocket 传输：实现 RawTransport。
 * 供 headless 客户端（压测/soak）与集成测试复用；connect 等待 onopen。
 */
import { WebSocket } from 'ws';
import type { RawTransport } from '../src/network/NetClient.ts';

export class NodeTransport implements RawTransport {
  private ws: WebSocket;
  private msgCb: ((bytes: Uint8Array) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (event) => {
      this.msgCb?.(new Uint8Array(event.data as ArrayBuffer));
    };
    this.ws.onclose = () => this.closeCb?.('closed');
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === this.ws.OPEN) {
        resolve();
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket 连接失败'));
    });
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(bytes);
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.ws.close();
  }
}
