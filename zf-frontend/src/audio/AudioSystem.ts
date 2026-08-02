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
      await this.loadSounds();
    } catch (error) {
      console.warn('Audio initialization failed:', error);
    }
  }

  async loadSounds(): Promise<void> {
    const promises = Object.values(SOUND_CONFIGS).map(async (config) => {
      try {
        const response = await fetch(config.url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
        this.sounds.set(config.type, audioBuffer);
      } catch (error) {
        console.warn(`Failed to load sound: ${config.url}`, error);
      }
    });

    await Promise.all(promises);
  }

  play(type: SoundType, position?: { x: number; y: number; z: number }): string | null {
    if (!this.audioContext || this.isMuted) return null;

    const buffer = this.sounds.get(type);
    if (!buffer) return null;

    const config = SOUND_CONFIGS[type];
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = config.loop;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = config.volume * this.masterVolume;

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
