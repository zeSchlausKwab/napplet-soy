import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { IndexStore } from '../../packages/backend/src/index-store';
import { indexPreviewVideos } from '../../packages/backend/src/preview-videos';
import fixtures from '../../packages/backend/data/catalog.json';

test('gallery clips load on intent, stop offscreen, honor reduced motion and leave OG static', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soyli-video-gallery-'));
  const root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1;
  const bytes = await Bun.file(join(root, 'tests/fixtures/preview.webm')).bytes(),
    hash = await sha256(bytes);
  const url = `https://media.example/${hash}.webm`;
  const at = Math.floor(Date.now() / 1000);
  const descriptor = finalizeEvent(
    {
      kind: 32267,
      created_at: at,
      content: url,
      tags: [
        ['d', 'clip'],
        ['imeta', `url ${url}`, 'm video/webm', `x ${hash}`],
      ],
    },
    key,
  );
  const current = finalizeEvent(
    {
      kind: 35129,
      created_at: at,
      content: '',
      tags: [
        ...fixtures[0].current.tags.filter((t) => !['app', 'd', 'title'].includes(t[0])),
        ['d', 'video-demo'],
        ['title', 'Video demo'],
        ['app', `32267:${descriptor.pubkey}:clip`, 'wss://relay.example'],
      ],
    },
    key,
  );
  const entry = await publicNapplet(current);
  await indexPreviewVideos(
    join(directory, 'index'),
    [entry],
    [descriptor],
    AbortSignal.timeout(3000),
    { download: async () => bytes },
  );
  expect(entry.video?.hash).toBe(hash);
  const store = new IndexStore(join(directory, 'index'), true);
  store.admit(current);
  await Bun.write(
    join(directory, 'index/artifacts', `${entry.artifactHash}.html`),
    Bun.file(join(root, 'packages/backend/data/artifacts', `${entry.artifactHash}.html`)),
  );
  store.project(
    current.id,
    { ...entry, availability: 'ready' },
    Date.now() + 3600000,
    Date.now() + 3600000,
  );
  store.close();
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response();
    },
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of [current, descriptor])
            if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}/`,
      SPACE_PUBLICDEV: '0',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'ignore',
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
    const page = await browser.newPage({
      viewport: { width: 1365, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let videoRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/preview-videos/')) videoRequests++;
    });
    await page.goto(origin);
    const cover = page.locator('.napplet-grid .card-cover'),
      video = cover.locator('video');
    await cover.scrollIntoViewIfNeeded();
    await cover.hover();
    await page.waitForTimeout(300);
    expect(videoRequests).toBe(0);
    expect(await page.locator('iframe').count()).toBe(0);
    await cover.getByRole('button', { name: 'Preview clip for Video demo' }).click();
    await browserExpect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused))
      .toBe(true);
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    expect(await page.locator('iframe').count()).toBe(0);
    await mkdir('.local/video-preview', { recursive: true });
    await page.screenshot({ path: '.local/video-preview/gallery.png' });
    // Moving away pauses and releases the decoded media.
    await page.mouse.move(0, 0);
    await browserExpect(video).not.toHaveAttribute('src');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await cover.hover();
    await browserExpect
      .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2))
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await browserExpect(video).not.toHaveAttribute('src');
    const previewResponse = await fetch(`${origin}/api/preview-videos/${current.id}`, {
      headers: { Range: 'bytes=0-19' },
    });
    expect(previewResponse.status).toBe(206);
    expect(await previewResponse.bytes()).toEqual(bytes.slice(0, 20));
    expect((await fetch(`${origin}/api/og/${current.id}`)).headers.get('content-type')).toContain(
      'image/png',
    );
    await cover.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.local/video-preview/gallery-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
