import { resolve } from 'node:path';
import { createBlossom } from './server';
declare const BLOSSOM_BUILD_ID: string;

if (import.meta.main) {
  const config = {
    directory: resolve(process.env.SPACE_BLOSSOM_DATA ?? '.local/services/blossom'),
    origin: process.env.SPACE_BLOSSOM_ORIGIN ?? 'http://127.0.0.1:19348',
    local: process.env.SPACE_BLOSSOM_LOCAL === '1',
    hostname: '127.0.0.1',
    port: Number(process.env.SPACE_BLOSSOM_PORT ?? 19348),
    instance: process.env.SPACE_BLOSSOM_INSTANCE ?? 'napplet',
    build: typeof BLOSSOM_BUILD_ID === 'undefined' ? 'source' : BLOSSOM_BUILD_ID,
  };
  const service = await createBlossom(config);
  console.log(`Napplet Blossom listening on http://127.0.0.1:${service.server.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => {
      void service.close(true);
    }, 12000);
    timeout.unref();
    await service.close();
    clearTimeout(timeout);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
