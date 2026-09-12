import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('publicdev shows signed relay entries, plays verified Rubik Cube, and gates missing capabilities', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.TEST_PUBLICDEV !== '1',
    'Run explicitly against a publicdev server after a successful catalog refresh.',
  );
  const cache = JSON.parse(await readFile('.local/publicdev/catalog.json', 'utf8'));
  const n = cache.entries.find((entry: { title: string }) => entry.title === 'Rubik Cube');
  expect(n?.availability).toBe('ready');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Public napplets', exact: true }).click();
  await expect(page.locator('.napplet-card')).toHaveCount(cache.entries.length);
  await page.goto(`/n/${n.naddr}`);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Rubik Cube' }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const unsupported = cache.entries.find(
    (entry: { naddr: string; availability: string }) =>
      entry.naddr && entry.availability === 'host-required',
  );
  await page.goto(`/n/${unsupported.naddr}`);
  await expect(
    page.getByRole('heading', { name: 'This one needs more capabilities.' }),
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    new RegExp(unsupported.revisionId),
  );
  expect((await request.get(`/api/og/${n.revisionId}`)).status()).toBe(200);
  expect(errors).toEqual([]);
});

test('public Random Sticker plays, changes pictures, and exports its selected image', async ({
  page,
}) => {
  test.skip(process.env.TEST_PUBLICDEV !== '1', 'Requires the public relay catalog.');
  const cache = JSON.parse(await readFile('.local/publicdev/catalog.json', 'utf8'));
  const napplet = cache.entries.find(
    (n: { title: string }) => n.title === '600.wtf · Random Sticker',
  );
  expect(napplet.availability).toBe('ready');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/n/${napplet.naddr}`);
  await page.getByRole('button', { name: `Start ${napplet.title}` }).click();
  const frame = page.frameLocator('iframe');
  const sticker = frame.locator('#sticker');
  await expect(sticker).toBeVisible();
  const first = await sticker.getAttribute('data-sticker-id');
  await frame.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(sticker).not.toHaveAttribute('data-sticker-id', first!);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.locator('.host-files a')).toHaveCount(1);
  const downloading = page.waitForEvent('download');
  await page.locator('.host-files a').click();
  expect((await downloading).suggestedFilename()).toMatch(/\.webp$/);
  await expect(frame.locator('#status')).not.toHaveAttribute('data-error', 'true');
  expect(errors).toEqual([]);
});

test('public packaged loader verifies all ten Blossom resources', async ({ page }) => {
  test.skip(
    process.env.TEST_PUBLICDEV !== '1' || process.env.TEST_LARGE_PUBLIC !== '1',
    'Opt-in integration test downloads 78 MiB of public resources.',
  );
  test.setTimeout(60000);
  const cache = JSON.parse(await readFile('.local/publicdev/catalog.json', 'utf8'));
  const n = cache.entries.find(
    (entry: { title: string; availability: string }) =>
      entry.title === 'Packaged Loader Evidence' && entry.availability === 'ready',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/n/${n.naddr}`);
  await page.getByRole('button', { name: 'Start Packaged Loader Evidence' }).click();
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Packaged application ready' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.frameLocator('iframe').locator('#production-resource-summary')).toHaveText(
    '10 verified resources opened in original order.',
  );
  expect(errors).toEqual([]);
});
