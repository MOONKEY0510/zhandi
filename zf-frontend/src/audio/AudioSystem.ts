export enum SoundType {
  GUNSHOT = 'gunshot',
  RELOAD = 'reload',
  FOOTSTEP = 'footstep',
  EXPLOSION = 'explosion',
  HIT = 'hit',
  DEATH = 'death',
  AMBIENT = 'ambient',
  UI_CLICK = 'ui_click',
  UI_HOVER = 'ui_hover',
}

export interface SoundConfig {
  type: SoundType;
  url: string;
  volume: number;
  loop: boolean;
  spatial: boolean;
  maxDistance: number;
  rolloffFactor: number;
}

export const SOUND_CONFIGS: Record<SoundType, SoundConfig> = {
  [SoundType.GUNSHOT]: {
    type: SoundType.GUNSHOT,
    url: '/sounds/gunshot.mp3',
    volume: 0.8,
    loop: false,
    spatial: true,
    maxDistance: 100,
    rolloffFactor: 1,
  },
  [SoundType.RELOAD]: {
    type: SoundType.RELOAD,
    url: '/sounds/reload.mp3',
    volume: 0.6,
    loop: false,
    spatial: false,
    maxDistance: 10,
    rolloffFactor: 1,
  },
  [SoundType.FOOTSTEP]: {
    type: SoundType.FOOTSTEP,
    url: '/sounds/footstep.mp3',
    volume: 0.4,
    loop: false,
    spatial: true,
    maxDistance: 20,
    rolloffFactor: 1,
  },
  [SoundType.EXPLOSION]: {
    type: SoundType.EXPLOSION,
    url: '/sounds/explosion.mp3',
    volume: 1.0,
    loop: false,
    spatial: true,
    maxDistance: 150,
    rolloffFactor: 1,
  },
  [SoundType.HIT]: {
    type: SoundType.HIT,
    url: '/sounds/hit.mp3',
    volume: 0.5,
    loop: false,
    spatial: false,
    maxDistance: 10,
    rolloffFactor: 1,
  },
  [SoundType.DEATH]: {
    type: SoundType.DEATH,
    url: '/sounds/death.mp3',
    volume: 0.7,
    loop: false,
    spatial: true,
    maxDistance: 50,
    rolloffFactor: 1,
  },
  [SoundType.AMBIENT]: {
    type: SoundType.AMBIENT,
    url: '/sounds/ambient.mp3',
    volume: 0.3,
    loop: true,
    spatial: false,
    maxDistance: 0,
    rolloffFactor: 0,
  },
  [SoundType.UI_CLICK]: {
    type: SoundType.UI_CLICK,
    url: '/sounds/ui_click.mp3',
    volume: 0.5,
    loop: false,
    spatial: false,
    maxDistance: 0,
    rolloffFactor: 0,
  },
  [SoundType.UI_HOVER]: {
    type: SoundType.UI_HOVER,
    url: '/sounds/ui_hover.mp3',
    volume: 0.3,
    loop: false,
    spatial: false,
    maxDistance: 0,
    rolloffFactor: 0,
  },
};

