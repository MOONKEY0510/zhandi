import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TeamId } from '../game/ConquestMode';
import { MineSystem } from './MineSystem';

function createSystem(maxPerTeam = 3) {
  const scene = new THREE.Scene();
  const system = new MineSystem(scene, { maxPerTeam });
  return { scene, system };
}

describe('MineSystem（阶段 7 P1 反坦克地雷）', () => {
  it('放置：成功放置并生成视觉对象', () => {
    const { scene, system } = createSystem();
    const mine = system.place(new THREE.Vector3(5, 0, 5), TeamId.ALLIES);
    expect(mine).not.toBeNull();
    expect(system.getActiveCount(TeamId.ALLIES)).toBe(1);
    expect(scene.children).toContain(mine!.mesh);
  });

  it('放置：每队上限控制', () => {
    const { system } = createSystem(2);
    system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES);
    system.place(new THREE.Vector3(1, 0, 0), TeamId.ALLIES);
    expect(system.place(new THREE.Vector3(2, 0, 0), TeamId.ALLIES)).toBeNull();
    // 另一队独立计数
    expect(system.place(new THREE.Vector3(3, 0, 0), TeamId.AXIS)).not.toBeNull();
    expect(system.getActiveCount(TeamId.ALLIES)).toBe(2);
    expect(system.getActiveCount(TeamId.AXIS)).toBe(1);
  });

  it('触发：敌方载具进入触发半径即爆炸', () => {
    const { system } = createSystem();
    const mine = system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES)!;
    let triggered: string | null = null;
    system.onTrigger = (m, target) => {
      triggered = m.id === mine.id ? target.team : null;
    };
    system.update(0.016, [
      { position: new THREE.Vector3(1, 0, 0), alive: true, team: TeamId.AXIS },
    ]);
    expect(triggered).toBe(TeamId.AXIS);
    expect(mine.triggered).toBe(true);
  });

  it('触发：同阵营载具不触发', () => {
    const { system } = createSystem();
    system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES);
    let triggered = false;
    system.onTrigger = () => { triggered = true; };
    system.update(0.016, [
      { position: new THREE.Vector3(0.5, 0, 0), alive: true, team: TeamId.ALLIES },
    ]);
    expect(triggered).toBe(false);
  });

  it('触发：超出触发半径不触发', () => {
    const { system } = createSystem();
    system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES);
    let triggered = false;
    system.onTrigger = () => { triggered = true; };
    system.update(0.016, [
      { position: new THREE.Vector3(10, 0, 0), alive: true, team: TeamId.AXIS },
    ]);
    expect(triggered).toBe(false);
  });

  it('触发：已摧毁的载具不触发', () => {
    const { system } = createSystem();
    system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES);
    let triggered = false;
    system.onTrigger = () => { triggered = true; };
    system.update(0.016, [
      { position: new THREE.Vector3(0.5, 0, 0), alive: false, team: TeamId.AXIS },
    ]);
    expect(triggered).toBe(false);
  });

  it('remove：触发后移除并释放资源', () => {
    const { scene, system } = createSystem();
    const mine = system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES)!;
    system.remove(mine);
    expect(system.getActiveCount(TeamId.ALLIES)).toBe(0);
    expect(scene.children).not.toContain(mine.mesh);
  });

  it('dispose：清空所有地雷', () => {
    const { system } = createSystem();
    system.place(new THREE.Vector3(0, 0, 0), TeamId.ALLIES);
    system.place(new THREE.Vector3(2, 0, 0), TeamId.AXIS);
    system.dispose();
    expect(system.getMines().length).toBe(0);
  });
});
