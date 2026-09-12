import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string, origin: string, server: ChildProcess;
let entry: { title: string; naddr: string; revisionId: string; preview: { hash: string } };
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-preview-browser-'));
  execFileSync('bun', ['tests/fixtures/linked-preview.ts', directory]);
  entry = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
  server = spawn('bun', ['apps/web/server.ts'], {
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SPACE_PUBLICDEV: '1',
      SPACE_PUBLICDEV_DIR: directory,
      SPACE_SITE_ORIGIN: 'http://localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview test server did not start')), 10000);
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
    server.stdout!.on('data', (data) => {
      const match = String(data).match(/listening on (http:\/\/[^\s/]+)\/?/);
      if (match) {
        clearTimeout(timer);
        accept(match[1]);
      }
    });
  });
});
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()));
    server.kill();
    await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('linked screenshot appears in gallery, player cover and SSR sharing without third-party image requests', async ({
  page,
  request,
  browser,
}) => {
  const remote: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && /^https?:/.test(r.url())) remote.push(r.url());
  });
  await page.goto(`${origin}/?category=public`);
  const image = page.locator('.card-preview img');
  await expect(image).toHaveAttribute(
    'src',
    `/api/previews/${entry.revisionId}?v=${entry.preview.hash}`,
  );
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(960);
  await page.getByRole('link', { name: `Play ${entry.title}`, exact: true }).click();
  const cover = page.locator('.player-cover img');
  await expect(cover).toHaveAttribute(
    'src',
    `/api/previews/${entry.revisionId}?v=${entry.preview.hash}`,
  );
  await page.screenshot({ path: resolve('.local/linked-preview-browser.png') });
  await page.getByRole('button', { name: `Start ${entry.title}` }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  expect(remote).toEqual([]);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noJs = await context.newPage();
    await noJs.goto(`${origin}/n/${entry.naddr}`);
    await expect(noJs.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      new RegExp(`cover=${entry.preview.hash}`),
    );
    expect(
      (await request.get(`${origin}/api/og/${entry.revisionId}`)).headers()['content-type'],
    ).toBe('image/png');
  } finally {
    await context.close();
  }
});
