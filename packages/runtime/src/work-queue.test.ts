import { test, expect } from 'bun:test';
import { WorkQueue } from './work-queue';
test('resource jobs queue within their concurrency limit and queued cancellation starts no work', async () => {
  const queue = new WorkQueue(1, 2);
  const running = new AbortController(),
    queued = new AbortController();
  let finish!: () => void,
    secondStarted = false;
  const first = queue.run(
    running.signal,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  const second = queue.run(queued.signal, async () => {
    secondStarted = true;
  });
  const rejection = expect(second).rejects.toThrow('cancelled');
  queued.abort();
  await rejection;
  const third = queue.run(running.signal, async () => 'third');
  finish();
  await first;
  expect(await third).toBe('third');
  expect(secondStarted).toBe(false);
});
