import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string, origin: string, server: ChildProcess;
let entry: { title: string; naddr: string; revisionId: string; preview: { hash: string } };
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-preview-browser-'));
  execFileSync('bun', ['tests/fixtures/linked-preview.ts', directory, 'without-preview']);
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

test('generated player poster stays wholly visible at desktop and phone sizes', async ({
  page,
}) => {
  for (const width of [1365, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/n/${entry.naddr}`);
    const cover = page.locator('.player-cover img');
    await expect
      .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    const bounds = await cover.evaluate((image: HTMLImageElement) => {
      const box = image.getBoundingClientRect();
      const fit = getComputedStyle(image).objectFit;
      const scale = (fit === 'contain' ? Math.min : Math.max)(
        box.width / image.naturalWidth,
        box.height / image.naturalHeight,
      );
      return {
        width: image.naturalWidth * scale,
        height: image.naturalHeight * scale,
        boxWidth: box.width,
        boxHeight: box.height,
      };
    });
    expect(bounds.width).toBeLessThanOrEqual(bounds.boxWidth + 1);
    expect(bounds.height).toBeLessThanOrEqual(bounds.boxHeight + 1);
  }
});
