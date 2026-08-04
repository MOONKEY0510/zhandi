/**
 * 权威服务器入口（阶段 8 P0）。
 * 运行：npm run server（vite-node 直跑 TS）
 */

import { ServerApp } from './ServerApp.ts';

const port = Number(process.env.PORT ?? 8787);
const app = new ServerApp({ port, defaultRoomId: process.env.ROOM ?? 'lobby-1' });

app.start()
  .then((actualPort) => {
    console.log(`[server] 权威服务器已启动 ws://localhost:${actualPort}`);
    console.log(`[server] tick=${app.clock.tickRateHz}Hz, 快照=${app.clock.tickRateHz / app.clock.snapshotEveryTicks}Hz, 协议 v${1}`);
  })
  .catch((err) => {
    console.error('[server] 启动失败', err);
    process.exit(1);
  });
