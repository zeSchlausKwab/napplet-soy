import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import fixtures from '../../packages/backend/data/catalog.json';
import { matchFilters } from 'nostr-tools';

test('All featured selects the collection promptly even while relays are unavailable', async () => {
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
  const timer = setTimeout(() => server.kill(), 30000);
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
    await ui(page.locator('#identity-button')).toBeEnabled();
    const link = page.getByRole('link', { name: 'All featured', exact: true });
    await link.scrollIntoViewIfNeeded();
    const started = performance.now();
    await link.click();
    await ui(page.getByRole('heading', { name: /^Featured napplets/ })).toBeVisible({
      timeout: 700,
    });
    await ui
      .poll(
        () =>
          page.locator('.napplet-collection').evaluate((el) => {
            const expected = Math.min(
              el.getBoundingClientRect().top + scrollY - 60,
              document.documentElement.scrollHeight - innerHeight,
            );
            return Math.abs(scrollY - expected) < 3;
          }),
        { timeout: 700 },
      )
      .toBe(true);
    console.log('Featured selection and anchor:', Math.round(performance.now() - started), 'ms');
    await ui(page.locator('.napplet-collection .napplet-card')).toHaveCount(3);
    await ui(page.getByRole('combobox', { name: 'Sort napplets' })).toHaveValue('featured');
    await page.getByRole('combobox', { name: 'Sort napplets' }).selectOption('new');
    await ui(page.getByRole('heading', { name: /^All napplets/ })).toBeVisible({ timeout: 700 });
    // The control can be above the viewport: record after it has been brought into view.
    await page.goBack();
    await ui(page.getByRole('heading', { name: /^Featured napplets/ })).toBeVisible({
      timeout: 700,
    });
    await page.evaluate(() => scrollTo({ top: 450, behavior: 'instant' }));
    const chosen = await page.evaluate(() => scrollY);
    await page.waitForTimeout(8000); // Let the outstanding relay refresh finish.
    expect(Math.abs((await page.evaluate(() => scrollY)) - chosen)).toBeLessThan(3);
    // A cold return also displays the gallery without waiting for relay discovery.
    const cold = await context.newPage();
    await cold.goto(origin + '/about');
    await ui(cold.locator('#identity-button')).toBeEnabled();
    await cold.getByRole('link', { name: 'napplet.soy home' }).click();
    await ui(cold.locator('.hero h1')).toBeVisible({ timeout: 700 });
    await cold.close();
    // Successful, late enrichment must not replay the old hash navigation either.
    const slow = await browser.newContext({ viewport: { width: 1365, height: 1200 } });
    const replies = new Set<ReturnType<typeof setTimeout>>();
    let deletionsReplied = false;
    await slow.routeWebSocket(/wss?:\/\//, (socket) => {
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'REQ') return;
        const timer = setTimeout(() => {
          replies.delete(timer);
          try {
            for (const event of manifests)
              if (matchFilters(message.slice(2), event))
                socket.send(JSON.stringify(['EVENT', message[1], event]));
            socket.send(JSON.stringify(['EOSE', message[1]]));
            if (message.slice(2).some((filter: any) => filter.kinds?.includes(5)))
              deletionsReplied = true;
          } catch {
            /* Test page may have closed a completed subscription. */
          }
        }, 1600);
        replies.add(timer);
      });
    });
    try {
      const late = await slow.newPage();
      await late.goto(origin);
      await ui(late.locator('#identity-button')).toBeEnabled();
      await late.getByRole('link', { name: 'All featured', exact: true }).click();
      await ui(late.getByRole('heading', { name: /^Featured napplets/ })).toBeVisible({
        timeout: 700,
      });
      await late.evaluate(() => scrollTo({ top: 450, behavior: 'instant' }));
      await ui.poll(() => deletionsReplied).toBe(true);
      await late.waitForTimeout(1500);
      expect(Math.abs((await late.evaluate(() => scrollY)) - 450)).toBeLessThan(3);
      await ui(late.locator('.napplet-collection .napplet-card')).toHaveCount(3);
    } finally {
      for (const timer of replies) clearTimeout(timer);
      await slow.close();
    }
    expect(errors).toEqual([]);
  } finally {
    clearTimeout(timer);
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
