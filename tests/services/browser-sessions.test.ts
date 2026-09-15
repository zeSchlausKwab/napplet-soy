import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPublicKey } from 'nostr-tools';
import { initializePolicy } from '../../packages/moderation/src/policy';

test('browser keys persist only by consent in encrypted IndexedDB, switch, sign, and forget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-session-browser-'));
  const key = '3'.padStart(64, '0'),
    other = '4'.padStart(64, '0');
  const pubkey = getPublicKey(Uint8Array.from(Buffer.from(key, 'hex')));
  const otherPubkey = getPublicKey(Uint8Array.from(Buffer.from(other, 'hex')));
  const label = `${pubkey.slice(0, 6)}…`,
    otherLabel = `${otherPubkey.slice(0, 6)}…`;
  initializePolicy(join(directory, 'policy.json'));
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_ADMIN_PUBKEYS: pubkey,
      SPACE_MODERATION_FILE: join(directory, 'policy.json'),
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(origin)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await Bun.sleep(100);
    }
    const page = await browser.newPage();
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url() + (request.postData() ?? '')));
    await page.goto(`${origin}/admin`);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    async function importKey(value: string) {
      await page.getByRole('button', { name: 'Private key', exact: true }).click();
      await page.getByLabel('Remember this private key on this device').check();
      await page.getByLabel('I understand the risk').check();
      await page.getByLabel('Private key', { exact: true }).fill(value);
      await page.getByRole('button', { name: 'Use key for this session' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    await importKey(key);
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('napplet-sessions-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db.transaction('vault', 'readonly').objectStore('vault');
      const read = (key: string) =>
        new Promise<any>((resolve) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
        });
      const [key, envelope] = await Promise.all([read('key'), read('sessions')]);
      db.close();
      return {
        extractable: key.extractable,
        algorithm: key.algorithm.name,
        fields: Object.keys(envelope).sort(),
        cipher: Array.from(new Uint8Array(envelope.ciphertext)),
        revision: envelope.revision,
        plain: JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
      };
    });
    expect(stored.extractable).toBe(false);
    expect(stored.algorithm).toBe('AES-GCM');
    expect(stored.fields).toEqual(['ciphertext', 'iv', 'revision']);
    expect(stored.cipher.length).toBeGreaterThan(100);
    expect(stored.plain).not.toContain(key);
    expect(requests.join('\n')).not.toContain(key);
    await page.reload();
    await page.getByRole('button', { name: label, exact: true }).waitFor();
    await page.getByRole('region', { name: 'Napplets', exact: true }).waitFor(); // Restored key automatically signs NIP-98.
    await page.getByRole('button', { name: label, exact: true }).click();
    await importKey(other);
    await page.getByRole('button', { name: otherLabel, exact: true }).click();
    await browserExpect(page.locator('.saved-session')).toHaveCount(2);
    await page.getByRole('button', { name: `Use account ${pubkey.slice(0, 10)}` }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: `Forget account ${pubkey.slice(0, 10)}` }).click();
    await page.getByRole('button', { name: `Use account ${otherPubkey.slice(0, 10)}` }).waitFor();
    await browserExpect(page.locator('.saved-session')).toHaveCount(1);
    await page.getByRole('button', { name: `Forget account ${otherPubkey.slice(0, 10)}` }).click();
    await browserExpect(page.locator('.saved-session')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    expect(await page.locator('.saved-session').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
