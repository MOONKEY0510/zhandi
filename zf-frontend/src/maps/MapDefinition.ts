import * as THREE from 'three';

export interface MapObjectDefinition {
  id: string;
  kind: 'ground' | 'building' | 'rubble' | 'road' | 'cover';
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  rotationY?: number;
  render: boolean;
  collision: boolean;
  navigation: 'walkable' | 'blocked' | 'cover';
  soundZone: 'outdoor' | 'indoor' | 'street';
  instanceGroup?: string;
}

export interface MapDefinition {
  id: string;
  version: string;
  size: number;
  objects: readonly MapObjectDefinition[];
}

export interface BuiltMapData {
  root: THREE.Group;
  collisionObjects: THREE.Object3D[];
  navigationObjects: MapObjectDefinition[];
  soundZones: MapObjectDefinition[];
}

export function buildMapFromDefinition(definition: MapDefinition): BuiltMapData {
  const root = new THREE.Group();
  root.name = definition.id;
  const collisionObjects: THREE.Object3D[] = [];
  const navigationObjects: MapObjectDefinition[] = [];
  const soundZones: MapObjectDefinition[] = [];
  const instanceGroups = new Map<string, MapObjectDefinition[]>();

  for (const object of definition.objects) {
    if (object.instanceGroup) {
      const group = instanceGroups.get(object.instanceGroup) ?? [];
      group.push(object);
      instanceGroups.set(object.instanceGroup, group);
    } else if (object.render) {
      root.add(createMesh(object));
    }
    if (object.collision) collisionObjects.push(createCollisionProxy(object));
    navigationObjects.push(object);
    soundZones.push(object);
  }

  for (const [groupId, objects] of instanceGroups) {
    if (objects.length === 0) continue;
    const first = objects[0];
    const geometry = new THREE.BoxGeometry(...first.size);
    const material = new THREE.MeshStandardMaterial({ color: colorForKind(first.kind), roughness: 0.9 });
    const instances = new THREE.InstancedMesh(geometry, material, objects.length);
    instances.name = `instances:${groupId}`;
    const matrix = new THREE.Matrix4();
    objects.forEach((object, index) => {
      matrix.compose(
        new THREE.Vector3(...object.position),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), object.rotationY ?? 0),
        new THREE.Vector3(1, 1, 1),
      );
      instances.setMatrixAt(index, matrix);
    });
    root.add(instances);
  }

  return { root, collisionObjects, navigationObjects, soundZones };
}

function createMesh(object: MapObjectDefinition): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...object.size),
    new THREE.MeshStandardMaterial({ color: colorForKind(object.kind), roughness: 0.85 }),
  );
  mesh.name = object.id;
  mesh.position.set(...object.position);
  mesh.rotation.y = object.rotationY ?? 0;
  mesh.castShadow = object.kind !== 'ground';
  mesh.receiveShadow = true;
  return mesh;
}

function createCollisionProxy(object: MapObjectDefinition): THREE.Mesh {
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(...object.size), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.name = `collision:${object.id}`;
  proxy.position.set(...object.position);
  proxy.rotation.y = object.rotationY ?? 0;
  proxy.userData.mapObjectId = object.id;
  return proxy;
}

function colorForKind(kind: MapObjectDefinition['kind']): number {
  return { ground: 0x555555, building: 0x4a4a4a, rubble: 0x5a5148, road: 0x333333, cover: 0x675947 }[kind];
}
