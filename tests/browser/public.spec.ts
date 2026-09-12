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
