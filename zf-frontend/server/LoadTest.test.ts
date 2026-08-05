/**
 * 16v16 压测（阶段 8 验收标准缩小版）。
 * 本地起权威 ServerApp，32 个 headless 客户端（8 个挂 100ms RTT / 30ms jitter / 2% loss 网络模拟），
 * 跑 5 秒验证：满员入房、服务器稳定 tick、全部客户端持续收快照、模拟组 RTT 反映延迟、
 * 正常行为下零服务器错误、服务器内存增长可控。
 * 真实定时器与真实 WebSocket（非 mock）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServerApp } from './ServerApp.ts';
import { HeadlessClient } from './HeadlessClient.ts';

const PLAYERS = 32; // 16v16
const SIM_PLAYERS = 8; // 挂 100ms / 30ms / 2% 网络模拟
const RUN_MS = 5000;

interface ServerStatsSample {
  tick: number;
  rooms: number;
  players: number;
  corrections: number;
}

describe('16v16 压测（阶段 8 验收）', () => {
  let server: ServerApp;
  let url: string;
  const stats: ServerStatsSample[] = [];
  const clients: HeadlessClient[] = [];
  let heapBefore = 0;
  let heapAfter = 0;

  beforeAll(async () => {
    server = new ServerApp({
      port: 0,
      defaultRoomId: 'load',
      onStats: (s) => stats.push(s),
    });
    const port = await server.start();
    url = `ws://127.0.0.1:${port}`;

    heapBefore = process.memoryUsage().heapUsed;
    // 32 个虚拟玩家：前 8 个挂网络模拟（对应验收标准 100ms RTT / 30ms jitter / 2% loss）
    for (let i = 0; i < PLAYERS; i += 1) {
      const sim =
        i < SIM_PLAYERS
          ? { latencyMs: 100, jitterMs: 30, lossRate: 0.02, seed: 1000 + i } // 固定种子：丢包模式可复现，避免概率性 0 缺口抖动
          : undefined;
      clients.push(
        new HeadlessClient({
          url,
          playerId: `p${String(i).padStart(2, '0')}`,
          displayName: `玩家${i + 1}`,
          roomId: 'load',
          sim,
        }),
      );
    }
    await Promise.all(clients.map((c) => c.start()));
  }, 20000);

  afterAll(() => {
    for (const client of clients) client.stop();
    server.stop();
  });

  it('32 客户端满员入房，服务器稳定 tick 推进', async () => {
    // 等待全部加入（模拟组 100ms 延迟，握手往返 200ms，给足余量）
    const deadline = Date.now() + 5000;
    while (!clients.every((c) => c.joined) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(clients.every((c) => c.joined)).toBe(true);
    expect(stats.length).toBeGreaterThan(0);
    // 服务器 tick 单调推进且已运行足够多 tick
    const first = stats[0].tick;
    const last = stats[stats.length - 1].tick;
    expect(last).toBeGreaterThan(first);
    expect(stats[stats.length - 1].players).toBe(PLAYERS);
  }, 15000);

  it('全部客户端持续收到快照，模拟组丢包缺口符合预期、RTT 反映延迟', async () => {
    await new Promise((r) => setTimeout(r, RUN_MS));
    heapAfter = process.memoryUsage().heapUsed;

    const clean = clients.slice(SIM_PLAYERS);
    const simmed = clients.slice(0, SIM_PLAYERS);

    // 干净组：5 秒 × 15Hz ≈ 75 快照，扣除启动/尾窗至少 30
    for (const c of clean) {
      expect(c.snapshots, `${c.playerId} 快照数`).toBeGreaterThanOrEqual(30);
      expect(c.errors).toEqual([]);
    }
    // 模拟组：100ms 延迟 + 2% 丢包仍能持续收到快照
    for (const c of simmed) {
      expect(c.snapshots, `${c.playerId} 模拟组快照数`).toBeGreaterThanOrEqual(15);
      expect(c.errors).toEqual([]);
    }
    // 丢包路径确实被触发：8 个固定种子客户端中至少 1 个出现 tick 缺口（2% × 75 ≈ 1-2 个/客户端）
    // 组级断言避免单客户端 0 缺口的概率性抖动（固定种子下为确定性结果）
    const totalGaps = simmed.reduce((sum, c) => sum + c.lostSnapshots, 0);
    expect(totalGaps, '模拟组丢包缺口总数').toBeGreaterThanOrEqual(1);

    // RTT：模拟组均值 ≥ 干净组均值 + 80ms（100ms 单程 × 2 = 200ms 上限，保守取 80ms 增量）
    const cleanRtt = clean.map((c) => c.getStats().rttMs ?? 0);
    const simRtt = simmed.map((c) => c.getStats().rttMs ?? 0);
    const cleanAvg = cleanRtt.reduce((a, b) => a + b, 0) / cleanRtt.length;
    const simAvg = simRtt.reduce((a, b) => a + b, 0) / simRtt.length;
    expect(simAvg).toBeGreaterThanOrEqual(cleanAvg + 80);
  }, 20000);

  it('服务器内存增长可控（防泄漏粗检）', () => {
    expect(heapAfter).toBeGreaterThan(0);
    const growthMb = (heapAfter - heapBefore) / 1024 / 1024;
    // 32 连接 + 5 秒运行：堆增长应远低于 100MB（宽松阈值，仅防严重泄漏）
    expect(growthMb).toBeLessThan(100);
  });
});
