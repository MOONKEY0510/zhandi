import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DestructibleSystem, DestructibleKind } from './DestructibleSystem';

function createSystem() {
  const scene = new THREE.Scene();
  return { scene, system: new DestructibleSystem(scene) };
}

describe('DestructibleSystem', () => {
  it('创建对象后处于完整状态，可被伤害直至摧毁', () => {
    const { system } = createSystem();
    const obj = system.create(DestructibleKind.DOOR, new THREE.Vector3(0, 0, 0));

    expect(obj.destroyed).toBe(false);
    expect(obj.mesh.visible).toBe(true);
    expect(obj.brokenGroup.visible).toBe(false);

    const destroyed = system.damage(obj.id, 30);
    expect(destroyed).toBe(false);
    expect(obj.destroyed).toBe(false);

    const destroyed2 = system.damage(obj.id, 30);
    expect(destroyed2).toBe(true);
    expect(obj.destroyed).toBe(true);
    expect(obj.mesh.visible).toBe(false);
    expect(obj.brokenGroup.visible).toBe(true);
  });

  it('摧毁后触发 onDestroy 回调（接入层移出碰撞/视线）', () => {
    const { system } = createSystem();
    const obj = system.create(DestructibleKind.SANDBAG, new THREE.Vector3(5, 0, 5));
    const onDestroy = vi.fn();
    system.onDestroy = onDestroy;

    system.damage(obj.id, 999);
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledWith(obj);
  });

  it('已摧毁对象不再受击、不重复回调', () => {
    const { system } = createSystem();
    const obj = system.create(DestructibleKind.COVER, new THREE.Vector3(0, 0, 0));
    const onDestroy = vi.fn();
    system.onDestroy = onDestroy;

    system.destroy(obj.id);
    system.destroy(obj.id);
    system.damage(obj.id, 10);

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(system.getDestroyedCount()).toBe(1);
  });

  it('bitset 往返：摧毁后 getStateBitset 置位，applyStateBitset 恢复', () => {
    const { system } = createSystem();
    const a = system.create(DestructibleKind.DOOR, new THREE.Vector3(0, 0, 0));
    const b = system.create(DestructibleKind.FENCE, new THREE.Vector3(3, 0, 0));
    const c = system.create(DestructibleKind.SANDBAG, new THREE.Vector3(6, 0, 0));

    expect(system.getStateBitset()).toBe('000');

    system.destroy(a.id);
    system.destroy(c.id);
    expect(system.getStateBitset()).toBe('101');

    // 新系统用同一 bitset 恢复（对象顺序一致）
    const { system: system2 } = createSystem();
    system2.create(DestructibleKind.DOOR, new THREE.Vector3(0, 0, 0));
    system2.create(DestructibleKind.FENCE, new THREE.Vector3(3, 0, 0));
    system2.create(DestructibleKind.SANDBAG, new THREE.Vector3(6, 0, 0));
    system2.applyStateBitset('101');

    expect(system2.getById(a.id)!.destroyed).toBe(true);
    expect(system2.getById(b.id)!.destroyed).toBe(false);
    expect(system2.getById(c.id)!.destroyed).toBe(true);
    expect(system2.getDestroyedCount()).toBe(2);
  });

  it('update 推进碎片生命周期并回收，不泄漏场景对象', () => {
    const { scene, system } = createSystem();
    const obj = system.create(DestructibleKind.FENCE, new THREE.Vector3(0, 0, 0));
    system.destroy(obj.id);

    // 碎片已加入场景
    const debrisBefore = scene.children.filter((c) => c instanceof THREE.Mesh).length;
    expect(debrisBefore).toBeGreaterThan(0);

    // 模拟足够时间让碎片过期
    for (let i = 0; i < 30; i++) system.update(0.1);
    const debrisAfter = scene.children.filter((c) => c instanceof THREE.Mesh).length;
    expect(debrisAfter).toBe(0);
  });

  it('dispose 清空对象与场景引用', () => {
    const { scene, system } = createSystem();
    system.create(DestructibleKind.COVER, new THREE.Vector3(0, 0, 0));
    system.create(DestructibleKind.SANDBAG, new THREE.Vector3(4, 0, 0));

    system.dispose();
    expect(system.getAll().length).toBe(0);
    expect(scene.children.length).toBe(0);
  });
});
