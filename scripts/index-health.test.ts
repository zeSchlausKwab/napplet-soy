import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IndexStore } from '../packages/backend/src/index-store';

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
    expect(await status()).toBe(0);
    expect(store.state<typeof health>('health')).toEqual(health);
    store.setState('health', { ...health, release: 'previous' });
    expect(await status()).toBe(1);
    store.setState('health', { ...health, checkedAt: Date.now() - 300001 });
    expect(await status()).toBe(1);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
