import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';

interface TestEvents {
  score: { amount: number };
  message: string;
}

describe('EventBus', () => {
  it('delivers typed payloads and supports unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.on('score', handler);

    bus.emit('score', { amount: 10 });
    unsubscribe();
    bus.emit('score', { amount: 20 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ amount: 10 });
  });

  it('is safe when handlers unsubscribe during dispatch', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.on('message', () => unsubscribe());
    bus.on('message', handler);

    bus.emit('message', 'ready');
    bus.emit('message', 'again');

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
