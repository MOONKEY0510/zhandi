/**
 * Soak test CLI（阶段 8 验收：单房间服务器 CPU/内存可监控 + 长时间运行稳定性）。
 * 用法（vite-node 直跑）：
 *   npx vite-node server/soak.ts -- --players 32 --seconds 120
 *   npx vite-node server/soak.ts -- --players 32 --seconds 7200   # 生产验收：2 小时
 * 周期打点（tick / RSS / heap / 玩家 / RTT 均值 / 错误数），结束输出汇总：
 * 总 tick、快照总数、RTT P50/P95、错误数、内存峰值与增长。
 * CI 冒烟用短时长（如 30-60 秒）；完整 2 小时 soak 按验收需要手动执行。
 */
import { ServerApp } from './ServerApp.ts';
import { HeadlessClient } from './HeadlessClient.ts';

interface CliArgs {
  players: number;
  seconds: number;
  simPlayers: number;
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    players: 32,
    seconds: 120,
    simPlayers: 8,
    latencyMs: 100,
    jitterMs: 30,
    lossRate: 0.02,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].split('=')[0];
    switch (key) {
      case '--players': args.players = Number(argv[++i]); break;
      case '--seconds': args.seconds = Number(argv[++i]); break;
      case '--sim-players': args.simPlayers = Number(argv[++i]); break;
      case '--latency': args.latencyMs = Number(argv[++i]); break;
      case '--jitter': args.jitterMs = Number(argv[++i]); break;
      case '--loss': args.lossRate = Number(argv[++i]); break;
      case '--help':
        console.log(
          'soak: npx vite-node server/soak.ts -- --players 32 --seconds 120 [--sim-players 8 --latency 100 --jitter 30 --loss 0.02]',
        );
        process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const server = new ServerApp({
    port: 8788,
    defaultRoomId: 'soak',
    onStats: (s) => {
      void s;
    },
  });
  const port = await server.start();
  const url = `ws://127.0.0.1:${port}`;
  console.log(`[soak] 服务器端口 ${port}，${args.players} 玩家（前 ${args.simPlayers} 个模拟 ${args.latencyMs}ms/${args.jitterMs}ms/${args.lossRate * 100}%），时长 ${args.seconds}s`);

  const clients: HeadlessClient[] = [];
  for (let i = 0; i < args.players; i += 1) {
    const sim =
      i < args.simPlayers
        ? { latencyMs: args.latencyMs, jitterMs: args.jitterMs, lossRate: args.lossRate }
        : undefined;
    clients.push(new HeadlessClient({ url, playerId: `p${String(i).padStart(3, '0')}`, roomId: 'soak', sim }));
  }
  await Promise.all(clients.map((c) => c.start()));

  const heapStart = process.memoryUsage().heapUsed;
  const rssStart = process.memoryUsage().rss;
  let heapPeak = heapStart;
  let rssPeak = rssStart;
  let totalSnapshots = 0;
  const startTime = Date.now();

  const ticker = setInterval(() => {
    const mem = process.memoryUsage();
    heapPeak = Math.max(heapPeak, mem.heapUsed);
    rssPeak = Math.max(rssPeak, mem.rss);
    totalSnapshots = clients.reduce((a, c) => a + c.snapshots, 0);
    const rtts = clients.map((c) => c.getStats().rttMs ?? 0);
    const rttAvg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
    const errors = clients.reduce((a, c) => a + c.errors.length, 0);
    const joined = clients.filter((c) => c.joined).length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[${elapsed}s] joined=${joined}/${args.players} snap=${totalSnapshots} rttAvg=${rttAvg.toFixed(1)}ms ` +
        `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB errors=${errors}`,
    );
  }, 5000);

  await new Promise((r) => setTimeout(r, args.seconds * 1000));
  clearInterval(ticker);

  // 汇总
  const memEnd = process.memoryUsage();
  totalSnapshots = clients.reduce((a, c) => a + c.snapshots, 0);
  const rtts = clients.map((c) => c.getStats().rttMs ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const p50 = rtts[Math.floor(rtts.length * 0.5)] ?? 0;
  const p95 = rtts[Math.floor(rtts.length * 0.95)] ?? 0;
  const errors = clients.reduce((a, c) => a + c.errors.length, 0);
  const errorByCode = new Map<string, number>();
  for (const c of clients) {
    for (const code of c.errors) errorByCode.set(code, (errorByCode.get(code) ?? 0) + 1);
  }
  const lost = clients.reduce((a, c) => a + c.lostSnapshots, 0);

  console.log('\n===== SOAK 汇总 =====');
  console.log(`时长: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`服务器 tick: ${server.clock.tick}`);
  console.log(`快照总数: ${totalSnapshots}（丢包缺口 ${lost}）`);
  console.log(`RTT: 均值 ${(rtts.reduce((a, b) => a + b, 0) / Math.max(1, rtts.length)).toFixed(1)}ms / P50 ${p50.toFixed(1)}ms / P95 ${p95.toFixed(1)}ms`);
  console.log(`服务器错误: ${errors}${errorByCode.size > 0 ? ` ${[...errorByCode.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`);
  console.log(`内存: heap ${((memEnd.heapUsed - heapStart) / 1024 / 1024).toFixed(1)}MB 增长（峰值 ${(heapPeak / 1024 / 1024).toFixed(1)}MB），rss ${((memEnd.rss - rssStart) / 1024 / 1024).toFixed(1)}MB 增长（峰值 ${(rssPeak / 1024 / 1024).toFixed(1)}MB）`);

  for (const c of clients) c.stop();
  server.stop();
  process.exit(errors === 0 ? 0 : 1);
}

void main();