export class AudioSystem {
  audioContext: AudioContext | null = null;
  sounds: Map<SoundType, AudioBuffer> = new Map();
  activeSources: Map<string, AudioBufferSourceNode> = new Map();
  masterVolume: number = 1.0;
  isMuted: boolean = false;
  listenerPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  listenerOrientation: { forward: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } } = {
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
  };

  constructor() {
    this.init();
  }

  async init(): Promise<void> {
    try {
      this.audioContext = new AudioContext();
      this.generateSounds();
    } catch (error) {
      console.warn('Audio initialization failed:', error);
    }
  }

  // 使用 WebAudio 合成音效，无需外部音频文件
  private generateSounds(): void {
    if (!this.audioContext) return;

    // 枪声：短促的噪声脉冲 + 低频
    this.sounds.set(SoundType.GUNSHOT, this.createNoiseBurst(0.15, 800, 0.8));
    // 换弹：两个短促点击
    this.sounds.set(SoundType.RELOAD, this.createClickSound(0.3, 200));
    // 脚步：低频短噪声
    this.sounds.set(SoundType.FOOTSTEP, this.createNoiseBurst(0.05, 150, 0.3));
    // 爆炸：长噪声 + 低频
    this.sounds.set(SoundType.EXPLOSION, this.createNoiseBurst(0.8, 200, 1.0));
    // 命中：中频短音
    this.sounds.set(SoundType.HIT, this.createTone(0.08, 600, 0.5));
    // 死亡：下降音调
    this.sounds.set(SoundType.DEATH, this.createSweepTone(0.5, 400, 80, 0.7));
    // 环境音：低频持续噪声
    this.sounds.set(SoundType.AMBIENT, this.createAmbient());
    // UI 点击
    this.sounds.set(SoundType.UI_CLICK, this.createTone(0.05, 800, 0.4));
    // UI 悬停
    this.sounds.set(SoundType.UI_HOVER, this.createTone(0.03, 1200, 0.2));
  }

  private createNoiseBurst(duration: number, filterFreq: number, volume: number): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const envelope = Math.pow(1 - i / length, 2);
      data[i] = (Math.random() * 2 - 1) * envelope * volume;
    }

    return buffer;
  }

  private createTone(duration: number, freq: number, volume: number): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.pow(1 - i / length, 1.5);
      data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * volume;
    }

    return buffer;
  }

  private createSweepTone(duration: number, startFreq: number, endFreq: number, volume: number): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const progress = i / length;
      const freq = startFreq + (endFreq - startFreq) * progress;
      const envelope = Math.pow(1 - progress, 1.5);
      data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * volume;
    }

    return buffer;
  }

  private createClickSound(duration: number, freq: number): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.pow(1 - i / length, 3);
      // 两个点击声
      let sample = 0;
      if (i < length * 0.3) {
        sample = Math.sin(2 * Math.PI * freq * t) * envelope;
      } else if (i > length * 0.4 && i < length * 0.7) {
        sample = Math.sin(2 * Math.PI * freq * 1.2 * t) * envelope * 0.8;
      }
      data[i] = sample * 0.5;
    }

    return buffer;
  }

  private createAmbient(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 3;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.05;
    }

    return buffer;
  }

  play(type: SoundType, position?: { x: number; y: number; z: number }): string | null {
    if (!this.audioContext || this.isMuted) return null;

    const buffer = this.sounds.get(type);
    if (!buffer) return null;

    const config = SOUND_CONFIGS[type];
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = config.loop;

    // 每枪随机化音高，避免机械重复感
    if (type === SoundType.GUNSHOT) {
      source.detune.value = (Math.random() - 0.5) * 300;
    }

    const gainNode = this.audioContext.createGain();
    // 枪声/命中音加随机音量，增强打击感
    const volumeRand = (type === SoundType.GUNSHOT || type === SoundType.HIT)
      ? 0.85 + Math.random() * 0.3
      : 1;
    gainNode.gain.value = config.volume * this.masterVolume * volumeRand;

    if (config.spatial && position) {
      const panner = this.createPanner(config, position);
      source.connect(panner);
      panner.connect(gainNode);
    } else {
      source.connect(gainNode);
    }

    gainNode.connect(this.audioContext.destination);

    const id = `${type}_${Date.now()}_${Math.random()}`;
    this.activeSources.set(id, source);

    source.onended = () => {
      this.activeSources.delete(id);
    };

    source.start();
    return id;
  }

  private createPanner(config: SoundConfig, position: { x: number; y: number; z: number }): PannerNode {
    const panner = this.audioContext!.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.maxDistance = config.maxDistance;
    panner.rolloffFactor = config.rolloffFactor;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;

    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    return panner;
  }

  updateListener(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): void {
    if (!this.audioContext) return;

    this.listenerPosition = position;
    this.listenerOrientation = { forward, up };

    const listener = this.audioContext.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
  }

  stop(id: string): void {
    const source = this.activeSources.get(id);
    if (source) {
      source.stop();
      this.activeSources.delete(id);
    }
  }

  stopAll(): void {
    for (const [id, source] of this.activeSources) {
      source.stop();
    }
    this.activeSources.clear();
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.masterVolume;
  }

  mute(): void {
    this.isMuted = true;
    this.stopAll();
  }

  unmute(): void {
    this.isMuted = false;
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopAll();
    }
    return this.isMuted;
  }

  isSoundLoaded(type: SoundType): boolean {
    return this.sounds.has(type);
  }

  dispose(): void {
    this.stopAll();
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.sounds.clear();
  }
}
