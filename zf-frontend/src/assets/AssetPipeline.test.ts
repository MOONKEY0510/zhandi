import { describe, expect, it, vi } from 'vitest';
import { AssetLoadStage, AssetManifest, AssetType } from './AssetManifest';
import { AssetPipeline } from './AssetPipeline';
import type { AssetLoader } from './AssetLoader';

function createManifest(): AssetManifest {
  return new AssetManifest([
    { id: 'menu', version: '1', type: AssetType.TEXTURE, url: '/menu.png', stage: AssetLoadStage.MENU, license: 'original', budgetBytes: 10 },
    { id: 'player', version: '1', type: AssetType.MODEL, url: '/player.glb', stage: AssetLoadStage.PLAYER_WEAPON, license: 'original', budgetBytes: 20 },
  ]);
}

describe('AssetPipeline', () => {
  it('loads each manifest stage exactly once', async () => {
    const loader = {
      loadTexture: vi.fn().mockResolvedValue({}),
      loadModel: vi.fn().mockResolvedValue({}),
      getStats: vi.fn().mockReturnValue({ cachedAssets: 1, pendingAssets: 0, loadedAssets: 1, failedAssets: 0 }),
      dispose: vi.fn(),
    } as unknown as AssetLoader;
    const pipeline = new AssetPipeline(createManifest(), loader);

    const first = await pipeline.loadStage(AssetLoadStage.MENU);
    const second = await pipeline.loadStage(AssetLoadStage.MENU);

    expect(first.loadedIds).toEqual(['menu']);
    expect(second.loadedIds).toEqual([]);
    expect(loader.loadTexture).toHaveBeenCalledOnce();
    expect(pipeline.isLoaded('menu')).toBe(true);
  });
});
