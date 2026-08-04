import { distanceBetween, type VfxPosition } from '../effects/VfxPool';

/**
 * 音频并发/优先级/虚拟化（阶段 6 音频 P0）。
 * 32 人混战时枪声/爆炸声远多于可用音频节点，这里统一管理 voice 生命周期：
 * - 超出可听距离的请求直接进入“虚拟播放”：只记账不创建真实节点，远处回来再转真实；
 * - 真实节点有上限，满员时按优先级抢占（低优先级被淘汰或降级为虚拟）；
 * - 虚拟也有上限，防止记账本身失控。
 * 接入层根据 voice.virtual 决定是否创建 AudioBufferSourceNode。
 */
export interface VoiceRequest {
  id: string;
  /** 0..10，越大越优先保留 */
  priority: number;
  /** 该声音的最远可听距离 m */
  maxDistance: number;
  durationMs: number;
  position: VfxPosition;
}

export interface ActiveVoice {
  id: string;
  priority: number;
  virtual: boolean;
  startedAtMs: number;
  expiresAtMs: number;
  maxDistance: number;
  position: VfxPosition;
  /** 距监听者距离 m（每次 update 刷新） */
  distance: number;
}

export interface VoiceManagerStats {
  real: number;
  virtual: number;
  total: number;
}

export class AudioVoiceManager {
  private readonly voices = new Map<string, ActiveVoice>();

  constructor(
    private readonly maxRealVoices = 24,
    private readonly maxVirtualVoices = 64,
  ) {}

  /** 请求一个声音；返回 null 表示被预算拒绝（调用方应放弃播放） */
  request(request: VoiceRequest, listener: VfxPosition, nowMs: number): ActiveVoice | null {
    const distance = distanceBetween(request.position, listener);
    const existing = this.voices.get(request.id);

    if (existing) {
      existing.priority = request.priority;
      existing.maxDistance = request.maxDistance;
      existing.expiresAtMs = nowMs + request.durationMs;
      existing.position = { ...request.position };
      existing.distance = distance;
      this.reconcile(existing);
      return this.voices.has(request.id) ? existing : null;
    }

    const voice: ActiveVoice = {
      id: request.id,
      priority: request.priority,
      virtual: distance > request.maxDistance,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + request.durationMs,
      maxDistance: request.maxDistance,
      position: { ...request.position },
      distance,
    };

    if (voice.virtual) {
      if (!this.accommodateVirtual(voice)) return null;
      this.voices.set(request.id, voice);
      return voice;
    }

    if (this.getRealCount() < this.maxRealVoices) {
      this.voices.set(request.id, voice);
      return voice;
    }

    const victim = this.findLowestPriorityReal();
    if (!victim || victim.priority >= voice.priority) {
      // 抢不过低优先级，也没有真实名额 → 尝试虚拟化
      if (!this.accommodateVirtual(voice)) return null;
      voice.virtual = true;
      this.voices.set(request.id, voice);
      return voice;
    }

    this.voices.delete(victim.id);
    this.voices.set(request.id, voice);
    return voice;
  }

  /** 每帧调用：清理过期，按距离刷新真实/虚拟归属 */
  update(nowMs: number, listener: VfxPosition): void {
    for (const [id, voice] of [...this.voices]) {
      if (nowMs >= voice.expiresAtMs) {
        this.voices.delete(id);
        continue;
      }
      voice.distance = distanceBetween(voice.position, listener);
      this.reconcile(voice);
    }
  }

  release(id: string): void {
    this.voices.delete(id);
  }

  getVoice(id: string): ActiveVoice | undefined {
    return this.voices.get(id);
  }

  getRealCount(): number {
    let count = 0;
    for (const voice of this.voices.values()) {
      if (!voice.virtual) count++;
    }
    return count;
  }

  getVirtualCount(): number {
    let count = 0;
    for (const voice of this.voices.values()) {
      if (voice.virtual) count++;
    }
    return count;
  }

  getStats(): VoiceManagerStats {
    const real = this.getRealCount();
    return { real, virtual: this.voices.size - real, total: this.voices.size };
  }

  dispose(): void {
    this.voices.clear();
  }

  /** 虚拟播放与真实播放之间的转换；转换失败（无配额）时移除该 voice */
  private reconcile(voice: ActiveVoice): void {
    const shouldBeVirtual = voice.distance > voice.maxDistance;

    if (shouldBeVirtual && !voice.virtual) {
      if (this.getVirtualCount() < this.maxVirtualVoices) {
        voice.virtual = true;
      } else {
        this.voices.delete(voice.id);
      }
      return;
    }

    if (!shouldBeVirtual && voice.virtual && this.getRealCount() < this.maxRealVoices) {
      voice.virtual = false;
    }
  }

  private accommodateVirtual(voice: ActiveVoice): boolean {
    if (this.getVirtualCount() < this.maxVirtualVoices) return true;
    const victim = this.findLowestPriorityVirtual();
    if (!victim || victim.priority >= voice.priority) return false;
    this.voices.delete(victim.id);
    return true;
  }

  private findLowestPriorityReal(): ActiveVoice | null {
    let lowest: ActiveVoice | null = null;
    for (const voice of this.voices.values()) {
      if (voice.virtual) continue;
      if (!lowest || voice.priority < lowest.priority) lowest = voice;
    }
    return lowest;
  }

  private findLowestPriorityVirtual(): ActiveVoice | null {
    let lowest: ActiveVoice | null = null;
    for (const voice of this.voices.values()) {
      if (!voice.virtual) continue;
      if (!lowest || voice.priority < lowest.priority) lowest = voice;
    }
    return lowest;
  }
}
