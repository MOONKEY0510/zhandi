export enum AssetType {
  MODEL = 'model',
  TEXTURE = 'texture',
  AUDIO = 'audio',
}

export enum AssetLoadStage {
  MENU = 'menu',
  PLAYER_WEAPON = 'player_weapon',
  NEAR_MAP = 'near_map',
  FAR_DETAIL = 'far_detail',
}

export interface AssetManifestEntry {
  id: string;
  version: string;
  type: AssetType;
  url: string;
  stage: AssetLoadStage;
  lod?: readonly { distance: number; url: string }[];
  collisionProxy?: string;
  license: string;
  budgetBytes: number;
}

export class AssetManifest {
  private readonly entries = new Map<string, AssetManifestEntry>();

  constructor(entries: readonly AssetManifestEntry[] = []) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: AssetManifestEntry): void {
    if (!entry.id.trim()) throw new Error('Asset id is required');
    if (this.entries.has(entry.id)) throw new Error(`Duplicate asset id: ${entry.id}`);
    if (entry.budgetBytes <= 0) throw new Error(`Asset budget must be positive: ${entry.id}`);
    this.entries.set(entry.id, Object.freeze({ ...entry }));
  }

  get(id: string): AssetManifestEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown asset: ${id}`);
    return entry;
  }

  getStage(stage: AssetLoadStage): AssetManifestEntry[] {
    return [...this.entries.values()].filter((entry) => entry.stage === stage);
  }

  getBudget(stage?: AssetLoadStage): number {
    const entries = stage ? this.getStage(stage) : [...this.entries.values()];
    return entries.reduce((total, entry) => total + entry.budgetBytes, 0);
  }

  list(): AssetManifestEntry[] {
    return [...this.entries.values()];
  }
}
