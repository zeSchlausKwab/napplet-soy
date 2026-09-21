import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { browserCache, browserEngine } from '../../apps/cli/src/browser';
import records from '../../packages/backend/data/catalog.json';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { matchFilters } from 'nostr-tools';

// Run after bun run build. Uses the shipped app, not the standalone preview server.
test('homepage ships the interactive story with real curation, mobile controls and clean navigation', async () => {
  const root = resolve(import.meta.dir, '../..');
  const temporary = await mkdtemp(join(tmpdir(), 'soy-story-'));
  const evidence = join(root, '.local/story-review');
  await mkdir(evidence, { recursive: true });
  const policy = join(temporary, 'policy.json');
  const catalog = join(temporary, 'catalog');
  await Bun.write(
    join(catalog, 'catalog.json'),
    JSON.stringify({
      version: 2,
      fetchedAt: Date.now(),
      relays: [],
      rejected: 0,
      entries: await Promise.all(
        records.map(async (n) => ({
          ...(await publicNapplet(n.current)),
          availability: 'ready',
          bytes: n.bytes,
        })),
      ),
    }),
  );
  await Bun.write(
    policy,
    JSON.stringify({
      version: 1,
      revision: 1,
      rules: [],
      audit: [],
      used: [],
      admins: [],
      featured: records.slice(0, 2).map((n) => ({
        type: 'address',
        target: `35129:${n.pubkey}:${n.identifier}`,
        reason: 'Browser fixture',
        actor: n.pubkey,
        at: 1,
      })),
    }),
  );
  const web = Bun.spawn([process.execPath, join(root, 'apps/web/server.ts')], {
    cwd: temporary,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_MODERATION_FILE: policy,
      SPACE_PUBLICDEV: '1',
      SPACE_PUBLICDEV_DIR: catalog,
      SPACE_COMMUNITY_DIR: join(temporary, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
  const { chromium } = await browserEngine();
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const timeout = setTimeout(() => web.kill(), 100_000);
  try {
    const reader = web.stdout.getReader();
    let site = '',
      output = '';
    try {
      while (!site) {
        const next = await reader.read();
        if (next.done) throw new Error(`Web server exited: ${output}`);
        output += new TextDecoder().decode(next.value);
        site = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
      }
    } finally {
      reader.releaseLock();
    }
    const html = await (await fetch(site)).text();
    expect(html).toContain('A little idea branches out.');
    expect(html).toContain('/api/og/site?v=4');
    expect(html).not.toContain('localhost:4191');
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
        reducedMotion: 'no-preference',
      });
      // No public queries/publications needed to exercise the landing presentation.
      await context.routeWebSocket('**/*', (ws) =>
        ws.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          if (message[0] === 'REQ') {
            for (const { current } of records)
              if (matchFilters(message.slice(2), current))
                ws.send(JSON.stringify(['EVENT', message[1], current]));
            ws.send(JSON.stringify(['EOSE', message[1]]));
          }
        }),
      );
      const page = await context.newPage();
      const errors: string[] = [],
        media: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (r) => {
        if (/\/story\/.*\.(m4a|mp4)/.test(r.url())) media.push(r.url());
      });
      await page.goto(site);
      await page.locator('.featured-hero').waitFor();
      expect(await page.locator('.featured-slide').count()).toBe(2);
      expect(await page.locator('.featured-slide').first().textContent()).toContain(
        records[0].title,
      );
      const layout = await page.evaluate(() => {
        const hero = document.querySelector('.hero')!.getBoundingClientRect();
        const copy = document.querySelector('.hero-main')!.getBoundingClientRect();
        const feature = document.querySelector('.featured-hero')!.getBoundingClientRect();
        const story = document.querySelector('#story')!.getBoundingClientRect();
        const browse = document.querySelector('#explore')!.getBoundingClientRect();
        return {
          ordered: hero.bottom <= story.top && story.bottom <= browse.top,
          gap: feature.left - copy.right,
          width: feature.width,
          stacked: feature.top >= copy.bottom,
        };
      });
      expect(layout.ordered).toBe(true);
      if (mobile) expect(layout.stacked).toBe(true);
      else {
        expect(layout.width).toBeGreaterThan(500);
        expect(layout.gap).toBe(48);
      }
      await page.screenshot({ path: join(evidence, `hero-${mobile ? 'mobile' : 'desktop'}.png`) });
      await page.locator('.story-cinema').scrollIntoViewIfNeeded();
      await page.locator('iframe.ready').waitFor();
      const frame = await (await page
        .locator('.story-cinema iframe')
        .elementHandle())!.contentFrame();
      expect(frame).toBeTruthy();
      await frame!.waitForFunction(() => window.spatialProof?.state().time > 0.15);
      const initial = await frame!.evaluate(() => window.spatialProof.state());
      expect(initial.playing && initial.muted && !initial.audioPlaying).toBe(true);
      expect(initial.triangles).toBeGreaterThan(100);
      expect(media).toHaveLength(0);
      const size = await page.locator('.story-cinema').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          width: rect.width,
          expectedWidth: document.documentElement.clientWidth,
          height: rect.height,
          expectedHeight: Math.max(281.6, Math.min(innerWidth * 0.45 + 25.6, innerHeight * 0.736)),
        };
      });
      expect(Math.abs(size.x)).toBeLessThan(1);
      expect(size.width).toBe(size.expectedWidth);
      expect(Math.abs(size.height - size.expectedHeight)).toBeLessThan(1);
      await frame!.getByRole('button', { name: 'Pause story', exact: true }).click();
      const slider = frame!.getByRole('slider', { name: 'Story position' });
      await slider.focus();
      await slider.press('End');
      expect((await frame!.evaluate(() => window.spatialProof.state())).time).toBe(30);
      await slider.press('Home');
      await slider.press('ArrowRight');
      expect((await frame!.evaluate(() => window.spatialProof.state())).time).toBe(0.01);
      const bounds = (await slider.boundingBox())!;
      const y = bounds.y + bounds.height / 2;
      if (mobile) {
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: bounds.x + bounds.width * 0.2, y }],
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: bounds.x + bounds.width * 0.6, y }],
        });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(bounds.x + bounds.width * 0.2, y);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.6, y, { steps: 8 });
        await page.mouse.up();
      }
      const scrub = await frame!.evaluate(() => window.spatialProof.state());
      expect(scrub.time).toBeGreaterThan(17);
      expect(scrub.time).toBeLessThan(19);
      expect(scrub.playing).toBe(false);
      await frame!.evaluate(() => window.spatialProof.at(321));
      const before = await frame!.locator('#scene').screenshot();
      await frame!.locator('#scene').hover({ position: { x: 30, y: 40 } });
      await page.waitForTimeout(500);
      expect(before.equals(await frame!.locator('#scene').screenshot())).toBe(mobile);
      expect((await frame!.evaluate(() => window.spatialProof.state())).time).toBe(10.7);
      await page.screenshot({ path: join(evidence, `story-${mobile ? 'mobile' : 'desktop'}.png`) });
      await frame!.getByRole('button', { name: 'Sound off', exact: true }).click();
      await frame!.getByRole('button', { name: 'Watch the story', exact: true }).click();
      await frame!.waitForFunction(
        () =>
          window.spatialProof.state().audioTime > 10.9 && window.spatialProof.state().audioPlaying,
      );
      const audible = await frame!.evaluate(() => window.spatialProof.state());
      expect(Math.abs(audible.time - audible.audioTime)).toBeLessThan(0.15);
      expect(media).toHaveLength(1);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await frame!.waitForFunction(() => window.spatialProof.state().suspended);
      const paused = await frame!.evaluate(() => window.spatialProof.state());
      await page.waitForTimeout(100);
      expect((await frame!.evaluate(() => window.spatialProof.state())).time).toBe(paused.time);
      expect(paused.audioPlaying).toBe(false);
      await page.locator('.story-cinema').scrollIntoViewIfNeeded();
      await frame!.waitForFunction((at) => window.spatialProof.state().time > at, paused.time);
      await frame!.getByRole('button', { name: 'Pause story', exact: true }).click();
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.locator('.story-cinema').scrollIntoViewIfNeeded();
      expect((await frame!.evaluate(() => window.spatialProof.state())).playing).toBe(false);
      await page.getByRole('button', { name: 'Explore the tree' }).click();
      expect((await frame!.evaluate(() => window.spatialProof.state())).overview).toBe(true);
      await frame!.evaluate(() => window.spatialProof.at(900));
      await frame!.getByRole('button', { name: 'PRESS START', exact: true }).click();
      if (mobile) await frame!.getByRole('button', { name: 'Shoot', exact: true }).tap();
      else await frame!.locator('#play-canvas').press('x');
      await frame!.waitForFunction(() => (window.spatialProof.state().game?.shots ?? 0) > 0);
      await page.screenshot({ path: join(evidence, `game-${mobile ? 'mobile' : 'desktop'}.png`) });
      const closeBounds = (await frame!
        .getByRole('button', { name: 'Back to the tree' })
        .boundingBox())!;
      expect(closeBounds.y).toBeGreaterThanOrEqual(0);
      await frame!.getByRole('button', { name: 'Back to the tree' }).click({ timeout: 3000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // Capture disposal before React detaches the iframe, then navigate through the actual router.
      await page.evaluate(() => {
        const child =
          document.querySelector<HTMLIFrameElement>('.story-cinema iframe')!.contentWindow!;
        const dispose = child.spatialProof.dispose;
        child.spatialProof.dispose = () => {
          dispose();
          document.documentElement.dataset.storyDisposed = String(
            child.spatialProof.state().disposed,
          );
        };
      });
      await page.locator('.hero-links a[href="/docs"]').click();
      await page.waitForURL('**/docs');
      await page.locator('.story-cinema').waitFor({ state: 'detached' });
      expect(await page.locator('.story-cinema').count()).toBe(0);
      expect(await page.locator('html').getAttribute('data-story-disposed')).toBe('true');
      await page.getByRole('link', { name: 'napplet.soy home' }).click();
      await page.locator('.story-cinema').scrollIntoViewIfNeeded();
      await page.locator('iframe.ready').waitFor();
      const returned = await (await page
        .locator('.story-cinema iframe')
        .elementHandle())!.contentFrame();
      expect((await returned!.evaluate(() => window.spatialProof.state())).muted).toBe(true);
      expect(errors).toEqual([]);
      await context.close();
    }
    const reduced = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await reduced.goto(site);
    await reduced.locator('.story-cinema').scrollIntoViewIfNeeded();
    await reduced.locator('iframe.ready').waitFor();
    const frame = await (await reduced
      .locator('.story-cinema iframe')
      .elementHandle())!.contentFrame();
    expect((await frame!.evaluate(() => window.spatialProof.state())).time).toBe(0);
    await frame!.getByRole('button', { name: 'Watch the story', exact: true }).click();
    await frame!.waitForFunction(() => window.spatialProof.state().time > 0.1);
    await reduced.close();
    const noWebGL = await browser.newPage();
    await noWebGL.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (/webgl/.test(type)) return null;
        return original.apply(this, [type, ...args] as Parameters<typeof original>);
      } as typeof original;
    });
    await noWebGL.goto(site);
    await noWebGL.locator('.story-cinema').scrollIntoViewIfNeeded();
    await noWebGL.getByRole('button', { name: 'Retry story' }).waitFor();
    expect(await noWebGL.locator('.story-placeholder img').isVisible()).toBe(true);
    expect(await noWebGL.locator('.napplet-card').count()).toBeGreaterThan(0);
    await noWebGL.close();
    const noJS = await browser.newPage({ javaScriptEnabled: false });
    await noJS.goto(site);
    expect(await noJS.locator('#story').textContent()).toContain('propose the improvement');
    expect(await noJS.locator('.story-cinema iframe').count()).toBe(0);
    await noJS.close();
    const audio = await fetch(`${site}/story/story-audio.m4a`, {
      headers: { range: 'bytes=0-99' },
    });
    expect(audio.status).toBe(206);
    expect((await audio.arrayBuffer()).byteLength).toBe(100);
  } finally {
    clearTimeout(timeout);
    await browser.close();
    web.kill();
    await web.exited;
    await rm(temporary, { recursive: true, force: true });
  }
}, 110_000);
