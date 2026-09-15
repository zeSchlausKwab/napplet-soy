import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string, origin: string, server: ChildProcess, storage: Server;
let entry: {
  naddr: string;
  revisionId: string;
  preview: { hash: string };
  video: { hash: string };
};
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-linked-assets-'));
  storage = createServer(async (_req, res) => {
    try {
      res.end(await readFile(join(directory, 'source/source.tar')));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => storage.listen(0, '127.0.0.1', done));
  const address = storage.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP storage');
  const storageOrigin = `http://127.0.0.1:${address.port}`;
  execFileSync('bun', ['tests/fixtures/linked-preview.ts', directory, 'assets'], {
    env: { ...process.env, FIXTURE_ASSET_ORIGIN: storageOrigin },
  });
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
  origin = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Asset test server did not start')), 10000);
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
    server.stdout!.on('data', (data) => {
      const match = String(data).match(/listening on (http:\/\/[^\s/]+)/);
      if (match) {
        clearTimeout(timer);
        accept(match[1]);
      }
    });
  });
});
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((done) => server.once('exit', () => done()));
    server.kill();
    await stopped;
  }
  if (storage) await new Promise<void>((done) => storage.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('linked assets work below the player on desktop and mobile, without automatic external loads', async ({
  page,
  request,
  browser,
}) => {
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
  await expect(popup).toHaveURL(
    `${origin}/api/previews/${entry.revisionId}?v=${entry.preview.hash}`,
  );
  await popup.close();
  const clip = assets.getByRole('link', { name: 'Open preview clip (new tab)', exact: true });
  const clipResponse = await request.get(`${origin}${await clip.getAttribute('href')}`);
  expect(clipResponse.headers()['content-type']).toBe('video/webm');
  expect(await clipResponse.body()).toEqual(await readFile('tests/fixtures/preview.webm'));
  const archiveResponse = await request.get(
    `${origin}${await assets.getByRole('link', { name: 'Download source archive' }).getAttribute('href')}`,
  );
  expect(archiveResponse.status(), await archiveResponse.text()).toBe(200);
  const downloadPromise = page.waitForEvent('download');
  await assets.getByRole('link', { name: 'Download source archive' }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(
    await readFile(join(directory, 'source/source.tar')),
  );
  await expect(
    assets.getByRole('link', { name: 'Open additional image 1 (new tab)' }),
  ).toHaveAttribute('href', 'https://images.example/another-screenshot.png');
  expect(remote).toEqual([]);
  await assets.screenshot({ path: resolve('.local/linked-assets-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await assets.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(assets.getByRole('link', { name: 'Download source archive' })).toBeVisible();
  await assets.screenshot({ path: resolve('.local/linked-assets-mobile.png') });
  await page.goto(`${origin}/n/${entry.naddr}/play`);
  await expect(assets).not.toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noJs = await context.newPage();
    await noJs.goto(`${origin}/n/${entry.naddr}`);
    await expect(noJs.getByRole('region', { name: 'Linked assets' }).getByRole('link')).toHaveCount(
      4,
    );
  } finally {
    await context.close();
  }
});
