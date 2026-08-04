import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface AssetLoaderOptions {
  dracoDecoderPath?: string;
  ktx2TranscoderPath?: string;
  renderer?: THREE.WebGLRenderer;
}

export interface AssetLoaderStats {
  cachedAssets: number;
  pendingAssets: number;
  loadedAssets: number;
  failedAssets: number;
}

export class AssetLoader {
  private readonly textureLoader: THREE.TextureLoader;
  private readonly gltfLoader: GLTFLoader;
  private readonly ktx2Loader: KTX2Loader | null;
  private readonly cache = new Map<string, THREE.Texture | GLTF>();
  private readonly pending = new Map<string, Promise<THREE.Texture | GLTF>>();
  private loadedAssets = 0;
  private failedAssets = 0;

  constructor(options: AssetLoaderOptions = {}) {
    const manager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(manager);
    this.gltfLoader = new GLTFLoader(manager);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    if (options.dracoDecoderPath) {
      const draco = new DRACOLoader(manager).setDecoderPath(options.dracoDecoderPath);
      this.gltfLoader.setDRACOLoader(draco);
    }

    if (options.ktx2TranscoderPath && options.renderer) {
      this.ktx2Loader = new KTX2Loader(manager)
        .setTranscoderPath(options.ktx2TranscoderPath)
        .detectSupport(options.renderer);
      this.gltfLoader.setKTX2Loader(this.ktx2Loader);
    } else {
      this.ktx2Loader = null;
    }
  }

  async loadTexture(url: string): Promise<THREE.Texture> {
    return this.loadCached(url, () => this.textureLoader.loadAsync(url)) as Promise<THREE.Texture>;
  }

  async loadModel(url: string): Promise<GLTF> {
    try {
      return (await this.loadCached(url, () => this.gltfLoader.loadAsync(url))) as GLTF;
    } catch {
      return this.createPlaceholderModel(url);
    }
  }

  async preloadModels(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.loadModel(url)));
  }

  async preloadTextures(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.loadTexture(url)));
  }

  getStats(): AssetLoaderStats {
    return {
      cachedAssets: this.cache.size,
      pendingAssets: this.pending.size,
      loadedAssets: this.loadedAssets,
      failedAssets: this.failedAssets,
    };
  }

  dispose(): void {
    for (const asset of this.cache.values()) this.disposeAsset(asset);
    this.cache.clear();
    this.pending.clear();
    this.ktx2Loader?.dispose();
  }

  private loadCached(
    url: string,
    load: () => Promise<THREE.Texture | GLTF>,
  ): Promise<THREE.Texture | GLTF> {
    const cached = this.cache.get(url);
    if (cached) return Promise.resolve(this.cloneAsset(cached));
    const existing = this.pending.get(url);
    if (existing) return existing.then((asset) => this.cloneAsset(asset));

    const request = load()
      .then((asset) => {
        this.cache.set(url, asset);
        this.loadedAssets++;
        return asset;
      })
      .catch((error) => {
        this.failedAssets++;
        throw error;
      })
      .finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request.then((asset) => this.cloneAsset(asset));
  }

  private createPlaceholderModel(url: string): GLTF {
    const scene = new THREE.Group();
    scene.name = `placeholder:${url}`;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff00ff, wireframe: true }),
    );
    mesh.userData.placeholder = true;
    scene.add(mesh);
    return { scene, scenes: [scene], animations: [], cameras: [], asset: { version: '2.0', generator: 'fallback' }, parser: null as never, userData: {} };
  }

  private cloneAsset(asset: THREE.Texture | GLTF): THREE.Texture | GLTF {
    if (asset instanceof THREE.Texture) return asset.clone();
    return { ...asset, scene: asset.scene.clone(true), scenes: asset.scenes.map((scene) => scene.clone(true)) };
  }

  private disposeAsset(asset: THREE.Texture | GLTF): void {
    if (asset instanceof THREE.Texture) {
      asset.dispose();
      return;
    }
    asset.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
