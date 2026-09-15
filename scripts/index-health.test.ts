import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IndexStore } from '../packages/backend/src/index-store';
import { IndexWorker } from '../packages/backend/src/index-worker';

test('a running worker is ready while its first relay scan is still pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-startup-'));
  const worker = new IndexWorker({
    directory,
    relays: ['wss://relay.example'],
    release: 'candidate',
  });
  const stop = new AbortController();
  let finish!: (errors: string[]) => void;
  worker.collect = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  worker.hydrate = async () => [];
  const running = worker.run(stop.signal);
  try {
    const child = Bun.spawn([process.execPath, resolve('scripts/index-health.ts')], {
      env: { PATH: process.env.PATH, SPACE_INDEX_DIR: directory, SPACE_RELEASE_ID: 'candidate' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(0);
    expect(worker.store.state('health')).toBeNull();
  } finally {
    stop.abort();
    finish([]);
    await running;
    expect(worker.store.state('worker')).toBeNull();
    worker.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('deployment readiness uses a fresh worker report while retaining remote relay errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-readiness-'));
  const store = new IndexStore(directory, true);
  async function status() {
    const child = Bun.spawn([process.execPath, resolve('scripts/index-health.ts')], {
      env: { PATH: process.env.PATH, SPACE_INDEX_DIR: directory, SPACE_RELEASE_ID: 'candidate' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    return child.exited;
  }
  try {
    expect(await status()).toBe(1);
    const health = {
      checkedAt: Date.now(),
      release: 'candidate',
      relays: ['wss://relay.example'],
      errors: ['wss://relay.example timed out'],
    };
    store.setState('health', health);
    expect(await status()).toBe(1); // A completed scan alone does not prove a live worker.
    store.setState('worker', { checkedAt: health.checkedAt, release: health.release });
    expect(await status()).toBe(0);
    expect(store.state<typeof health>('health')).toEqual(health);
    store.setState('worker', { ...health, release: 'previous' });
    expect(await status()).toBe(1);
    store.setState('worker', { ...health, checkedAt: Date.now() - 30001 });
    expect(await status()).toBe(1);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
