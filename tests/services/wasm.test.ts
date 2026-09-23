import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { inspectProject } from '../../packages/publish/src/project';
import { checkPublication } from '../../apps/cli/src/publish-check';

test.skipIf(!process.env.SPACE_TEST_WASM_PROJECT)(
  'real Bevy module renders, uses storage/config/resources and resizes inside the production sandbox',
  async () => {
    const root = resolve(process.env.SPACE_TEST_WASM_PROJECT!);
    const server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets(), {
      network: 'local',
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
      const errors: string[] = [],
        requests: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (r) => requests.push(r.url()));
      await page.addInitScript(() => {
        (window as any).wasmViolations = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          (window as any).wasmViolations.push(e.violatedDirective),
        );
      });
      const started = performance.now();
      await page.goto(server.url.href);
      const frame = page.frameLocator('iframe');
      await ui(frame.locator('html')).toHaveAttribute('data-napplet-ready', 'true', {
        timeout: 30000,
      });
      const startupMs = Math.round(performance.now() - started);
      await ui(frame.locator('html')).toHaveAttribute('data-config', 'ok');
      await ui(frame.locator('html')).toHaveAttribute('data-resource', 'ok');
      await ui(frame.locator('#status')).toHaveText('Saved visits: 0');
      await frame.getByRole('button', { name: 'Save a visit' }).click();
      await ui(frame.locator('#status')).toHaveText('Saved visits: 1');
      await page.reload();
      await ui(page.frameLocator('iframe').locator('#status')).toHaveText('Saved visits: 1', {
        timeout: 30000,
      });
      await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
      await page.getByLabel('Motion speed', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Save settings' }).click();
      const child = page.frames().find((f) => f.parentFrame())!;
      expect(
        await child.evaluate(async () => (await (window as any).napplet.config.get()).speed),
      ).toBe(2);
      const project = await Bun.file(join(root, 'napplet.json')).json();
      const dest = resolve(
        '.local/wasm/evidence',
        project.build.features?.includes('scene3d') ? '3d' : '2d',
      );
      await mkdir(dest, { recursive: true });
      await page.locator('iframe').screenshot({ path: join(dest, 'desktop.png') });
      const first = await page.frameLocator('iframe').locator('canvas').screenshot();
      const pixels = await sharp(first).ensureAlpha().raw().toBuffer();
      let green = 0,
        magenta = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 1] > 130 && pixels[i + 1] > pixels[i] * 1.15 && pixels[i] > 70) green++;
        if (pixels[i] > 220 && pixels[i + 1] < 40 && pixels[i + 2] > 220) magenta++;
      }
      expect(green).toBeGreaterThan(1000);
      expect(magenta).toBe(0);
      await page.waitForTimeout(350);
      expect(await page.frameLocator('iframe').locator('canvas').screenshot()).not.toEqual(first);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('iframe').evaluate((node) => {
        node.style.cssText =
          'position:fixed;inset:0;width:390px;height:640px;min-height:0;border:0;display:block';
      });
      await page.waitForTimeout(500);
      const dimensions = await child.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scroll: document.documentElement.scrollWidth,
        canvas: document.querySelector('canvas')!.width,
        csp: (window as any).wasmViolations,
      }));
      expect(dimensions).toMatchObject({
        width: 390,
        height: 640,
        scroll: 390,
        canvas: 390,
        csp: [],
      });
      await page.frameLocator('iframe').getByRole('button', { name: 'Save a visit' }).click();
      await ui(page.frameLocator('iframe').locator('#status')).toHaveText('Saved visits: 2');
      await page.locator('iframe').screenshot({ path: join(dest, 'mobile.png') });
      expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
      expect(requests.some((url) => /\.wasm(?:$|\?)/.test(url))).toBe(false);
      expect(errors).toEqual([]);
      console.log(JSON.stringify({ startupMs, dimensions, browser: browser.version() }));
      const { contents } = await inspectProject(root, 'local', '0'.repeat(64));
      const checked = await checkPublication(contents);
      expect(checked.preview.length).toBeGreaterThan(1000);
      // A missing browser prerequisite produces a visible loader failure, never a
      // silent blank canvas or an apparently successful ready milestone.
      const oldBrowser = await browser.newContext();
      try {
        await oldBrowser.addInitScript(() => {
          (window as any).DecompressionStream = undefined;
        });
        const unsupported = await oldBrowser.newPage();
        await unsupported.goto(server.url.href);
        await ui(unsupported.frameLocator('iframe').getByRole('alert')).toContainText(
          'DecompressionStream',
          { timeout: 15000 },
        );
        await ui(unsupported.frameLocator('iframe').locator('html')).not.toHaveAttribute(
          'data-napplet-ready',
          'true',
        );
      } finally {
        await oldBrowser.close();
      }
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90000,
);
