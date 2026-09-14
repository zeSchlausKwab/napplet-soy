import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, getPublicKey } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { socialScope, likeTemplate, commentTemplate } from '../../packages/protocol/src/social';
import { CommunityStore } from '../../packages/community/src/store';
import fixtures from '../../packages/backend/data/catalog.json';

test('gallery social locks, counts, ranking rails, focused comments and anonymous QR invoices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-gallery-social-')),
    root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1; // Explicit public fixture key, never an account credential.
  const fixture = fixtures[0],
    events = new Map<string, SignedEvent>([
      [fixture.current.id, fixture.current],
      [fixture.snapshot.id, fixture.snapshot],
    ]);
  const index = new IndexStore(join(directory, 'index'), true);
  const store = new CommunityStore(join(directory, 'community'));
  const visitor = new Uint8Array(32);
  visitor[31] = 2;
  const now = Math.floor(Date.now() / 1000);
  for (const item of fixtures) {
    index.admit(item.current);
    await Bun.write(
      join(directory, 'index/artifacts', `${item.artifactHash}.html`),
      Bun.file(join(root, 'packages/backend/data/artifacts', `${item.artifactHash}.html`)),
    );
    const entry = await publicNapplet(item.current);
    index.project(
      item.current.id,
      { ...entry, availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    events.set(item.current.id, item.current);
    const scope = socialScope(item.current);
    const reactions = [
      finalizeEvent(likeTemplate(scope, item.current, now - 3), visitor),
      finalizeEvent(commentTemplate(scope, 'A gallery conversation', undefined, now - 2), visitor),
    ];
    reactions.forEach((event) => events.set(event.id, event));
    store.put(scope.key, [item.current, ...reactions]);
  }
  store.close();
  index.close();
  let rejected = 0;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('relay');
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') {
          for (const e of events.values())
            if (matchFilters(message.slice(2), e))
              socket.send(JSON.stringify(['EVENT', message[1], e]));
          socket.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'EVENT') {
          try {
            const e = verifiedEvent(message[1]);
            events.set(e.id, e);
            socket.send(JSON.stringify(['OK', e.id, true, '']));
          } catch {
            rejected++;
          }
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`,
    relayUrl = `ws://127.0.0.1:${relay.port}/`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: relayUrl,
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let accountSignatures = 0;
    await page.exposeFunction('testSign', async (template: Parameters<typeof finalizeEvent>[0]) => {
      accountSignatures++;
      return JSON.parse(JSON.stringify(finalizeEvent(template, key)));
    });
    await page.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, getPublicKey(key));
    await page.goto(origin);
    const card = page
      .locator('.napplet-grid > .napplet-card')
      .filter({ has: page.getByRole('link', { name: fixture.title, exact: true }) });
    await page.waitForFunction(() =>
      document.querySelector('.napplet-grid .card-social')?.textContent?.includes('1'),
    );
    expect(await card.getByRole('button', { name: /^Like .*sign in required/ }).isDisabled()).toBe(
      true,
    );
    expect(
      await card.getByRole('button', { name: /^Comment on .*sign in required/ }).isDisabled(),
    ).toBe(true);
    expect(await page.locator('iframe').count()).toBe(0);
    await page.getByRole('heading', { name: 'Most liked', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Most zapped', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Most commented', exact: true }).waitFor();
    expect(await page.locator('.social-rail-liked .napplet-card').count()).toBe(6);
    const state = await (await fetch(`${origin}/api/gallery-social`)).json();
    expect(state.counts[fixture.current.id].likeCount).toBe(1);
    expect(state.counts[fixture.current.id].commentCount).toBe(1);
    expect(state.rankings.liked).toHaveLength(6);
    const filter = await (
      await fetch(`${origin}/api/gallery-social?q=${encodeURIComponent(fixture.title)}`)
    ).json();
    expect(filter.rankings.liked.map((n: any) => n.title)).toEqual([fixture.title]);
    const featured = await (await fetch(`${origin}/api/gallery-social?sort=featured`)).json();
    expect(featured.rankings.liked).toEqual([]);
    let invoiceRequests: SignedEvent[] = [];
    await page.route('**/api/zaps?*', async (route) => {
      if (route.request().method() === 'POST') {
        const request = verifiedEvent(route.request().postDataJSON());
        expect(request.kind).toBe(9734);
        expect(request.tags).toContainEqual(['e', fixture.current.id]);
        expect(request.tags).toContainEqual(['p', fixture.pubkey]);
        expect(request.tags).toContainEqual(['amount', '21000']);
        invoiceRequests.push(request);
        return route.fulfill({
          json: { invoice: 'lnbc1test-only-never-pay', msats: 21000, expiresAt: now + 3600 },
        });
      }
      return route.fulfill({
        json: {
          endpoint: {
            pubkey: fixture.pubkey,
            lnurl: 'lnurl1fixture',
            callback: 'https://wallet.example/callback',
            nostrPubkey: fixture.pubkey,
            minSendable: 1000,
            maxSendable: 1000000,
            commentAllowed: 100,
          },
          relays: ['wss://relay.example'],
          receipts: [],
          msats: 0,
        },
      });
    });
    // Anonymous visitors can create an invoice without touching the installed signer.
    for (let i = 0; i < 2; i++) {
      await card.getByRole('button', { name: /^Zap / }).click();
      await page.getByRole('button', { name: 'Create anonymous zap invoice', exact: true }).click();
      await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          (document.querySelector('.lightning-code canvas') as HTMLCanvasElement)?.width === 280,
      );
      expect(
        await page.getByRole('link', { name: 'Open Lightning wallet' }).getAttribute('href'),
      ).toBe('lightning:lnbc1test-only-never-pay');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    expect(accountSignatures).toBe(0);
    expect(invoiceRequests[0].pubkey).not.toBe(fixture.pubkey);
    expect(invoiceRequests[0].pubkey).not.toBe(invoiceRequests[1].pubkey);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect from this app' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const attempts: string[] = [];
    await page.route('**/api/social?*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts.push(route.request().postData()!);
      if (attempts.length === 1)
        return route.fulfill({
          status: 502,
          json: { error: 'Relay acknowledgement unavailable.' },
        });
      return route.continue();
    });
    await card.getByRole('button', { name: /^Like / }).click();
    await page.getByRole('button', { name: 'Retry like', exact: true }).click();
    await card.getByRole('button', { name: /^Unlike .*2 likes/ }).waitFor();
    expect(attempts[0]).toBe(attempts[1]);
    expect(accountSignatures).toBe(1);
    await card.getByRole('button', { name: /^Unlike / }).click();
    await card.getByRole('button', { name: /^Like .*1 likes/ }).waitFor();
    // One canonical comment destination from every copy of a card; hydration focuses the field.
    await card.getByRole('link', { name: /^Comment on / }).click();
    await page.getByLabel('Leave a little note').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'napplet-comment');
    expect(new URL(page.url()).hash).toBe('#comments');
    await page.getByLabel('Leave a little note').fill('From the gallery bubble.');
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await page.getByText('From the gallery bubble.', { exact: true }).waitFor();
    await page.goBack();
    await card.getByRole('link', { name: /^Comment on .*2 comments/ }).waitFor();
    // Rails and the main grid own one active player, even for repeated cards.
    const likedCard = page.locator('.social-rail-liked .napplet-card').first();
    await likedCard.locator('.card-preview').click();
    await likedCard.locator('iframe').waitFor();
    expect(await page.locator('iframe').count()).toBe(1);
    await card.locator('.card-preview').click();
    await card.locator('iframe').waitFor();
    expect(await page.locator('iframe').count()).toBe(1);
    await card.getByRole('button', { name: 'Stop napplet', exact: true }).click();
    expect(await page.locator('iframe').count()).toBe(0);
    // Explicit anonymous mode also bypasses the connected profile signer.
    const signedBefore = accountSignatures;
    await card.getByRole('button', { name: /^Zap / }).click();
    await page.getByLabel('Zap anonymously', { exact: true }).check();
    await page.getByRole('button', { name: 'Create anonymous zap invoice' }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    expect(accountSignatures).toBe(signedBefore);
    expect(invoiceRequests[2].pubkey).not.toBe(fixture.pubkey);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await mkdir(join(root, '.local/gallery-social-check'), { recursive: true });
    await page.locator('.social-discovery').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/desktop.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.social-rail-liked').scrollIntoViewIfNeeded();
    const track = page.locator('.social-rail-liked .social-rail-track');
    expect(await track.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next most liked', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.social-rail-liked .social-rail-track')!.scrollLeft > 100,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/mobile.png'),
      animations: 'disabled',
    });
    await card.getByRole('button', { name: /^Zap / }).click();
    await page.getByLabel('Zap anonymously', { exact: true }).check();
    await page.getByRole('button', { name: 'Create anonymous zap invoice' }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/anonymous-zap.png'),
      animations: 'disabled',
    });
    expect(rejected).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
