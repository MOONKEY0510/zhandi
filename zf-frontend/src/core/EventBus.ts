export type EventHandler<Payload> = (payload: Payload) => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<EventHandler<Events[keyof Events]>>>();

  on<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): () => void {
    let eventHandlers = this.handlers.get(type);
    if (!eventHandlers) {
      eventHandlers = new Set();
      this.handlers.set(type, eventHandlers);
    }
    eventHandlers.add(handler as EventHandler<Events[keyof Events]>);
    return () => this.off(type, handler);
  }

  off<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): void {
    const eventHandlers = this.handlers.get(type);
    eventHandlers?.delete(handler as EventHandler<Events[keyof Events]>);
    if (eventHandlers?.size === 0) this.handlers.delete(type);
  }

  emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void {
    const eventHandlers = this.handlers.get(type);
    if (!eventHandlers) return;
    for (const handler of [...eventHandlers]) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
