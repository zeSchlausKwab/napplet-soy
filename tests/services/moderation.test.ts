import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { nip19, type EventTemplate } from 'nostr-tools';
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
    refused = true; // Automatic policy loading must surface refusal without logging out.
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const accountButton = page.getByRole('button', { name: `${pubkey.slice(0, 6)}…`, exact: true });
    await accountButton.waitFor();
    await page.getByText(/Your account is still selected/).waitFor();
    await page.getByRole('button', { name: 'Retry loading administration' }).click();
    await page.getByRole('region', { name: 'Napplets', exact: true }).waitFor();
    expect(await page.locator('.admin-page select').count()).toBe(0);
    await accountButton.click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: 'Administration', exact: true })
      .waitFor();
    await page.keyboard.press('Escape');
    async function change(action: string, target: string, reason: string) {
      const section = page.getByRole('region', { name: 'Napplets', exact: true });
      await section.getByRole('searchbox').fill(target);
      await section.getByLabel('Napplets change reason').fill(reason);
      await section
        .getByRole('button', {
          name: action === 'feature' ? 'Feature' : action === 'block' ? 'Block' : 'Unblock',
          exact: true,
        })
        .click();
      await section
        .getByRole('status')
        .filter({
          hasText: action === 'feature' ? 'Featured' : action === 'block' ? 'Blocked' : 'Unblocked',
        })
        .waitFor();
      await browserExpect(section.getByLabel('Napplets change reason')).toHaveValue('');
    }
    // Title search selects the actual address; pasted npubs/naddrs remain accepted.
    const napplets = page.getByRole('region', { name: 'Napplets', exact: true });
    await napplets.getByRole('searchbox').fill(fixtures[0].title);
    await napplets.getByRole('button', { name: new RegExp(fixtures[0].title) }).click();
    await browserExpect(napplets.getByRole('searchbox')).toHaveValue(
      `35129:${fixtures[0].pubkey}:${fixtures[0].identifier}`,
    );
    await change('feature', fixtures[0].naddr, 'First hero choice');
    await change('feature', fixtures[1].naddr, 'Second hero choice');
    await page.getByLabel('Featured order change reason').fill('Put the second selection first');
    await page.getByRole('button', { name: 'Move featured selection 2 earlier' }).click();
    await browserExpect(
      page.getByRole('region', { name: 'Featured order', exact: true }).locator('li').first(),
    ).toContainText(fixtures[1].title);
    const admins = page.getByRole('region', { name: 'Administrators', exact: true });
    await admins.getByRole('searchbox').fill(nip19.npubEncode(secondKey));
    await admins.getByLabel('Administrators change reason').fill('Help curate the playground');
    await admins.getByRole('button', { name: 'Add administrator', exact: true }).click();
    await admins.getByRole('status').filter({ hasText: 'Administrator added' }).waitFor();
    await admins.getByLabel('Administrators change reason').fill('Membership test complete');
    await admins.getByRole('button', { name: 'Remove administrator', exact: true }).click();
    await admins.getByRole('status').filter({ hasText: 'Administrator removed' }).waitFor();
    await admins.getByRole('searchbox').fill(pubkey);
    await admins.getByLabel('Administrators change reason').fill('Protected recovery key');
    await browserExpect(
      admins.getByRole('button', { name: 'Remove administrator', exact: true }),
    ).toBeDisabled();
    // Each entity retains its own reason and identifier; hashes cannot accidentally become author blocks.
    const assets = page.getByRole('region', { name: 'Assets', exact: true });
    await assets.getByRole('searchbox').fill('not-a-hash');
    await assets.getByLabel('Assets change reason').fill('Invalid input');
    await browserExpect(assets.getByRole('button', { name: 'Block', exact: true })).toBeDisabled();
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
    await page.getByRole('region', { name: 'Napplets', exact: true }).waitFor();
    // Another admin edited the policy after this browser loaded it.
    const concurrent = await Bun.file(policy).json();
    concurrent.revision += 1;
    await Bun.write(policy, JSON.stringify(concurrent));
    await napplets.getByRole('searchbox').fill(fixtures[2].naddr);
    await napplets
      .getByLabel('Napplets change reason')
      .fill('Retain this draft after a stale revision');
    await napplets.getByRole('button', { name: 'Feature', exact: true }).click();
    await napplets.getByRole('button', { name: 'Retry change', exact: true }).waitFor();
    await browserExpect(napplets.getByLabel('Napplets change reason')).toHaveValue(
      'Retain this draft after a stale revision',
    );
    await browserExpect(page.locator('.admin-toolbar')).toContainText(
      `Revision ${concurrent.revision}`,
    );
    // A rejected mutation stays at its action button with the draft intact.
    refused = true;
    await napplets.getByRole('searchbox').fill(fixtures[1].naddr);
    await napplets.getByLabel('Napplets change reason').fill('Check hero moderation');
    await napplets.getByRole('button', { name: 'Block', exact: true }).click();
    await napplets.getByRole('button', { name: 'Retry change', exact: true }).waitFor();
    await browserExpect(napplets.getByLabel('Napplets change reason')).toHaveValue(
      'Check hero moderation',
    );
    await napplets.getByRole('button', { name: 'Retry change', exact: true }).click();
    await napplets.getByRole('status').filter({ hasText: 'Blocked' }).waitFor();
    await page.getByRole('button', { name: 'Refresh policy', exact: true }).click();
    await browserExpect(
      page.getByRole('button', { name: 'Refresh policy', exact: true }),
    ).toBeEnabled();
    await napplets.getByRole('searchbox').fill(fixtures[1].title);
    await napplets.getByRole('button', { name: new RegExp(fixtures[1].title) }).click();
    await browserExpect(
      napplets.getByRole('button', { name: 'Unblock', exact: true }),
    ).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: join(root, `.local/featured-check/admin-${width}.png`),
        fullPage: true,
      });
    }

    await page.goto(origin);
    await hero
      .getByRole('link', { name: `Explore featured napplet: ${fixtures[0].title}` })
      .waitFor();
    expect(await hero.getByRole('button', { name: 'Next featured napplet' }).count()).toBe(0);
    expect((await fetch(`${origin}/api/artifacts/${fixtures[1].artifactHash}`)).status).toBe(404);
    // Another administrator can grant/revoke membership while this page stays open.
    async function membership(action: 'admin-add' | 'admin-remove') {
      const { revision } = await Bun.file(policy).json();
      const body = JSON.stringify({
        action,
        type: 'pubkey',
        target: secondKey,
        reason: 'Live membership check',
        revision,
      });
      const hash = new Bun.CryptoHasher('sha256').update(body).digest('hex');
      const token = await signer.signEvent({
        kind: 27235,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', `${origin}/api/admin`],
          ['method', 'POST'],
          ['payload', hash],
          ['nonce', crypto.randomUUID()],
        ],
      });
      const response = await fetch(`${origin}/api/admin`, {
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(token))}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      expect(response.status).toBe(200);
    }
    const memberContext = await browser.newContext();
    await memberContext.exposeFunction('testSign', (event: EventTemplate) =>
      second.signEvent(event),
    );
    await memberContext.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, secondKey);
    const memberPage = await memberContext.newPage();
    memberPage.setDefaultTimeout(12000);
    await memberPage.goto(`${origin}/admin`);
    await memberPage.getByRole('button', { name: 'Connect', exact: true }).click();
    await memberPage.getByRole('button', { name: 'Connect browser extension' }).click();
    await memberPage.getByText('This account is not an administrator.', { exact: true }).waitFor();
    const memberButton = memberPage.getByRole('button', {
      name: `${secondKey.slice(0, 6)}…`,
      exact: true,
    });
    await memberButton.click();
    expect(
      await memberPage
        .getByRole('dialog')
        .getByRole('link', { name: 'Administration', exact: true })
        .count(),
    ).toBe(0);
    await memberPage.keyboard.press('Escape');
    const timeOrigin = await memberPage.evaluate(() => performance.timeOrigin);
    await membership('admin-add');
    await memberPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await memberPage.getByRole('region', { name: 'Napplets', exact: true }).waitFor();
    expect(await memberPage.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await membership('admin-remove');
    await memberPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await memberPage.getByText('This account is not an administrator.', { exact: true }).waitFor();
    expect(await memberPage.getByRole('region', { name: 'Napplets', exact: true }).count()).toBe(0);
    await membership('admin-add');
    await memberPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await memberPage.getByRole('region', { name: 'Napplets', exact: true }).waitFor();

    // A response that was authorized before sign-out must not restore old controls.
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const waiting = new Promise<void>((r) => {
      started = r;
    });
    await memberPage.route('**/api/admin', async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await memberPage.getByRole('button', { name: 'Refresh policy', exact: true }).click();
    await waiting;
    await memberButton.click();
    await memberPage.getByRole('button', { name: 'Sign out', exact: true }).click();
    release();
    await browserExpect(
      memberPage.getByRole('region', { name: 'Napplets', exact: true }),
    ).toHaveCount(0);
    await memberPage.unrouteAll({ behavior: 'wait' });
    await membership('admin-remove');
    await memberPage.getByRole('button', { name: 'Connect browser extension' }).click();
    await memberPage.getByText('This account is not an administrator.', { exact: true }).waitFor();
    await memberContext.close();
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
