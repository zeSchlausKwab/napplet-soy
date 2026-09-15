import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { EventTemplate } from 'nostr-tools';
import { initializePolicy } from '../../packages/moderation/src/policy';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';

test('featured hero, ordered admin curation, membership and remembered extension signing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-admin-browser-'));
  const policy = join(directory, 'policy.json'),
    root = resolve(import.meta.dir, '../..');
  initializePolicy(policy);
  const index = new IndexStore(join(directory, 'index'), true);
  for (const fixture of fixtures) {
    index.admit(fixture.current);
    await Bun.write(
      join(directory, 'index/artifacts', `${fixture.artifactHash}.html`),
      Bun.file(join(root, 'packages/backend/data/artifacts', `${fixture.artifactHash}.html`)),
    );
    index.project(
      fixture.current.id,
      { ...(await publicNapplet(fixture.current)), availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
  }
  index.close();
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const second = new PrivateKeySigner(),
    secondKey = await second.getPublicKey();
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: '127.0.0.1',
      SPACE_SITE_ORIGIN: origin,
      SPACE_MODERATION_FILE: policy,
      SPACE_ADMIN_PUBKEYS: pubkey,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
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
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.clock.install();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let refused = false;
    await context.exposeFunction('testSign', (event: EventTemplate) => {
      if (refused) {
        refused = false;
        throw Error('User declined');
      }
      return signer.signEvent(event);
    });
    await context.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, pubkey);
    await page.goto(origin);
    await browserExpect(page.locator('.napplet-grid .napplet-card')).toHaveCount(6);
    expect(await page.locator('.featured-hero').count()).toBe(0);
    await page.goto(`${origin}/admin`);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    const accountButton = page.getByRole('button', { name: `${pubkey.slice(0, 6)}…`, exact: true });
    await accountButton.waitFor();
    refused = true;
    await page.getByRole('button', { name: 'Load admin policy' }).click();
    await page.getByText(/Your account is still selected/).waitFor();
    await accountButton.waitFor();
    await page.getByRole('button', { name: 'Load admin policy' }).click();
    await page.getByText('0 active blocks', { exact: true }).waitFor();
    async function change(action: string, target: string, reason: string) {
      await page.getByLabel('Action').selectOption(action);
      await page.getByLabel('Public identifier').fill(target);
      await page.getByLabel('Reason', { exact: true }).fill(reason);
      await page.getByRole('button', { name: 'Sign and save change' }).click();
      await page.getByRole('button', { name: 'Refresh policy' }).waitFor();
      await browserExpect(page.getByLabel('Public identifier')).toHaveValue('');
    }
    await change('feature', fixtures[0].naddr, 'First hero choice');
    await change('feature', fixtures[1].naddr, 'Second hero choice');
    await page.getByRole('button', { name: 'Move featured selection 2 earlier' }).click();
    await page.getByText('Featured order saved.', { exact: true }).waitFor();
    await page.getByLabel('Administrator public key').fill(secondKey);
    await page.getByLabel('Administrator change reason').fill('Help curate the playground');
    await page.getByRole('button', { name: 'Add administrator', exact: true }).click();
    await page.getByText('Administrator added.', { exact: true }).waitFor();
    await page.getByText('Recovery administrator · server configuration').waitFor();
    await page.getByLabel('Administrator change reason').fill('Membership test complete');
    const member = page
      .locator('li')
      .filter({ has: page.locator('code').filter({ hasText: secondKey }) })
      .filter({ has: page.getByRole('button', { name: 'Remove administrator' }) });
    await member.getByRole('button', { name: 'Remove administrator' }).click();
    await page.getByText('Administrator removed.', { exact: true }).waitFor();
    await mkdir(join(root, '.local/featured-check'), { recursive: true });
    await page.screenshot({
      path: join(root, '.local/featured-check/admin-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Explore', exact: true }).click();
    const hero = page.getByRole('region', { name: 'Featured napplets' });
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[1].title}` })
      .waitFor();
    await page.screenshot({ path: join(root, '.local/featured-check/hero-desktop.png') });
    expect(await page.locator('iframe').count()).toBe(0);
    await hero.getByRole('button', { name: 'Pause featured rotation' }).click();
    await hero.getByRole('button', { name: 'Resume featured rotation' }).waitFor();
    await hero.getByRole('button', { name: 'Resume featured rotation' }).click();
    await page.locator('.hero h1').click(); // Leave both pointer and keyboard focus outside the carousel.
    await page.clock.runFor(7500);
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[0].title}` })
      .waitFor();
    await hero.hover();
    await page.clock.runFor(7500);
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[0].title}` })
      .waitFor();
    await page.clock.resume();
    await hero.getByRole('button', { name: 'Previous featured napplet' }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await hero.getByRole('button', { name: 'Next featured napplet' }).click();
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[0].title}` })
      .waitFor();
    expect(await hero.getByRole('button', { name: /featured rotation/ }).count()).toBe(0);
    await page.goto(`${origin}/?q=does-not-exist`);
    await browserExpect(page.locator('.napplet-grid .napplet-card')).toHaveCount(0);
    await hero.waitFor(); // Independent of gallery filters.
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: join(root, `.local/featured-check/hero-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const command = await page.locator('.hero .starter-command').boundingBox();
      expect(command).not.toBeNull();
      expect(command!.y + command!.height).toBeLessThan(height);
    }
    await page.goto(`${origin}/admin`);
    await page.getByRole('button', { name: 'Load admin policy' }).click();
    await page.getByText('0 active blocks', { exact: true }).waitFor();
    await change('block', fixtures[1].naddr, 'Check hero moderation');
    await page.goto(origin);
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[0].title}` })
      .waitFor();
    expect(await hero.getByRole('button', { name: 'Next featured napplet' }).count()).toBe(0);
    expect((await fetch(`${origin}/api/artifacts/${fixtures[1].artifactHash}`)).status).toBe(404);
    const another = await context.newPage();
    await another.goto(origin);
    await another.getByRole('button', { name: `${pubkey.slice(0, 6)}…`, exact: true }).waitFor();
    await accountButton.click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await another.getByRole('button', { name: 'Connect', exact: true }).waitFor();
    await page.getByRole('button', { name: `Forget account ${pubkey.slice(0, 10)}` }).click();
    await browserExpect(page.locator('.saved-session')).toHaveCount(0);
    await another.getByRole('button', { name: 'Connect', exact: true }).click();
    await browserExpect(another.locator('.saved-session')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
