import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommand } from '../../apps/web/src/lib/creator-commands';
import { walkthrough } from '../../apps/web/src/lib/creator-walkthrough';

test('hero onboarding works without sign-in, fits the initial viewport and loads video only on demand', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-onboarding-'));
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => server.kill(), 45000);
  const browser = await chromium.launch();
  try {
    let output = '',
      origin = '';
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    expect(origin).not.toBe('');
    origin = new URL(origin).origin;
    await mkdir('.local/onboarding', { recursive: true });
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await nojs.newPage();
    await staticPage.goto(origin);
    await browserExpect(staticPage.locator('.hero code')).toHaveText(createCommand());
    await browserExpect(staticPage.locator('.hero')).toContainText('No website account needed.');
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [1365, 900],
    ]) {
      await staticPage.setViewportSize({ width, height });
      const command = await staticPage.locator('.hero .terminal-box').boundingBox();
      expect(
        command!.y + command!.height,
        `command below fold at ${width}x${height}`,
      ).toBeLessThanOrEqual(height);
      expect(
        await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      const copy = await staticPage
        .getByRole('button', { name: 'Copy starter command' })
        .boundingBox();
      const chevron = await staticPage.locator('.terminal-chevron').boundingBox();
      expect(copy!.x).toBeGreaterThan(chevron!.x + chevron!.width);
      await staticPage.screenshot({ path: `.local/onboarding/hero-${width}.png` });
    }
    await staticPage.locator('summary').filter({ hasText: 'napplet soyLI' }).press('Enter');
    await browserExpect(staticPage.locator('.hero video')).toBeVisible();
    await browserExpect(staticPage.locator('.walkthrough-steps')).toContainText('Nostr identity');
    await browserExpect(staticPage.locator('.walkthrough-steps li')).toHaveCount(5);
    await nojs.close();

    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const media: string[] = [],
      errors: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.mp4')) media.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).copiedCommand = text;
          },
        },
      });
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Copy starter command' }).click();
    await browserExpect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).copiedCommand)).toBe(createCommand());
    expect(media).toHaveLength(0);
    await browserExpect(page.locator('.hero details')).not.toHaveAttribute('open');
    await page.locator('.hero summary').press('Enter');
    const video = page.locator('video');
    await browserExpect(video).toBeVisible();
    await browserExpect(page.locator('.terminal-box noscript')).toHaveCount(0);
    await browserExpect(page.locator('.terminal-box')).not.toContainText('<div class=');
    expect(
      await video.evaluate(
        (element: HTMLVideoElement) =>
          element.autoplay && element.muted && element.playsInline && !element.loop,
      ),
    ).toBe(true);
    await browserExpect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    expect(media.length).toBeGreaterThan(0);
    expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBe(30);
    await browserExpect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length),
      )
      .toBe(5);
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 25;
    });
    await browserExpect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThanOrEqual(25);
    await page.locator('.hero summary').press('Enter');
    await browserExpect(page.locator('video')).toHaveCount(0);
    await browserExpect(page.locator('.hero summary')).toBeFocused();
    await page.locator('.hero summary').press('Enter');
    await browserExpect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(
      10,
    );
    await browserExpect(page.locator('.walkthrough-steps li')).toHaveCount(5);
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: '.local/onboarding/video-desktop.png', fullPage: true });
    await page.locator('.hero summary').press('Enter');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error('unavailable');
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Copy starter command' }).click();
    await browserExpect(
      page.getByRole('status').filter({ hasText: 'copy it manually' }),
    ).toBeVisible();
    await page.goto(origin + '/create?template=tiny-tennis');
    await browserExpect(page.locator('.terminal-box code').first()).toHaveText(
      createCommand('tiny-tennis'),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin);
    await page.locator('.hero summary').press('Enter');
    await browserExpect(video).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.local/onboarding/video-mobile.png' });
    expect(errors).toEqual([]);
    const captions = await fetch(origin + walkthrough.captions);
    expect(captions.status).toBe(200);
    expect(captions.headers.get('content-type')).toContain('text/vtt');
    expect(await captions.text()).toContain('00:00:24.000 --> 00:00:30.000');
    const bytes = await Bun.file('apps/web/public/walkthrough/creator.mp4').bytes();
    const head = await fetch(origin + walkthrough.video, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    for (const [range, expected] of [
      ['bytes=0-31', bytes.slice(0, 32)],
      ['bytes=-16', bytes.slice(-16)],
      [`bytes=${bytes.length - 8}-`, bytes.slice(-8)],
    ] as const) {
      const response = await fetch(origin + walkthrough.video, { headers: { Range: range } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toContain('video/mp4');
      expect(await response.bytes()).toEqual(expected);
    }
    for (const range of [
      'bytes=999999999999999999999-',
      'bytes=-0',
      'bytes=7-3',
      'bytes=0-1,3-4',
      'bytes=-',
    ]) {
      const response = await fetch(origin + walkthrough.video, { headers: { Range: range } });
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
    }
    expect(
      (
        await fetch(origin + walkthrough.video, {
          headers: { Range: 'bytes=0-3', 'If-Range': 'old-version' },
        })
      ).status,
    ).toBe(200);
    expect(Bun.file('apps/web/public/walkthrough/creator.mp4').size).toBeLessThan(3 * 1024 * 1024);
    expect(Bun.file('apps/web/public/walkthrough/creator.webp').size).toBeLessThan(100 * 1024);
    await context.close();
  } finally {
    clearTimeout(timer);
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
