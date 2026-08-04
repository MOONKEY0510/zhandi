import { describe, expect, it } from 'vitest';
import { AudioVoiceManager, type VoiceRequest } from './AudioVoiceManager';

const ORIGIN = { x: 0, y: 0, z: 0 };

function makeRequest(overrides: Partial<VoiceRequest> = {}): VoiceRequest {
  return {
    id: 'voice',
    priority: 5,
    maxDistance: 100,
    durationMs: 500,
    position: ORIGIN,
    ...overrides,
  };
}

describe('AudioVoiceManager', () => {
  it('accepts real voices up to the limit', () => {
    const manager = new AudioVoiceManager(2, 4);
    const first = manager.request(makeRequest({ id: 'a' }), ORIGIN, 0);
    const second = manager.request(makeRequest({ id: 'b' }), ORIGIN, 0);

    expect(first!.virtual).toBe(false);
    expect(second!.virtual).toBe(false);
    expect(manager.getRealCount()).toBe(2);
    expect(manager.getVirtualCount()).toBe(0);
  });

  it('preempts the lowest-priority real voice when full', () => {
    const manager = new AudioVoiceManager(2, 4);
    manager.request(makeRequest({ id: 'low', priority: 2 }), ORIGIN, 0);
    manager.request(makeRequest({ id: 'mid', priority: 5 }), ORIGIN, 0);

    const high = manager.request(makeRequest({ id: 'high', priority: 9 }), ORIGIN, 0);

    expect(high!.virtual).toBe(false);
    expect(manager.getRealCount()).toBe(2);
    expect(manager.getVoice('low')).toBeUndefined();
    expect(manager.getVoice('high')).toBeDefined();
  });

  it('virtualizes instead of preempting when the new voice is not higher priority', () => {
    const manager = new AudioVoiceManager(1, 4);
    manager.request(makeRequest({ id: 'existing', priority: 5 }), ORIGIN, 0);

    const lower = manager.request(makeRequest({ id: 'lower', priority: 3 }), ORIGIN, 0);

    expect(lower!.virtual).toBe(true);
    expect(manager.getVoice('existing')!.virtual).toBe(false);
    expect(manager.getRealCount()).toBe(1);
  });

  it('runs distant voices as virtual without using real slots', () => {
    const manager = new AudioVoiceManager(1, 4);
    const far = manager.request(makeRequest({ id: 'far', position: { x: 500, y: 0, z: 0 } }), ORIGIN, 0);

    expect(far!.virtual).toBe(true);
    expect(manager.getRealCount()).toBe(0);
    expect(manager.getVirtualCount()).toBe(1);
  });

  it('rejects voices when virtual slots are exhausted and priority is low', () => {
    const manager = new AudioVoiceManager(1, 1);
    manager.request(makeRequest({ id: 'far1', priority: 5, position: { x: 500, y: 0, z: 0 } }), ORIGIN, 0);

    const rejected = manager.request(makeRequest({ id: 'far2', priority: 3, position: { x: 600, y: 0, z: 0 } }), ORIGIN, 0);
    expect(rejected).toBeNull();

    const preempted = manager.request(makeRequest({ id: 'far3', priority: 9, position: { x: 600, y: 0, z: 0 } }), ORIGIN, 0);
    expect(preempted).not.toBeNull();
    expect(manager.getVoice('far1')).toBeUndefined();
  });

  it('expires voices after their duration', () => {
    const manager = new AudioVoiceManager(4, 4);
    manager.request(makeRequest({ id: 'a', durationMs: 100 }), ORIGIN, 0);
    expect(manager.getStats().total).toBe(1);

    manager.update(200, ORIGIN);
    expect(manager.getStats().total).toBe(0);
  });

  it('promotes a virtual voice to real when it comes into range', () => {
    const manager = new AudioVoiceManager(4, 4);
    const far = manager.request(makeRequest({ id: 'a', position: { x: 500, y: 0, z: 0 } }), ORIGIN, 0);
    expect(far!.virtual).toBe(true);

    manager.update(100, { x: 450, y: 0, z: 0 });
    expect(manager.getVoice('a')!.virtual).toBe(false);
    expect(manager.getRealCount()).toBe(1);
  });

  it('demotes a real voice to virtual when it moves out of range', () => {
    const manager = new AudioVoiceManager(4, 4);
    manager.request(makeRequest({ id: 'a' }), ORIGIN, 0);
    expect(manager.getVoice('a')!.virtual).toBe(false);

    manager.update(100, { x: 500, y: 0, z: 0 });
    expect(manager.getVoice('a')!.virtual).toBe(true);
    expect(manager.getRealCount()).toBe(0);
  });

  it('releases and disposes cleanly', () => {
    const manager = new AudioVoiceManager(4, 4);
    manager.request(makeRequest({ id: 'a' }), ORIGIN, 0);
    manager.release('a');
    expect(manager.getStats().total).toBe(0);

    manager.request(makeRequest({ id: 'b' }), ORIGIN, 0);
    manager.dispose();
    expect(manager.getStats().total).toBe(0);
  });
});
