import * as THREE from 'three';

export class AssetLoader {
  private textureLoader: THREE.TextureLoader;
  private loadingManager: THREE.LoadingManager;
  private cache: Map<string, unknown> = new Map();

  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
  }

  async loadTexture(url: string): Promise<THREE.Texture> {
    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (cached instanceof THREE.Texture) {
        return cached.clone();
      }
    }

    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          this.cache.set(url, texture);
          resolve(texture);
        },
        undefined,
        (error) => reject(error)
      );
    });
  }

  preload(urls: string[]): Promise<void> {
    const promises = urls.map(url => {
      return this.loadTexture(url);
    });

    return Promise.all(promises).then(() => undefined);
  }

  dispose(): void {
    for (const [_url, asset] of this.cache) {
      if (asset instanceof THREE.Texture) {
        asset.dispose();
      } else if (asset instanceof THREE.Group) {
        asset.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    }
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}
