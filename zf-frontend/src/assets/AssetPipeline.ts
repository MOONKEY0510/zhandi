import { AssetLoader } from './AssetLoader';

export interface AssetConfig {
  models: string[];
  textures: string[];
  sounds: string[];
}

export class AssetPipeline {
  private loader: AssetLoader;
  private config: AssetConfig;

  constructor(config: AssetConfig) {
    this.loader = new AssetLoader();
    this.config = config;
  }

  async loadLevel(levelName: string): Promise<void> {
    console.log(`Loading level: ${levelName}`);

    const levelAssets = this.getLevelAssets(levelName);
    await this.loader.preload(levelAssets);

    console.log(`Level ${levelName} loaded. Cache size: ${this.loader.getCacheSize()}`);
  }

  private getLevelAssets(levelName: string): string[] {
    const assets: string[] = [];

    switch (levelName) {
      case 'test':
        assets.push(...this.config.models.slice(0, 5));
        assets.push(...this.config.textures.slice(0, 5));
        break;
      default:
        assets.push(...this.config.models);
        assets.push(...this.config.textures);
    }

    return assets;
  }

  getLoader(): AssetLoader {
    return this.loader;
  }

  dispose(): void {
    this.loader.dispose();
  }
}
