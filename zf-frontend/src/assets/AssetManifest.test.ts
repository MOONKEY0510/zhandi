import { describe, expect, it } from 'vitest';
import { AssetLoadStage, AssetManifest, AssetType } from './AssetManifest';

const entries = [
  {
    id: 'ui.logo',
    version: '1',
    type: AssetType.TEXTURE,
    url: '/ui/logo.ktx2',
    stage: AssetLoadStage.MENU,
    license: 'project-original',
    budgetBytes: 100_000,
  },
  {
    id: 'weapon.stg44',
    version: '1',
    type: AssetType.MODEL,
    url: '/models/stg44.glb',
    stage: AssetLoadStage.PLAYER_WEAPON,
    collisionProxy: '/models/stg44.collider.glb',
    license: 'project-original',
    budgetBytes: 2_000_000,
  },
] as const;

describe('AssetManifest', () => {
  it('indexes assets by stable id and load stage', () => {
    const manifest = new AssetManifest(entries);

    expect(manifest.get('weapon.stg44').type).toBe(AssetType.MODEL);
    expect(manifest.getStage(AssetLoadStage.MENU).map((entry) => entry.id)).toEqual(['ui.logo']);
    expect(manifest.getBudget()).toBe(2_100_000);
  });

  it('rejects duplicate ids and invalid budgets', () => {
    const manifest = new AssetManifest(entries);
    expect(() => manifest.add(entries[0])).toThrow('Duplicate asset id');
    expect(() => manifest.add({ ...entries[0], id: 'bad', budgetBytes: 0 })).toThrow('budget must be positive');
  });
});
