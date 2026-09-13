import { test, expect, type Page } from '@playwright/test';
import records from '../../packages/backend/data/catalog.json' with { type: 'json' };

// The gallery can grow through relay discovery while these fixture assertions
// continue to check deterministic filtering and navigation behavior.
const fixtureCards = (page: Page) =>
  page.locator('.napplet-card').filter({ has: page.locator('a[href="/@space-lab"]') });

test('gallery SSR, filtering, navigation and browser history', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Small code.');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The playground' })).toBeVisible();
  await expect(fixtureCards(page)).toHaveCount(6);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Public napplets' })).toHaveCount(0);
  await page.screenshot({
    path: '.local/gallery-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'More tags', exact: true }).click();
  await page.getByRole('button', { name: 'Filter by #game', exact: true }).click();
  await expect(fixtureCards(page)).toHaveCount(1);
  await expect(page).toHaveURL(/tag=game/);
  await page.getByRole('link', { name: 'Play Tiny tennis' }).click();
  await expect(page.getByRole('heading', { name: 'Tiny tennis.' })).toBeVisible();
  await page.goBack();
  await expect(fixtureCards(page)).toHaveCount(1);
  await fixtureCards(page).getByRole('link', { name: '#arcade', exact: true }).click();
  await expect(page).toHaveURL(/tag=arcade/);
  await expect(fixtureCards(page)).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Filter by #arcade', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('plays only on request; opaque sandbox blocks host access and network', async ({ page }) => {
  await page.goto('/@space-lab/soft-orbit');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Soft orbit' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  const restrictions = await frame.evaluate(async () => {
    let parentBlocked = false,
      storageBlocked = false,
      networkBlocked = false;
    try {
      void parent.document;
    } catch {
      parentBlocked = true;
    }
    try {
      localStorage.setItem('probe', '1');
    } catch {
      storageBlocked = true;
    }
    try {
      await fetch('https://example.com');
    } catch {
      networkBlocked = true;
    }
    return { parentBlocked, storageBlocked, networkBlocked };
  });
  expect(restrictions).toEqual({ parentBlocked: true, storageBlocked: true, networkBlocked: true });
  await page.getByRole('button', { name: 'Stop napplet', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('tampered artifact is never executed', async ({ page }) => {
  await page.route('**/api/artifacts/*', (route) =>
    route.fulfill({ body: '<script>parent.hacked=true</script>', contentType: 'text/plain' }),
  );
  await page.goto('/@space-lab/blob-friend');
  await page.getByRole('button', { name: 'Start Blob friend' }).click();
  await expect(page.getByRole('alert')).toContainText('does not match its expected hash');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('portable and pinned source routes resolve; unknown addresses return 404', async ({
  page,
  request,
}) => {
  const n = records[0];
  for (const path of [`/n/${n.naddr}`, `/r/${n.snapshot.id}`]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(n.title);
  }
  await page.goto(`/r/${n.snapshot.id}/source`);
  await expect(page.locator('pre')).toContainText('<canvas');
  await expect(page.locator('iframe')).toHaveCount(0);
  const artifact = await request.get(`/api/artifacts/${n.artifactHash}`);
  expect(artifact.headers()['content-type']).toContain('text/plain');
  expect((await request.get('/n/not-a-real-address')).status()).toBe(404);
  expect((await request.get('/@nobody/missing')).status()).toBe(404);
});

test('server-rendered gallery loads responsive styles without JavaScript', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const stylesheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const url of stylesheets) {
      const response = await request.get(url);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/css');
    }
    await expect(page.locator('.napplet-grid')).toHaveCSS('display', 'grid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});

test('mobile gallery has no horizontal overflow and signer failure is actionable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(fixtureCards(page)).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.local/gallery-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'More tags', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Filter by #pixel-art', exact: true }).click();
  await expect(fixtureCards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Connect browser extension' }).click();
  await expect(page.getByRole('alert')).toContainText('Install or unlock a Nostr extension');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('share metadata is present without JavaScript on named, portable, and pinned pages', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const n = records[0];
  try {
    for (const path of [`/@space-lab/${n.slug}`, `/n/${n.naddr}`, `/r/${n.snapshot.id}`]) {
      await page.goto(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', n.title);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      const image = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(image).toMatch(/^https?:\/\//);
      const response = await request.get(new URL(image!).pathname);
      expect(response.headers()['content-type']).toBe('image/png');
      const bytes = await response.body();
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain(path.startsWith('/r/') ? path : `/@space-lab/${n.slug}`);
    }
    await page.screenshot({ path: '.local/og-page-no-js.png', fullPage: true });
  } finally {
    await context.close();
  }
  const headers = { 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http' };
  const html = await (await request.get(`/n/${n.naddr}`, { headers })).text();
  expect(html).not.toContain('attacker.invalid');
  expect((await request.get(`/api/og/${'0'.repeat(64)}`)).status()).toBe(404);
});
