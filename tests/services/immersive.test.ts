import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, type Event } from 'nostr-tools';
import { aggregateHash, encodeAddress, sha256 } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { initializePolicy } from '../../packages/moderation/src/policy';
import fixtures from '../../packages/backend/data/catalog.json';

test('immersive routes preserve the verified frame and host session across native, CSS, history and touch exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-immersive-'));
  const key = new Uint8Array(32);
  key[31] = 1;
  const html = new TextEncoder().encode(
    '<!doctype html><title>Little orbit</title><button onclick="this.textContent=Number(this.textContent)+1">0</button>',
  );
  const hash = await sha256(html);
  let relayDelay = 0;
  const wireEvents: Event[] = fixtures.flatMap((n) => [n.current, n.snapshot]);
  const storage = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request, server) {
      if (server.upgrade(request)) return;
      const requested = new URL(request.url).pathname.slice(1);
      if (!/^[a-f0-9]{64}$/.test(requested)) return new Response('', { status: 404 });
      const file = Bun.file(resolve('packages/backend/data/artifacts', `${requested}.html`));
      return new Response(requested === hash ? html : (await file.exists()) ? file : null, {
        headers: { 'access-control-allow-origin': '*' },
        status: requested === hash || (await file.exists()) ? 200 : 404,
      });
    },
    websocket: {
      async message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          if (relayDelay) await Bun.sleep(relayDelay);
          for (const e of wireEvents)
            if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  const tags = [
    ['d', 'little-orbit'],
    ['server', String(storage.url).replace(/\/$/, '')],
    ['title', 'Little orbit'],
    [
      'description',
      'A live session, wherever you play. ' + 'A little world to explore together. '.repeat(12),
    ],
    ['path', '/index.html', hash],
    ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
  ];
  const current = finalizeEvent({ kind: 35129, created_at: 1, content: '', tags }, key);
  const pinned = finalizeEvent(
    {
      kind: 5129,
      created_at: 1,
      content: '',
      tags: [...tags.filter((t) => t[0] !== 'd'), ['a', `35129:${current.pubkey}:little-orbit`]],
    },
    key,
  );
  const unsupported = finalizeEvent(
    {
      ...current,
      tags: [...tags.filter((t) => t[0] !== 'd'), ['d', 'unsupported'], ['requires', 'cvm']],
    },
    key,
  );
  const unavailable = finalizeEvent(
    { ...current, tags: [...tags.filter((t) => t[0] !== 'd'), ['d', 'unavailable']] },
    key,
  );
  wireEvents.push(current, pinned, unsupported, unavailable);
  const index = new IndexStore(join(directory, 'index'), true);
  for (const event of [current, pinned, unsupported, unavailable]) {
    index.admit(event);
    const model = await publicNapplet(event);
    index.project(
      event.id,
      {
        ...model,
        bytes: html.length,
        availability:
          event === unsupported ? 'host-required' : event === unavailable ? 'unavailable' : 'ready',
      },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
  }
  index.close();
  await Bun.write(join(directory, 'index/artifacts', `${hash}.html`), html);
  const policy = join(directory, 'policy.json');
  initializePolicy(policy);
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${storage.port}`,
      SPACE_INDEX_LOCAL_BLOSSOM: String(storage.url),
      SPACE_PUBLICDEV: '0',
      SPACE_MODERATION_FILE: policy,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const logs = new Response(child.stderr).text(),
    stdout = new Response(child.stdout).text();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw new Error('Immersive test server did not start');
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1365, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const address = encodeAddress({
      kind: 35129,
      pubkey: current.pubkey,
      identifier: 'little-orbit',
    });
    const paths = [
      `/n/${address}`,
      `/r/${pinned.id}`,
      `/r/${current.id}`,
      `/n/${fixtures[0].naddr}`,
      `/r/${fixtures[0].snapshot.id}`,
      `/@${fixtures[0].handle}/${fixtures[0].slug}`,
    ];
    for (const path of paths) {
      const response = await fetch(`${origin}${path}/play`);
      expect(response.status).toBe(200);
      const ssr = await response.text();
      expect(ssr).toContain('player-expanded');
      expect(ssr).toContain('property="og:image"');
      expect(ssr).toContain(`href="${path}"`); // Back works even before hydration.
      await page.goto(`${origin}${path}/play`);
      await browserExpect(page.locator('.player-expanded')).toBeVisible();
      await readyFrame(page);
      await page.mouse.move(0, 0);
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      await browserExpect(page.locator('.player-cover, .player-bar')).toHaveCount(0);
      await browserExpect(page.locator('.player-chrome-panel')).not.toBeVisible();
      await browserExpect(page.locator('.player-corner-trigger')).toBeVisible();
      const bounds = (await page.locator('iframe').boundingBox())!;
      expect(bounds).toMatchObject({ x: 0, y: 0, width: 1365, height: 1000 });
      const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
      expect(canonical).not.toEndWith('/play');
    }

    // Sharing offers both destinations without requiring an account or starting the app.
    await page.goto(`${origin}/r/${pinned.id}`);
    await page.locator('.card-share').click();
    await page.getByRole('button', { name: 'Copy player link', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/r/${pinned.id}/play`,
    );
    await page.getByRole('button', { name: 'Copy detail link', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/r/${pinned.id}`,
    );
    await page.keyboard.press('Escape');
    await browserExpect(page.locator('.card-share')).toBeFocused();
    expect(await page.locator('iframe').count()).toBe(0);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Denied')) },
      }),
    );
    await page.locator('.card-share').click();
    await page.getByRole('button', { name: 'Copy player link', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Share link' }).inputValue()).toBe(
      `${origin}/r/${pinned.id}/play`,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => delete (navigator as any).clipboard);

    // Cold links play with only the corner exit visible; hover and keyboard reveal controls.
    await page.goto(`${origin}/r/${pinned.id}/play`);
    const directFrame = await readyFrame(page);
    await page.mouse.move(0, 0);
    await browserExpect(page.locator('.player-chrome-panel')).not.toBeVisible();
    await page.locator('.player-corner-trigger').hover();
    await browserExpect(page.locator('.player-corner-info')).toBeVisible();
    expect((await page.locator('.player-corner-info p').textContent())!.length).toBe(161);
    await browserExpect(page.locator('.player-chrome-panel')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: '/tmp/napplet-corner-desktop-open.png' });
    await page.mouse.move(0, 0);
    await browserExpect(page.locator('.player-chrome-panel')).not.toBeVisible();
    await page.screenshot({ path: '/tmp/napplet-corner-desktop.png' });
    await page.keyboard.press('Shift+Tab');
    await browserExpect(page.locator('.player-corner-trigger')).toBeFocused();
    await browserExpect(page.locator('.player-chrome-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await browserExpect(page.locator('.player-chrome-panel')).not.toBeVisible();
    await browserExpect(page).toHaveURL(`${origin}/r/${pinned.id}/play`);
    await page.locator('.player-corner-trigger').hover();
    await page.getByRole('button', { name: 'Enter browser fullscreen' }).click();
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.getByRole('link', { name: 'Back to details', exact: true }).click();
    await browserExpect(page).toHaveURL(`${origin}/r/${pinned.id}`);
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    expect(directFrame.isDetached()).toBe(false);

    // Route data gets recreated on navigation. The host's instance storage and files
    // must survive too; checking only iframe DOM would miss a callback-ref rebind.
    const detail = `/n/${address}`;
    await page.goto(origin + detail);
    await page.getByRole('button', { name: 'Start Little orbit', exact: true }).click();
    const frame = await readyFrame(page);
    await frame.locator('button').click();
    await frame.evaluate(async () => {
      const n = (window as any).napplet;
      (window as any).marker = 'same execution';
      await n.storage.instance.setItem('round', 'seven');
      await n.fs.write('/files/round.txt', btoa('seven'));
      await n.config.registerSchema({
        type: 'object',
        properties: { speed: { type: 'number', title: 'Speed', default: 1 } },
      });
    });
    const continuity = async () => {
      if (await page.locator('.player-expanded').count())
        await page.locator('.player-corner-trigger').hover();
      expect(frame.isDetached()).toBe(false);
      expect(await page.locator('iframe').count()).toBe(1);
      expect(
        await frame.evaluate(async () => ({
          marker: (window as any).marker,
          round: await (window as any).napplet.storage.instance.getItem('round'),
          files: await (window as any).napplet.fs.list('/files'),
        })),
      ).toMatchObject({
        marker: 'same execution',
        round: 'seven',
        files: [{ path: '/files/round.txt' }],
      });
      await browserExpect(page.getByRole('link', { name: 'round.txt ↓' })).toBeVisible();
    };
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await browserExpect(page).toHaveURL(origin + detail + '/play');
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await continuity();
    await page.getByRole('button', { name: 'Copy play link', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      origin + detail + '/play',
    );
    await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
    await browserExpect(
      page.getByRole('dialog', { name: 'Make it feel like yours.' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await browserExpect(page).toHaveURL(origin + detail + '/play');

    // Browser/system native exit leaves the expanded player, then a second Escape leaves it.
    await page.evaluate(() => document.exitFullscreen());
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await browserExpect(page.locator('.player-expanded')).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await browserExpect(page).toHaveURL(origin + detail);
    await continuity();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    expect(await page.locator('[inert]').count()).toBe(0);

    // Slow relay revalidation must preserve the already running frame.
    relayDelay = 500;
    await page.getByRole('link', { name: 'Open player', exact: true }).click();
    await browserExpect(page).toHaveURL(origin + detail + '/play');
    await continuity();
    relayDelay = 0;
    await page.goBack();
    await browserExpect(page).toHaveURL(origin + detail);
    await continuity();
    await page.goForward();
    await browserExpect(page).toHaveURL(origin + detail + '/play');
    await page.locator('.player-corner-trigger').hover();
    await page.getByRole('button', { name: 'Enter browser fullscreen' }).click();
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.goBack();
    await browserExpect(page).toHaveURL(origin + detail);
    await browserExpect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await continuity();

    await page.getByRole('link', { name: 'Open player', exact: true }).click();
    await page.getByRole('link', { name: 'Back to details', exact: true }).click();
    await browserExpect(page).toHaveURL(origin + detail);
    await continuity();
    await page.getByRole('link', { name: 'Back to the playground', exact: true }).click();
    await browserExpect(page).toHaveURL(origin + '/');
    await browserExpect.poll(() => frame.isDetached()).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    expect(await page.locator('[inert]').count()).toBe(0);

    // Native fullscreen denied/unavailable: touch still gets a full viewport and an exit.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.addInitScript(() => {
      Element.prototype.requestFullscreen = function () {
        (window as any).fullscreenActivation = navigator.userActivation.isActive;
        return Promise.reject(new DOMException('Unavailable in this browser', 'NotAllowedError'));
      };
    });
    const touch = await mobile.newPage();
    await touch.goto(`${origin}/@${fixtures[0].handle}/${fixtures[0].slug}/play`);
    const mobileFrame = await readyFrame(touch);
    await browserExpect(touch.locator('.player-chrome-panel')).not.toBeVisible();
    await touch.locator('.player-corner-trigger').tap();
    await browserExpect(touch.locator('.player-chrome-panel')).toBeVisible();
    await browserExpect(touch).toHaveURL(
      `${origin}/@${fixtures[0].handle}/${fixtures[0].slug}/play`,
    );
    const target = (await touch.locator('.player-corner-trigger').boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await touch.getByRole('button', { name: 'Enter browser fullscreen' }).tap();
    expect(await touch.evaluate(() => (window as any).fullscreenActivation)).toBe(true);
    expect(await touch.evaluate(() => document.fullscreenElement)).toBeNull();
    await browserExpect(touch.locator('.player-expanded')).toBeVisible();
    expect(
      await touch.evaluate(() => document.querySelector('.site-header')!.hasAttribute('inert')),
    ).toBe(true);
    expect(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await touch.screenshot({ path: '/tmp/napplet-immersive-mobile.png' });
    await touch.setViewportSize({ width: 320, height: 568 });
    expect(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const panel = (await touch.locator('.player-chrome-panel').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(320);
    for (const control of await touch.locator('.player-controls button').all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    }
    await touch.screenshot({ path: '/tmp/napplet-corner-mobile-small.png' });
    await touch.setViewportSize({ width: 844, height: 390 });
    await browserExpect(touch.locator('iframe')).toBeVisible();
    expect((await touch.locator('iframe').boundingBox())!.height).toBe(390);
    expect(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await touch.screenshot({ path: '/tmp/napplet-immersive-landscape.png' });
    // A touch in the app dismisses the panel without a blocking page-sized overlay.
    await mobileFrame.locator('canvas').tap({ position: { x: 50, y: 50 } });
    await browserExpect(touch.locator('.player-chrome-panel')).not.toBeVisible();
    await touch.locator('.player-corner-trigger').tap();
    await browserExpect(touch.locator('.player-chrome-panel')).toBeVisible();
    await touch.getByRole('link', { name: 'Back to details', exact: true }).tap();
    await browserExpect(touch.locator('.player-expanded')).toHaveCount(0);
    expect(mobileFrame.isDetached()).toBe(false);
    await mobile.close();

    for (const event of [unsupported, unavailable]) {
      await page.goto(`${origin}/r/${event.id}/play`);
      await browserExpect(
        page.getByRole('heading', {
          name:
            event === unsupported
              ? 'This one needs more capabilities.'
              : 'The creation is currently unavailable.',
        }),
      ).toBeVisible();
      expect(await page.locator('iframe, .player-cover').count()).toBe(0);
      await page.getByRole('link', { name: 'Back to details', exact: true }).click();
      await browserExpect(page).toHaveURL(`${origin}/r/${event.id}`);
    }
    // A play URL never bypasses content-address verification, even for an admitted row.
    await page.route(`${storage.url}${hash}`, (route) =>
      route.fulfill({
        body: '<script>parent.hacked=true</script>',
        contentType: 'text/html',
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.goto(origin + detail + '/play');
    await browserExpect(page.getByRole('alert')).toBeVisible();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    const stderr = await logs;
    await stdout;
    if (stderr) console.error(stderr.slice(-3000));
    storage.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

async function readyFrame(page: Page) {
  await browserExpect(page.locator('iframe')).toBeVisible();
  const frame = page.frames().find((f) => f.parentFrame())!;
  await frame.waitForFunction(() => typeof (window as any).napplet?.shell?.ready === 'function');
  await frame.evaluate(() => (window as any).napplet.shell.ready());
  return frame;
}
