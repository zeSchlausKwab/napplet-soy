import { IndexWorker, indexConfig } from '../../packages/backend/src/index-worker';

const worker = new IndexWorker(indexConfig());
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
try {
  await worker.run(controller.signal);
} finally {
  worker.close();
}
