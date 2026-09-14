import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilter, type Filter } from 'nostr-tools';
import { aggregateHash, encodeAddress, sha256 } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';

test('cold portable links discover signed manifests, provide SSR OG and play inline without restarting on fullscreen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-cold-discovery-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const queries: Filter[] = [];
  const key = new Uint8Array(32);
  key[31] = 1;
  const bytes = new TextEncoder().encode(
    '<!doctype html><title>Cold arrival</title><button onclick="this.textContent=Number(this.textContent)+1">0</button>',
  );
  const hash = await sha256(bytes);
  const slowBytes = new TextEncoder().encode('<!doctype html><button>Slow arrival works</button>');
  const slowHash = await sha256(slowBytes);
  const blob = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === `/${slowHash}`) {
        await Bun.sleep(3200);
        return new Response(slowBytes);
      }
      return new URL(request.url).pathname === `/${hash}`
        ? new Response(bytes)
        : new Response(null, { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${blob.port}`;
  const manifests = Array.from({ length: 2 }, (_, i) =>
    finalizeEvent(
      {
        kind: 35129,
        created_at: Math.floor(Date.now() / 1000) - 2,
        content: '',
        tags: [
          ['d', `cold-${i}`],
          ['title', `Cold arrival ${i}`],
          ['description', 'Discovered only after following this link'],
          ['t', 'test'],
          ['path', '/index.html', hash],
          ['server', origin],
        ],
      },
      key,
    ),
  );
  const aggregate = await aggregateHash([{ path: '/index.html', hash }]);
  for (let i = 0; i < manifests.length; i++)
    manifests[i] = finalizeEvent(
      { ...manifests[i], tags: [...manifests[i].tags, ['x', aggregate, 'aggregate']] },
      key,
    );
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      return server.upgrade(request) ? undefined : new Response('test fixture');
    },
    websocket: {
      message(ws, data) {
        const [type, id, ...filters] = JSON.parse(String(data));
        if (type !== 'REQ') return;
        for (const filter of filters) {
          queries.push(filter);
          // This fixture deliberately does not answer bulk discovery. Only an exact lookup can find the events.
          if (filter['#d'] || filter.ids)
            for (const event of manifests)
              if (matchFilter(filter, event)) ws.send(JSON.stringify(['EVENT', id, event]));
        }
        ws.send(JSON.stringify(['EOSE', id]));
      },
    },
  });
  const env = {
    PATH: process.env.PATH!,
    SPACE_INDEX_DIR: join(directory, 'index'),
    SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}`,
    SPACE_INDEX_LOCAL_BLOSSOM: origin,
    SPACE_RELEASE_ID: 'cold-test',
    SPACE_SITE_ORIGIN: 'https://share.example',
  };
  try {
    // Initialize a genuinely empty persistent catalog before the HTTP process starts.
    new IndexStore(env.SPACE_INDEX_DIR, true).close();
    children.push(
      Bun.spawn([process.execPath, 'services/indexer/index.ts'], {
        cwd: resolve(import.meta.dir, '../..'),
        env,
        stdout: 'ignore',
        stderr: 'inherit',
      }),
    );
    const web = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      cwd: resolve(import.meta.dir, '../..'),
      env: { ...env, HOST: '127.0.0.1', PORT: '0' },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(web);
    const reader = web.stdout.getReader();
    let output = '',
      site = '';
    const timeout = setTimeout(() => web.kill(), 15000);
    try {
      while (!site) {
        const result = await reader.read();
        if (result.done) throw new Error('Web server exited');
        output += new TextDecoder().decode(result.value);
        site = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
      void (async () => {
        for await (const _ of web.stdout) {
        }
      })();
    }
    expect(await (await fetch(site)).text()).not.toContain('Cold arrival');
    for (let i = 0; i < manifests.length; i++) {
      const naddr = encodeAddress({
        kind: 35129,
        pubkey: manifests[i].pubkey,
        identifier: `cold-${i}`,
      });
      const response = await fetch(`${site}/n/${naddr}`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain(`property="og:title" content="Cold arrival ${i}"`);
      expect(html).toContain(`https://share.example/api/og/${manifests[i].id}`);
      const image = await fetch(`${site}/api/og/${manifests[i].id}`);
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/png');
    }
    expect(queries.some((q) => q['#d']?.includes('cold-0'))).toBe(true);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(site);
    await page.locator('.napplet-card').first().locator('.card-preview').click();
    await page.frameLocator('iframe').locator('button').click();
    expect(await page.locator('iframe').count()).toBe(1);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    expect(await frame.locator('button').textContent()).toBe('1');
    const scroll = await page.evaluate(() => scrollY);
    await page.getByLabel('Fullscreen', { exact: true }).click();
    await page.getByLabel('Exit fullscreen', { exact: true }).waitFor();
    expect(await frame.locator('button').textContent()).toBe('1');
    await page.getByLabel('Exit fullscreen', { exact: true }).click();
    expect(await frame.locator('button').textContent()).toBe('1');
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.locator('.napplet-card').nth(1).locator('.card-preview').click();
    await page.frameLocator('iframe').locator('button').waitFor();
    expect(await page.locator('iframe').count()).toBe(1);
    expect(await page.frameLocator('iframe').locator('button').textContent()).toBe('0');
    await page.getByLabel('Stop napplet', { exact: true }).click();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(errors).toEqual([]);
    await mkdir('.local/discovery-verification', { recursive: true });
    await page.screenshot({ path: '.local/discovery-verification/gallery.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.napplet-card').nth(1).locator('.card-preview').click();
    await page.frameLocator('iframe').locator('button').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: '.local/discovery-verification/mobile-playing.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(350);
    expect(await page.locator('iframe').count()).toBe(0);
    manifests.push(
      finalizeEvent(
        {
          ...manifests[0],
          tags: [
            ['d', 'cold-slow'],
            ['title', 'Slow arrival'],
            ['path', '/index.html', slowHash],
            ['server', origin],
            ['x', await aggregateHash([{ path: '/index.html', hash: slowHash }]), 'aggregate'],
          ],
        },
        key,
      ),
    );
    const slowAddress = encodeAddress({
      kind: 35129,
      pubkey: manifests[0].pubkey,
      identifier: 'cold-slow',
    });
    await page.getByLabel('Search napplets').fill(slowAddress);
    await page.getByLabel('Search napplets').press('Enter');
    await page.getByRole('heading', { name: 'Finding your napplet…', exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Start Slow arrival', exact: true })
      .waitFor({ timeout: 15000 });
    expect(queries.filter((q) => q['#d']?.includes('cold-slow'))).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    for (const child of children.reverse()) {
      child.kill();
      await child.exited;
    }
    relay.stop(true);
    blob.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
