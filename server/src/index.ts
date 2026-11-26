import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import router from './routes/index.js';
import { seed } from './db/seed.js';
import { startWorker, stopWorker } from './worker/index.js';

const PORT = Number(process.env.PORT || 3000);

async function main() {
  const r = seed();
  if (r.didRun) console.log('[seed] 演示数据已初始化（默认密码 123456）');
  else console.log('[seed] 数据已存在，跳过初始化');

  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(router);

  // 前端静态资源（构建后）
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: 'index.html' }));
    app.get(/^\/(?!api|auth).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    console.log('[web] 已托管前端构建产物于', webDist);
  } else {
    console.log('[web] 未找到 ../web/dist，仅提供 API（前端请用 vite dev）');
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled]', err);
    res.status(500).json({ code: 'INTERNAL', message: '服务器内部错误' });
  });

  startWorker();
  const server = app.listen(PORT, () => {
    console.log(`[server] 逾期跟进协作平台已启动：http://localhost:${PORT}`);
  });

  const shutdown = () => { stopWorker(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
