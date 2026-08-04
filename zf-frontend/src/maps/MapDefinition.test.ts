import { describe, expect, it } from 'vitest';
import { buildMapFromDefinition, type MapDefinition } from './MapDefinition';

const definition: MapDefinition = {
  id: 'test-map',
  version: '1',
  size: 100,
  objects: [
    { id: 'ground', kind: 'ground', position: [0, -0.5, 0], size: [100, 1, 100], render: true, collision: true, navigation: 'walkable', soundZone: 'outdoor' },
    { id: 'rubble-1', kind: 'rubble', position: [1, 0.5, 0], size: [1, 1, 1], render: true, collision: false, navigation: 'cover', soundZone: 'street', instanceGroup: 'rubble' },
    { id: 'rubble-2', kind: 'rubble', position: [2, 0.5, 0], size: [1, 1, 1], render: true, collision: false, navigation: 'cover', soundZone: 'street', instanceGroup: 'rubble' },
  ],
};

describe('MapDefinition', () => {
  it('builds render, collision, navigation and sound data from one source', () => {
    const built = buildMapFromDefinition(definition);

    expect(built.root.getObjectByName('ground')).toBeTruthy();
    expect(built.root.getObjectByName('instances:rubble')).toBeTruthy();
    expect(built.collisionObjects.map((object) => object.userData.mapObjectId)).toEqual(['ground']);
    expect(built.navigationObjects).toHaveLength(3);
    expect(built.soundZones).toHaveLength(3);
  });

  it('creates exactly the declared number of instances', () => {
    const instances = buildMapFromDefinition(definition).root.getObjectByName('instances:rubble');
    expect(instances?.type).toBe('Mesh');
    expect((instances as import('three').InstancedMesh).count).toBe(2);
  });
});
