import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { screenshotProject } from '../../apps/cli/src/project-config';

test('local listing shows live metadata and destinations, captures app pixels, and protects local files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-listing-'));
  let server: ReturnType<typeof startPreviewServer> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const config = {
      schema: 'space-local-project/v1',
      name: 'Neon playground',
      title: 'Tiny constellation',
      description: 'Move through a little universe of drifting stars.',
      previewId: crypto.randomUUID(),
      entry: 'index.html',
      license: 'MIT',
      topics: ['generative', 'toy'],
      creator: { pubkey: 'a'.repeat(64), network: 'local' },
      preview: { delayMs: 250 },
      publish: { networks: { local: { blossom: 'http://127.0.0.1:9090' } } },
    };
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(config));
    await Bun.write(
      join(root, 'index.html'),
      '<!doctype html><style>html,body{height:100%;margin:0;background:#272342;color:#eee7cf}body{display:grid;place-items:center}p{font:80px system-ui}</style><p>✳ · ✦ · ✳</p>',
    );
    await Bun.write(join(root, 'LICENSE'), 'MIT');
    let captures = 0;
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets(), {
      network: 'local',
      capture: () => {
        captures++;
        return screenshotProject(root, 'local');
      },
    });
    const origin = server.url.origin;
    expect((await fetch(`${origin}/listing/capture`, { method: 'POST' })).status).toBe(403);
    expect(
      (
        await fetch(`${origin}/listing/capture`, {
          method: 'POST',
          headers: { Origin: 'https://outsider.example' },
        })
      ).status,
    ).toBe(403);
    expect(captures).toBe(0);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url.href);
    await page.locator('iframe').waitFor();
    expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    await page.getByRole('button', { name: 'Listing', exact: true }).click();
    await page.getByRole('heading', { name: config.title }).waitFor();
    expect(await page.locator('#listing').textContent()).toContain('http://127.0.0.1:9090');
    expect(await page.locator('#listing').textContent()).toContain('No screenshot selected yet');
    expect(await page.locator('#stage').isVisible()).toBe(false);
    await page.getByRole('button', { name: 'Capture screenshot', exact: true }).click();
    await page
      .getByText('Screenshot saved and selected. Inspect it below before publishing.')
      .waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () =>
        (document.querySelector('.listing-card img') as HTMLImageElement)?.naturalWidth === 1200,
    );
    expect(captures).toBe(1);
    expect((await Bun.file(join(root, 'napplet.json')).json()).preview.image).toBe('preview.png');
    const saved = await Bun.file(join(root, 'napplet.json')).json();
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({ ...saved, title: '<script>plain text</script>' }),
    );
    await page.getByRole('heading', { name: '<script>plain text</script>', exact: true }).waitFor();
    expect(await page.locator('#listing script').count()).toBe(0);
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(saved));
    await page.getByRole('heading', { name: config.title }).waitFor();
    const screenshots = resolve('.local/listing-preview');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    expect(await page.locator('iframe').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    // A selected path cannot escape the project or expose arbitrary local data.
    await symlink('/etc/hosts', join(root, 'outside.png'));
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({ ...saved, preview: { image: 'outside.png' } }),
    );
    expect((await fetch(`${origin}/listing/preview.png`)).status).toBe(400);
    expect((await (await fetch(`${origin}/listing`)).json()).image).toBeNull();
    expect((await fetch(`${origin}/napplet.json`)).status).toBe(404);
    // Metadata remains inspectable before there is a successful build.
    await rm(join(root, 'index.html'));
    const listing = await (await fetch(`${origin}/listing`)).json();
    expect(listing.title).toBe(config.title);
    expect(listing.warnings.join(' ')).toContain('Build the project');
  } finally {
    await browser?.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
