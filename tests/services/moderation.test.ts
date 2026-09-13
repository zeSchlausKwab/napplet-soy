import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { EventTemplate } from 'nostr-tools';
import { initializePolicy } from '../../packages/moderation/src/policy';
import fixtures from '../../packages/backend/data/catalog.json';

test('browser extension signs an admin block and unblock against the production server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-admin-browser-'));
  const policy = join(directory, 'policy.json');
  initializePolicy(policy);
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: '127.0.0.1',
      SPACE_SITE_ORIGIN: origin,
      SPACE_MODERATION_FILE: policy,
      SPACE_ADMIN_PUBKEYS: pubkey,
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(`${origin}/api/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      if (server.exitCode !== null) throw new Error('Production server exited');
      await Bun.sleep(100);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.exposeFunction('testSign', (event: EventTemplate) => signer.signEvent(event));
    await page.addInitScript(
      ({ pubkey }) => {
        (window as any).nostr = {
          getPublicKey: async () => pubkey,
          signEvent: (event: unknown) => (window as any).testSign(event),
        };
      },
      { pubkey },
    );
    await page.goto(`${origin}/admin`);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await page.getByText('Your Nostr identity', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Load admin policy' }).click();
    await page.getByText('0 active blocks', { exact: true }).waitFor();
    await page.getByLabel('Public identifier').fill(fixtures[0].naddr);
    await page.getByLabel('Reason').fill('Moderation browser verification');
    await page.getByRole('button', { name: 'Sign and save block' }).click();
    await page.getByText('Block saved.', { exact: true }).waitFor();
    expect((await fetch(`${origin}/api/artifacts/${fixtures[0].artifactHash}`)).status).toBe(404);
    await page.screenshot({ path: '.local/admin-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Explore', exact: true }).click();
    await browserExpect(page.locator('.napplet-card')).toHaveCount(5);
    await page.getByRole('link', { name: 'Administration', exact: true }).click();
    await page.getByRole('button', { name: 'Load admin policy' }).click();
    await page.getByRole('button', { name: 'Prepare unblock' }).click();
    await page.getByLabel('Reason').fill('Verified restoration');
    await page.getByRole('button', { name: 'Sign and remove block' }).click();
    await page.getByText('Block removed.', { exact: true }).waitFor();
    expect((await fetch(`${origin}/api/artifacts/${fixtures[0].artifactHash}`)).status).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
