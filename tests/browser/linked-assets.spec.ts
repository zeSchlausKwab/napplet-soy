import { test, expect, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string,
  origin: string,
  storageOrigin: string,
  server: ChildProcess,
  storage: ChildProcess;
let entry: {
  naddr: string;
  revisionId: string;
  preview: { hash: string; url: string };
  video: { hash: string; url: string };
};
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-linked-assets-'));
  storage = spawn('bun', ['tests/fixtures/linked-assets-server.ts', directory], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  storageOrigin = await listening(storage);
  entry = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
  await writeFile(
    join(directory, 'policy.json'),
    JSON.stringify({ version: 1, revision: 0, rules: [], audit: [], used: [] }),
  );
  server = spawn('bun', ['apps/web/server.ts'], {
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SPACE_PUBLICDEV: '1',
      SPACE_PUBLICDEV_DIR: directory,
      SPACE_SITE_ORIGIN: 'http://localhost',
      SPACE_MODERATION_FILE: join(directory, 'policy.json'),
      SPACE_INDEX_DIR: '',
      SPACE_INDEX_LOCAL_BLOSSOM: storageOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await listening(server);
});
function listening(child: ChildProcess) {
  return new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Asset test server did not start')), 10000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
    child.stdout!.on('data', (data) => {
      const match = String(data).match(/listening on (http:\/\/[^\s/]+)/);
      if (match) {
        clearTimeout(timer);
        accept(match[1]);
      }
    });
  });
}
test.afterAll(async () => {
  for (const child of [server, storage])
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill();
      await stopped;
    }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('linked assets open original storage URLs and play on desktop and mobile', async ({
  page,
  request,
  browser,
  context,
}) => {
  await storageMapping(context);
  const remote: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(origin)) remote.push(r.url());
  });
  await page.goto(`${origin}/n/${entry.naddr}`);
  const assets = page.getByRole('region', { name: 'Linked assets' });
  await expect(assets.getByRole('link')).toHaveCount(4);
  await assets.scrollIntoViewIfNeeded();
  const player = await page.locator('.player-slot').boundingBox();
  const bounds = await assets.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(player!.y + player!.height);
  const image = assets.getByRole('link', { name: 'Open preview image (new tab)', exact: true });
  const popupPromise = page.waitForEvent('popup');
  await image.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(entry.preview.url);
  await expect(assets.locator('img')).toHaveAttribute('src', entry.preview.url);
  await popup.close();
  const clip = assets.getByRole('link', { name: 'Open preview clip (new tab)', exact: true });
  const videoPopupPromise = page.waitForEvent('popup');
  await clip.click();
  const videoPopup = await videoPopupPromise;
  await videoPopup.waitForLoadState('domcontentloaded');
  const playerVideo = videoPopup.locator('video');
  await expect(playerVideo).toHaveCount(1);
  await playerVideo.evaluate((video: HTMLVideoElement) => {
    video.muted = true;
    video.play().catch(() => {});
  });
  await expect
    .poll(() => playerVideo.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 5000,
    })
    .toBeGreaterThan(0.3);
  await expect(videoPopup).toHaveURL(entry.video.url);
  await videoPopup.close();
  const clipResponse = await request.get(`${storageOrigin}${new URL(entry.video.url).pathname}`);
  expect(clipResponse.headers()['content-type']).toBe('video/webm');
  expect(await clipResponse.body()).toEqual(await readFile('tests/fixtures/preview.webm'));
  const archiveResponse = await request.get(
    (await assets
      .getByRole('link', { name: 'Open source archive (new tab)' })
      .getAttribute('href'))!,
  );
  expect(archiveResponse.status(), await archiveResponse.text()).toBe(200);
  const downloadPromise = page.waitForEvent('download');
  await assets.getByRole('link', { name: 'Open source archive (new tab)' }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(
    await readFile(join(directory, 'source/source.tar')),
  );
  await expect(
    assets.getByRole('link', { name: 'Open additional image 1 (new tab)' }),
  ).toHaveAttribute('href', 'https://images.example/another-screenshot.png');
  expect(
    remote.filter((url) => url !== entry.preview.url && !url.startsWith(storageOrigin)),
  ).toEqual([]);
  expect(
    await assets
      .getByRole('link')
      .evaluateAll((links) =>
        links.every((link) => !link.getAttribute('href')?.startsWith('/api/')),
      ),
  ).toBe(true);
  await assets.screenshot({ path: resolve('.local/linked-assets-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await assets.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(assets.getByRole('link', { name: 'Open source archive (new tab)' })).toBeVisible();
  await assets.screenshot({ path: resolve('.local/linked-assets-mobile.png') });
  await page.goto(`${origin}/n/${entry.naddr}/play`);
  await expect(assets).not.toBeVisible();
  const noJsContext = await browser.newContext({ javaScriptEnabled: false });
  await storageMapping(noJsContext);
  try {
    const noJs = await noJsContext.newPage();
    await noJs.goto(`${origin}/n/${entry.naddr}`);
    await expect(noJs.getByRole('region', { name: 'Linked assets' }).getByRole('link')).toHaveCount(
      4,
    );
  } finally {
    await noJsContext.close();
  }
});

test('original Blossom video plays in a native media tab', async ({ page }) => {
  for (const url of [`${storageOrigin}/${entry.video.hash}`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    await video.evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      element.play().catch(() => {});
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
        timeout: 5000,
      })
      .toBeGreaterThan(0.3);
  }
});

async function storageMapping(context: BrowserContext) {
  // Map the fixture's declared HTTPS origin to our real offline Blossom service.
  // Preserve its bytes, media headers and Range handling, including in new tabs.
  await context.route('https://images.example/**', async (route) => {
    const range = route.request().headers().range;
    const response = await context.request.get(
      `${storageOrigin}${new URL(route.request().url()).pathname}`,
      {
        headers: range ? { Range: range } : {},
      },
    );
    await route.fulfill({ response });
  });
}

test('independent Nostr and Blossom supply playback, comments, profile and source without protocol APIs', async ({
  page,
  context,
}) => {
  await storageMapping(context);
  const relay = JSON.parse(await readFile(join(directory, 'relay.json'), 'utf8'));
  await context.addInitScript(
    ({ relay, blossom }) => {
      localStorage.setItem(
        'napplet:network',
        JSON.stringify({ relays: [relay], blossom: [blossom] }),
      );
    },
    { relay: relay.url, blossom: storageOrigin },
  );
  const forbidden: string[] = [];
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/(og\/|profile-og|names|admin|health|publications)/.test(path))
      return route.continue();
    forbidden.push(path);
    return route.abort();
  });
  const wire: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => wire.push(String(frame.payload))),
  );
  const downloads: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(storageOrigin)) downloads.push(r.url());
  });
  await page.goto(`${origin}/n/${entry.naddr}`);
  await expect(
    page.getByText('A comment read directly from the relay.', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: 'Independent creator' }).first()).toBeVisible();
  await page.locator('.player-cover').click();
  await expect(page.locator('iframe[title="Linked preview test"]')).toBeVisible();
  await expect.poll(() => downloads.some((url) => /\/[a-f0-9]{64}$/.test(url))).toBe(true);
  await page.getByRole('link', { name: 'Browse source' }).click();
  await expect(page.getByText('# Linked assets fixture', { exact: false }).last()).toBeVisible({
    timeout: 15000,
  });
  expect(downloads.some((url) => url.endsWith('.tar'))).toBe(true);
  expect(wire.some((frame) => frame.includes('"REQ"') && frame.includes('1111'))).toBe(true);
  expect(wire.some((frame) => frame.includes('"EVENT"') || frame.includes('"AUTH"'))).toBe(false);
  expect(forbidden).toEqual([]);
});
