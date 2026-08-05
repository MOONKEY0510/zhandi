/**
 * 服务端权威战斗闭环端到端（阶段 8 第十七批：死亡/重生/击杀反馈/回合重启）。
 * 本地起 ServerApp，真实 WebSocket 双客户端：
 *   - 击杀反馈：队 0 瞄准队 1 连射 → 服务端裁决死亡 → kill_feed 广播（击杀者/受害者/武器名）；
 *   - 自动重生：死亡后经 RESPAWN_DELAY_MS 在队伍出生点复活（快照 alive 翻转 + 位置复位）；
 *   - 回合重启：兵力打空 → winner + phase=ended → 经 ROUND_RESTART_DELAY_MS 自动开新回合
 *     （征服/载具重置、全员复活、room_state/game_state 广播 phase=started）。
 * 真实定时器（不 mock）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { ServerApp } from './ServerApp.ts';
import { NetClient, type RawTransport, type NetClientOptions } from '../src/network/NetClient.ts';
import {
  RESPAWN_DELAY_MS,
  ROUND_RESTART_DELAY_MS,
  DESTRUCTIBLE_SPAWN_DEFS,
  type JoinAck,
  type KillFeedMsg,
  type ServerGameState,
  type DestructibleStateMsg,
} from '../shared/protocol.ts';

/** Node（ws 包）传输：实现 RawTransport（与 GameState.test 同构） */
class NodeTransport implements RawTransport {
  private ws: WebSocket;
  private msgCb: ((bytes: Uint8Array) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (event) => {
      this.msgCb?.(new Uint8Array(event.data as ArrayBuffer));
    };
    this.ws.onclose = () => this.closeCb?.('closed');
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === this.ws.OPEN) {
        resolve();
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket 连接失败'));
    });
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(bytes);
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.ws.close();
  }
}

