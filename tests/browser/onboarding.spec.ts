import { test, expect } from '@playwright/test';
import release from '../../apps/cli/distribution/version.json' with { type: 'json' };

test('onboarding provides a runtime-free installer and real versioned downloads', async ({
  page,
  request,
}) => {
  await page.goto('/create?template=tiny-tennis');
  await expect(page.locator('.terminal-box')).toContainText(
    'curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet --template tiny-tennis',
  );
  await expect(page.locator('.creation-steps')).toContainText('napplet-space dev');
  await expect(page.locator('.creation-steps')).toContainText('napplet-space publish');
  await page.getByRole('link', { name: /Installation help/ }).click();
  await expect(page.getByRole('heading', { name: 'No runtime setup' })).toBeVisible();
  expect((await request.get('/install.sh')).status()).toBe(200);
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
    const path = `/cli/download/${release.version}/napplet-space-${platform}.tar.gz`;
    const head = await request.head(path);
    expect(head.status()).toBe(200);
    expect(Number(head.headers()['content-length'])).toBeGreaterThan(20_000_000);
    const checksum = await request.get(path + '.sha256');
    expect(checksum.status()).toBe(200);
    expect(await checksum.text()).toMatch(/^[a-f0-9]{64}  napplet-space-/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/create?template=plasma-garden');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.local/onboarding-mobile.png', fullPage: true });
});
