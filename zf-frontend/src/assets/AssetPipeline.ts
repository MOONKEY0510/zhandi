import { AssetLoader, type AssetLoaderStats } from './AssetLoader';
import { AssetLoadStage, AssetManifest, AssetType, type AssetManifestEntry } from './AssetManifest';

export interface AssetStageResult {
  stage: AssetLoadStage;
  loadedIds: string[];
  budgetBytes: number;
  stats: AssetLoaderStats;
}

export class AssetPipeline {
  private readonly loadedIds = new Set<string>();

  constructor(
    private readonly manifest: AssetManifest,
    private readonly loader = new AssetLoader(),
  ) {}

  async loadStage(stage: AssetLoadStage): Promise<AssetStageResult> {
    const entries = this.manifest.getStage(stage).filter((entry) => !this.loadedIds.has(entry.id));
    await Promise.all(entries.map((entry) => this.loadEntry(entry)));
    entries.forEach((entry) => this.loadedIds.add(entry.id));
    return {
      stage,
      loadedIds: entries.map((entry) => entry.id),
      budgetBytes: this.manifest.getBudget(stage),
      stats: this.loader.getStats(),
    };
  }

  isLoaded(id: string): boolean {
    return this.loadedIds.has(id);
  }

  getLoader(): AssetLoader {
    return this.loader;
  }

  dispose(): void {
    this.loader.dispose();
    this.loadedIds.clear();
  }

  private async loadEntry(entry: AssetManifestEntry): Promise<void> {
    if (entry.type === AssetType.MODEL) {
      await this.loader.loadModel(entry.url);
      return;
    }
    if (entry.type === AssetType.TEXTURE) {
      await this.loader.loadTexture(entry.url);
      return;
    }
    // 音频由阶段6的音频管线消费，阶段5只保留清单和预算。
  }
}