const IDLE_INPUT = {
  moveForward: false,
  moveBackward: false,
  moveLeft: false,
  moveRight: false,
  sprint: false,
  fire: false,
  aimYaw: 0,
  aimPitch: 0,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询直到谓词成立（带超时） */
async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function spawnOf(team: 0 | 1): { x: number; z: number } {
  return team === 0 ? { x: -20, z: -20 } : { x: 20, z: 20 };
}

describe('服务端权威战斗闭环（阶段 8 第十七批：死亡/重生/击杀反馈/回合重启）', () => {
  let server: ServerApp;
  let url: string;
  const clients: NetClient[] = [];

  beforeAll(async () => {
    server = new ServerApp({ port: 0, defaultRoomId: 'combat', staticLayout: [] });
    const port = await server.start();
    url = `ws://127.0.0.1:${port}`;
  }, 10000);

  afterAll(() => {
    for (const client of clients) client.disconnect();
    server.stop();
  });

  function makeClient(playerId: string, options: NetClientOptions = {}): NetClient {
    const client = new NetClient(url, playerId, `玩家${playerId}`, {
      pingIntervalMs: 100,
      maxReconnects: 0,
      ...options,
      transportFactory: options.transportFactory ?? (() => new NodeTransport(url)),
    });
    clients.push(client);
    return client;
  }

  function waitJoinAck(client: NetClient): Promise<JoinAck> {
    return new Promise((resolve) => {
      client.onJoinAck = (ack) => resolve(ack);
    });
  }

  it('击杀反馈 + 自动重生：kill_feed 广播、死亡 alive 翻转、到期队伍出生点复活', async () => {
    const a = makeClient('ca1');
    const b = makeClient('cb1');
    const feeds: KillFeedMsg[] = [];
    a.onKillFeed = (f) => feeds.push(f);
    b.onKillFeed = (f) => feeds.push(f);

    await a.connect();
    await b.connect();
    const ackAPromise = waitJoinAck(a);
    const ackBPromise = waitJoinAck(b);
    a.joinRoom('combat');
    b.joinRoom('combat');
    const [ackA, ackB] = await Promise.all([ackAPromise, ackBPromise]);
    expect(ackA.team).not.toBe(ackB.team); // 平衡分配：不同队

    const shooterIsA = ackA.team === 0;
    const shooter = shooterIsA ? a : b;
    const target = shooterIsA ? b : a;
    const shooterId = shooterIsA ? ackA.playerId : ackB.playerId;
    const targetId = shooterIsA ? ackB.playerId : ackA.playerId;
    const shooterTeam = shooterIsA ? ackA.team : ackB.team;
    const targetTeam = shooterIsA ? ackB.team : ackA.team;

    const sx = spawnOf(shooterTeam).x;
    const sz = sx;
    const tx = spawnOf(targetTeam).x;
    const tz = tx;

    // target 本人快照跟踪：死亡翻转（停火条件）+ 重生断言（alive/位置复位到队伍出生点）
    let tAlive = true;
    let tX = 0;
    let tZ = 0;
    let targetDead = false;
    target.onSnapshot = (players) => {
      const me = players.get(targetId);
      if (!me) return;
      tAlive = me.alive;
      tX = me.x;
      tZ = me.z;
      if (!me.alive) targetDead = true;
    };

    // target 沿 -z 走位 2.8s（≈14.6m）→ 弹道不经过敌方载具（v1/v2 对角线挡弹问题）
    const walkStart = performance.now();
    while (performance.now() - walkStart < 2800) {
      target.sendInput({ ...IDLE_INPUT, moveForward: true });
      await sleep(30);
    }
    await sleep(200);
    const nt = { x: tx, z: tz - 2.8 * 5.2 };
    const ndx = nt.x - sx;
    const ndz = nt.z - sz;
    const ndist = Math.hypot(ndx, ndz);
    // 服务端 forward = (sin(yaw), -cos(yaw))；pitch 下压使弹道在目标躯干高度穿过
    const yaw = Math.atan2(ndx, -ndz);
    const pitch = Math.asin((0.5 - 1.6) / ndist);

    // 连射直到观察到 target 死亡（快照 alive=false），上限 8s
    const fireStart = performance.now();
    while (performance.now() - fireStart < 8000 && !targetDead) {
      shooter.sendInput({ ...IDLE_INPUT, fire: true, aimYaw: yaw, aimPitch: pitch });
      await sleep(30);
    }
    expect(targetDead).toBe(true);

    // kill_feed：双方客户端都收到（击杀者/受害者/武器名服务端权威）
    await waitFor(() => feeds.some((f) => f.victimId === targetId), 2000);
    const feed = feeds.find((f) => f.victimId === targetId);
    expect(feed).toBeDefined();
    expect(feed!.killerId).toBe(shooterId);
    expect(feed!.killerName).toBe(`玩家${shooterId}`);
    expect(feed!.victimName).toBe(`玩家${targetId}`);
    expect(feed!.weaponLabel).toBe('步枪');

    // 自动重生：死亡后 RESPAWN_DELAY_MS 内复活，位置收敛回队伍出生点
    // （快照插值跨「死亡冻结帧 → 重生帧」有短暂过渡，轮询位置而非立即断言）
    const respawned = await waitFor(() => tAlive === true, RESPAWN_DELAY_MS + 4000);
    expect(respawned).toBe(true);
    const atSpawn = await waitFor(() => Math.abs(tX - tx) < 8 && Math.abs(tZ - tz) < 8, 3000);
    expect(atSpawn).toBe(true);
  }, 30000);

  it('回合结束自动重启：winner + ended → 结算期 → 新回合（重置兵力/全员复活）', async () => {
    const roomId = 'combat2';
    const a = makeClient('ca2');
    const b = makeClient('cb2');
    const states: ServerGameState[] = [];
    a.onGameState = (s) => states.push(s);
    b.onGameState = (s) => states.push(s);

    await a.connect();
    await b.connect();
    const ackAPromise = waitJoinAck(a);
    const ackBPromise = waitJoinAck(b);
    a.joinRoom(roomId);
    b.joinRoom(roomId);
    await ackAPromise;
    const ackB = await ackBPromise;
    const bSpawn = spawnOf(ackB.team);

    // B 快照跟踪：回合重启后全员复活在队伍出生点
    let bAlive = true;
    let bNearSpawn = false;
    b.onSnapshot = (players) => {
      const me = players.get('cb2');
      if (!me) return;
      bAlive = me.alive;
      if (Math.abs(me.x - bSpawn.x) < 8 && Math.abs(me.z - bSpawn.z) < 8) bNearSpawn = true;
    };
    // 等首轮 game_state 到位
    await sleep(900);

    // 直接打空队 0 兵力 → 服务端胜负判定（验收不需要真实击杀路径，规则推进是权威的）
    const room = server.roomManager.getRoom(roomId)!;
    expect(room.conquest).not.toBeNull();
    room.conquest!.tickets = [0, 50];

    // 结算：winner + phase=ended 广播
    const ended = await waitFor(() => states.some((s) => s.winner !== null && s.phase === 'ended'), 3000);
    expect(ended).toBe(true);
    const endState = states[states.length - 1];
    expect(endState.winner).toBe(1); // 队 0 兵力打空 → 队 1 胜

    // 结算期后自动开新回合：phase=started、winner 清空、兵力重置、全员复活
    const restarted = await waitFor(
      () => {
        const last = states[states.length - 1];
        return last.phase === 'started' && last.winner === null && last.tickets[0] > 290;
      },
      ROUND_RESTART_DELAY_MS + 4000,
      100,
    );
    expect(restarted).toBe(true);
    const newState = states[states.length - 1];
    expect(newState.tickets[0]).toBeGreaterThan(290);
    expect(newState.tickets[1]).toBeGreaterThan(290);
    expect(await waitFor(() => bAlive === true, 3000)).toBe(true);
    expect(await waitFor(() => bNearSpawn, 3000)).toBe(true);
  }, 30000);

  it('破坏物权威化：射击沙袋 → destructible_state 广播（bitset 翻转），弹道被沙袋拦截不穿透', async () => {
    const a = makeClient('da1');
    const b = makeClient('db1');
    const statesA: DestructibleStateMsg[] = [];
    const statesB: DestructibleStateMsg[] = [];
    a.onDestructibleState = (s) => statesA.push(s);
    b.onDestructibleState = (s) => statesB.push(s);

    await a.connect();
    await b.connect();
    const ackAPromise = waitJoinAck(a);
    const ackBPromise = waitJoinAck(b);
    a.joinRoom('destruct');
    b.joinRoom('destruct');
    const [ackA, ackB] = await Promise.all([ackAPromise, ackBPromise]);
    expect(ackA.team).not.toBe(ackB.team);

    // 射手=队 0 玩家（出生点 -20,-20）；沙袋 0 在 (8,-22)，血 150 / 步枪 25 伤 → 6 发摧毁
    const shooterTeam = ackA.team === 0 ? ackA.team : ackB.team;
    const shooter = ackA.team === 0 ? a : b;
    const sx = spawnOf(shooterTeam).x; // -20（队0）
    const sz = sx; // 出生点 z = x
    const sandbag = DESTRUCTIBLE_SPAWN_DEFS[0];
    const dx = sandbag.x - sx;
    const dz = sandbag.z - sz;
    const dist = Math.hypot(dx, dz);
    // 弹道从眼睛高 1.6m 指向沙袋中心 0.5m（服务端弹丸 y 由 pitch 决定）
    const aimYaw = Math.atan2(dx, -dz);
    const aimPitch = Math.atan2(0.5 - 1.6, dist);

    // 连射（30Hz 输入，fire=true；射速裁决 120ms 冷却 → 沙袋 150 血约 0.75s 摧毁）
    const deadline = Date.now() + 8000;
    let lastSend = 0;
    while (Date.now() < deadline && !statesA.some((s) => s.bits[0] === '1')) {
      if (Date.now() - lastSend >= 33) {
        shooter.sendInput({ ...IDLE_INPUT, fire: true, aimYaw, aimPitch });
        lastSend = Date.now();
      }
      await sleep(30);
    }

    // 双方均收到权威破坏状态：bitset 第 0 位翻转（沙袋已破坏）
    expect(statesA.some((s) => s.bits[0] === '1')).toBe(true);
    expect(statesB.some((s) => s.bits[0] === '1')).toBe(true);
    // bitset 长度与布局一致（稳定 ID 位序）
    expect(statesA[statesA.length - 1]?.bits.length).toBe(DESTRUCTIBLE_SPAWN_DEFS.length);
  }, 30000);

  it('有限历史回溯端到端：目标在弹丸飞行中移出命中带，按开火时刻位置裁决命中', async () => {
    const a = makeClient('ra1');
    const b = makeClient('rb1');
    await a.connect();
    await b.connect();
    const ackAPromise = waitJoinAck(a);
    const ackBPromise = waitJoinAck(b);
    a.joinRoom('rewind');
    b.joinRoom('rewind');
    const [ackA, ackB] = await Promise.all([ackAPromise, ackBPromise]);
    expect(ackA.team).not.toBe(ackB.team); // 平衡分配：不同队

    const shooterIsA = ackA.team === 0;
    const shooter = shooterIsA ? a : b;
    const target = shooterIsA ? b : a;
    const targetId = shooterIsA ? ackB.playerId : ackA.playerId;
    const targetTeam = shooterIsA ? ackB.team : ackA.team;
    const shooterTeam = shooterIsA ? ackA.team : ackB.team;

    const sx = spawnOf(shooterTeam).x; // -20
    const sz = sx;

    // target 快照跟踪：服务端权威 health（回溯命中的判别量）+ 当前位置（重试重新瞄准用）
    let tHealth = 100;
    let tX = 0;
    let tZ = 0;
    target.onSnapshot = (players) => {
      const me = players.get(targetId);
      if (!me) return;
      tHealth = me.health;
      tX = me.x;
      tZ = me.z;
    };

    // target 沿 -z 走 2.8s（≈14.6m）到 (20,-14.6) 静止——弹道 (-20,-20)→(20,-14.6)
    // 与载具重生点 v1(-16,-16)/v2(16,16) 距离 >3m，避免挡弹（沿用 GameState 走位方案）
    const walkStart = performance.now();
    while (performance.now() - walkStart < 2800) {
      target.sendInput({ ...IDLE_INPUT, moveForward: true });
      await sleep(30);
    }
    await sleep(300); // 静止，等服务端权威位置稳定

    // 射手瞄准 target 当前位置（弹道终点 = 开火时刻 target 所在）；target 同时继续沿 -z 移动
    // 开火 + 重试：回溯命中要求服务端在开火后 ~115ms 内处理开火输入（超过则回溯采样点
    // 偏晚、target 已移出命中带 → miss）。全量测试并行时 CPU 竞争可能造成瞬时延迟，故
    // 每次重新瞄准 target 实际位置重试最多 3 次；非回溯实现（bug）下每次必 miss → 最终断言失败。
    let hit = false;
    for (let attempt = 0; attempt < 3 && !hit; attempt++) {
      const nt = { x: tX, z: tZ };
      const ndx = nt.x - sx;
      const ndz = nt.z - sz;
      const ndist = Math.hypot(ndx, ndz);
      // 服务端 forward = (sin(yaw), -cos(yaw))；pitch 下压使弹道在目标躯干高度穿过
      const yaw = Math.atan2(ndx, -ndz);
      const pitch = Math.asin((0.5 - 1.6) / ndist);

      // 单发开火 + target 立即持续移动：弹丸飞行 ndist/60 ≈ 0.7s，target 移动 ≈3.5m >> 0.6m 命中半径
      shooter.sendInput({ ...IDLE_INPUT, fire: true, aimYaw: yaw, aimPitch: pitch });
      const runStart = performance.now();
      while (performance.now() - runStart < 1500) {
        target.sendInput({ ...IDLE_INPUT, moveForward: true });
        await sleep(30);
      }
      // 回溯命中（开火时刻 target 在弹道终点带内）→ 25 伤害 → health 75；
      // 非回溯（弹丸到达时刻 target 已移出命中带）必 miss → health 100
      hit = await waitFor(() => tHealth <= 75, 3000);
    }
    expect(hit).toBe(true);
  }, 30000);
});
