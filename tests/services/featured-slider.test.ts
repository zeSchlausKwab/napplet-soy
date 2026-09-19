import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';

test('featured slides support touch, keyboard, motion preferences and portable fullscreen card links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'featured-slider-'));
  const index = new IndexStore(join(directory, 'index'), true);
  const manifests = fixtures.slice(0, 3).map((n, i) => (i === 2 ? n.snapshot : n.current));
  for (const manifest of manifests) {
    index.admit(manifest);
    const entry = await publicNapplet(manifest, []);
    index.project(
      manifest.id,
      { ...entry, availability: 'ready' },
      Date.now() + 60000,
      Date.now() + 60000,
    );
  }
  index.close();
  await Bun.write(
    join(directory, 'policy.json'),
    JSON.stringify({
      version: 1,
      revision: 0,
      rules: [],
      admins: [],
      audit: [],
      used: [],
      featured: manifests.map((event) => ({
        type: 'event',
        target: event.id,
        actor: event.pubkey,
        reason: 'Local fixture',
        at: 0,
      })),
    }),
  );
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_MODERATION_FILE: join(directory, 'policy.json'),
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
    const context = await browser.newContext({ viewport: { width: 1365, height: 1200 } });
    await context.routeWebSocket(/wss?:\/\//, (route) => route.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const slides = page.locator('.featured-slide');
    const slider = page.locator('.featured-slider');
    await ui(slides).toHaveCount(3);
    await ui(slides.nth(0)).not.toHaveAttribute('inert');
    await ui(slides.nth(1)).toHaveAttribute('inert');
    await ui(page.getByRole('button', { name: 'Pause featured rotation' })).toBeVisible();
    await ui(slides.nth(1)).not.toHaveAttribute('inert', { timeout: 9000 });
    await ui
      .poll(() => slider.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth)))
      .toBeLessThan(2);
    await page.getByRole('button', { name: 'Previous featured napplet' }).click();
    await ui.poll(() => slider.evaluate((el) => el.scrollLeft)).toBeLessThan(2);
    await slider.evaluate((el) => {
      (window as any).slideSamples = [];
      let remaining = 45;
      const sample = () => {
        (window as any).slideSamples.push(el.scrollLeft / el.clientWidth);
        if (--remaining) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Next featured napplet' }).click();
    await ui(slides.nth(1)).not.toHaveAttribute('inert');
    await ui
      .poll(() => slider.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth)))
      .toBeLessThan(2);
    await ui(page.getByRole('button', { name: 'Resume featured rotation' })).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).slideSamples.some((position: number) => position > 0.01 && position < 0.99),
      ),
    ).toBe(true);
    await page.screenshot({ path: '.local/featured-slider-desktop.png' });
    await slider.focus();
    await slider.press('ArrowRight');
    await ui
      .poll(() => slider.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth * 2)))
      .toBeLessThan(2);
    await slider.press('ArrowRight');
    await ui.poll(() => slider.evaluate((el) => el.scrollLeft)).toBeLessThan(2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Next featured napplet' }).click();
    expect(await slider.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(2);
    await ui(page.getByRole('button', { name: 'Resume featured rotation' })).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 1000 });
    await ui
      .poll(() => slider.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth)))
      .toBeLessThan(2);
    const cards = page.locator('.napplet-collection .napplet-card');
    await ui(cards).toHaveCount(3);
    for (const [i, event] of manifests.entries()) {
      const title = fixtures[i].title;
      const card = cards.filter({
        has: page.locator('.card-heading').getByRole('link', { name: title, exact: true }),
      });
      const path = i === 2 ? `/r/${event.id}` : `/n/${fixtures[i].naddr}`;
      await ui(card.getByRole('link', { name: `Open ${title} fullscreen` })).toHaveAttribute(
        'href',
        path + '/play',
      );
      await ui(
        card.locator('.card-heading').getByRole('link', { name: title, exact: true }),
      ).toHaveAttribute('href', path);
    }
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await mobile.routeWebSocket(/wss?:\/\//, (route) => route.close());
    const phone = await mobile.newPage();
    await phone.goto(origin);
    const track = phone.locator('.featured-slider');
    await track.scrollIntoViewIfNeeded();
    const box = (await track.boundingBox())!;
    const cdp = await mobile.newCDPSession(phone);
    const y = box.y + Math.min(80, box.height / 2);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width * 0.85, y }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: box.x + box.width * (0.85 - step * 0.08), y }],
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ui
      .poll(() => track.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth)))
      .toBeLessThan(2);
    await ui(phone.locator('.featured-slide').nth(1)).not.toHaveAttribute('inert');
    await phone.screenshot({ path: '.local/featured-slider-mobile.png' });
    expect(new URL(phone.url()).pathname).toBe('/'); // Swiping must not activate the preview link.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    clearTimeout(timer);
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
