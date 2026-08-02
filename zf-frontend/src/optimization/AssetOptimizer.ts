import * as THREE from 'three';

export class AssetOptimizer {
  private mergedGeometries: Map<string, THREE.BufferGeometry> = new Map();

  optimizeScene(scene: THREE.Group): void {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.optimizeMesh(object);
      }
    });
  }

  private optimizeMesh(mesh: THREE.Mesh): void {
    if (mesh.geometry) {
      mesh.geometry.computeVertexNormals();
      mesh.geometry.center();
      mesh.geometry.computeBoundingBox();
    }

    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => this.optimizeMaterial(mat));
      } else {
        this.optimizeMaterial(mesh.material);
      }
    }
  }

  private optimizeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.needsUpdate = true;
    }
  }

  optimizeTextures(textures: THREE.Texture[]): void {
    for (const texture of textures) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
  }

  optimizeMaterials(materials: THREE.Material[]): void {
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = Math.round(material.metalness * 10) / 10;
        material.roughness = Math.round(material.roughness * 10) / 10;
      }
    }
  }

  dispose(): void {
    for (const geometry of this.mergedGeometries.values()) {
      geometry.dispose();
    }
    this.mergedGeometries.clear();
  }
}
