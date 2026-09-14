import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, getPublicKey } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import fixtures from '../../packages/backend/data/catalog.json';

test('production SSR, signed named routes and social actions work through a real local WebSocket relay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-community-browser-')),
    root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1; // Explicit public fixture key, never an account credential.
  const fixture = fixtures[0],
    events = new Map<string, SignedEvent>([
      [fixture.current.id, fixture.current],
      [fixture.snapshot.id, fixture.snapshot],
    ]);
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
    await page.exposeFunction('testSign', async (template: Parameters<typeof finalizeEvent>[0]) =>
      JSON.parse(JSON.stringify(finalizeEvent(template, key))),
    );
    await page.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, getPublicKey(key));
    await page.goto(`${origin}/n/${fixture.naddr}`);
    await page.getByRole('button', { name: 'Connect to comment or like' }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await page.getByRole('button', { name: 'Named link', exact: true }).click();
    await page.getByLabel('Creator handle').fill('browser-author');
    await page.getByLabel('Napplet slug').fill('first');
    await page.getByRole('button', { name: 'Claim /@handle/slug' }).click();
    await page.getByText('Your named link is ready.').waitFor();
    const named = await fetch(`${origin}/@browser-author/first`);
    expect(named.status).toBe(200);
    const html = await named.text();
    expect(html).toContain(fixture.title);
    expect(html).toContain(`content="${origin}/@browser-author/first"`);
    await page.keyboard.press('Escape');
    await page.getByLabel('Leave a little note').fill('Hello from an independent signed event.');
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await page.getByText('Hello from an independent signed event.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '0 likes', exact: true }).click();
    await page.getByRole('button', { name: '1 like', exact: true }).waitFor();
    await page.getByRole('button', { name: '1 like', exact: true }).click();
    await page.getByRole('button', { name: '0 likes', exact: true }).waitFor();
    await page.getByRole('button', { name: '0 likes', exact: true }).click();
    await page.getByRole('button', { name: '1 like', exact: true }).waitFor();
    const commentLike = page.getByRole('button', { name: /^Like comment by/ }).first();
    await commentLike.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label^="Like comment by"]')?.getAttribute('aria-pressed') ===
        'true',
    );
    expect(await commentLike.textContent()).toContain('1');
    await commentLike.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label^="Like comment by"]')?.getAttribute('aria-pressed') ===
        'false',
    );
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByLabel('Your reply').fill('A reply in the same thread.');
    await page.getByRole('button', { name: 'Post reply', exact: true }).click();
    await page.getByText('A reply in the same thread.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await page.getByText('Comment deleted by its author.').waitFor();
    await page.getByRole('button', { name: 'Remix this', exact: true }).click();
    expect(await page.locator('.remix-command').count()).toBe(2);
    expect(await page.locator('.remix-command').first().textContent()).toContain('sh -s -- remix');
    expect(await page.locator('.remix-command').first().textContent()).toContain('--network local');
    expect(await page.locator('.remix-command').first().textContent()).toContain(
      `/r/${fixture.snapshot.id}`,
    );
    await page.keyboard.press('Escape');
    const state = await (await fetch(`${origin}/api/social?reference=${fixture.naddr}`)).json();
    expect(state.likeCount).toBe(1);
    expect(state.comments).toHaveLength(2);
    expect(state.comments[0].deleted).toBe(true);
    expect([...events.values()].filter((e) => e.kind === 1111)).toHaveLength(2);
    expect([...events.values()].filter((e) => e.kind === 7)).toHaveLength(3);
    expect(rejected).toBe(0);
    // Wallet UI is simulated; no invoice provider or wallet receives a real request.
    let invoiceRequests = 0;
    const fakeEndpoint = {
      pubkey: fixture.pubkey,
      lnurl: 'lnurl1fixture',
      callback: 'https://wallet.example/callback',
      nostrPubkey: fixture.pubkey,
      minSendable: 1000,
      maxSendable: 1000000,
      commentAllowed: 100,
    };
    await page.route('**/api/social?*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const value = await response.json();
      await route.fulfill({ response, json: { ...value, relays: ['wss://relay.example'] } });
    });
    await page.route('**/api/zaps?*', async (route) => {
      if (route.request().method() === 'POST') {
        const event = verifiedEvent(route.request().postDataJSON());
        expect(event.kind).toBe(9734);
        expect(event.pubkey).toBe(fixture.pubkey);
        expect(event.tags).toContainEqual(['amount', '21000']);
        const commentId = new URL(route.request().url()).searchParams.get('comment');
        if (commentId) {
          expect(event.tags).toContainEqual(['e', commentId]);
          expect(event.tags).toContainEqual(['k', '1111']);
          expect(event.tags.some((t) => t[0] === 'a')).toBe(false);
        }
        invoiceRequests++;
        return route.fulfill({
          json: {
            invoice: 'lnbc1test-only-never-pay',
            msats: 21000,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        });
      }
      await route.fulfill({ json: { endpoint: fakeEndpoint, receipts: [], msats: 0 } });
    });
    await page.evaluate(() => {
      (window as any).testPayments = [];
      (window as any).webln = {
        enable: async () => {},
        sendPayment: async (invoice: string) => {
          (window as any).testPayments.push(invoice);
          return { preimage: 'test-only' };
        },
      };
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Conversation refreshed.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Zap', exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).waitFor();
    expect(invoiceRequests).toBe(0);
    await page.getByRole('button', { name: 'Create zap invoice', exact: true }).click();
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).waitFor();
    expect(invoiceRequests).toBe(1);
    expect(await page.evaluate(() => (window as any).testPayments.length)).toBe(0);
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).click();
    await page.getByText(/Your wallet reports payment sent/).waitFor();
    expect(await page.evaluate(() => (window as any).testPayments)).toEqual([
      'lnbc1test-only-never-pay',
    ]);
    expect([...events.values()].some((e) => e.kind === 9734)).toBe(false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Zap comment', exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create zap invoice', exact: true }).click();
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).waitFor();
    expect(invoiceRequests).toBe(2);
    expect(await page.evaluate(() => (window as any).testPayments.length)).toBe(1);
    await page.keyboard.press('Escape');
    await mkdir(join(root, '.local/community-check'), { recursive: true });
    await page.locator('.social-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, '.local/community-check/desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.social-panel').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: join(root, '.local/community-check/mobile.png') });
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
