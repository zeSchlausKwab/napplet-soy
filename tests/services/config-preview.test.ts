import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';

test.skipIf(!process.env.SPACE_TEST_CONFIG_PROJECT)(
  'maintained boilerplate settings change real controls and reload from the same build',
  async () => {
    const root = resolve(process.env.SPACE_TEST_CONFIG_PROJECT!);
    const server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.url.href);
      const frame = page.frameLocator('iframe');
      await browserExpect(frame.locator('html')).toHaveCSS('font-size', '13px');
      await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
      await page.getByLabel('Text size', { exact: true }).fill('18');
      await page.getByLabel('Control height', { exact: true }).fill('40');
      await page.getByLabel('Allow text selection', { exact: true }).selectOption('true');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await browserExpect(frame.locator('html')).toHaveCSS('font-size', '18px');
      await browserExpect(frame.locator('#storageButton')).toHaveCSS('height', '40px');
      await page.reload();
      await browserExpect(frame.locator('html')).toHaveCSS('font-size', '18px');
      await page.getByRole('button', { name: 'Listing', exact: true }).click();
      await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
      await browserExpect(page.getByLabel('Text size', { exact: true })).toHaveValue('18');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  30000,
);

test('static NAP-CONFIG works through the pinned shim, trusted form, identity changes and rebuilt artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-config-'));
  const schema = {
    type: 'object',
    properties: {
      speed: {
        type: 'number',
        title: 'Speed',
        minimum: 0.25,
        maximum: 3,
        default: 1,
        'x-napplet-section': 'Motion',
      },
      muted: { type: 'boolean', title: 'Mute sound', default: true },
      token: { type: 'string', title: 'Session token', 'x-napplet-secret': true },
    },
  };
  const html = `<!doctype html><meta name="napplet-config-schema" content='${JSON.stringify(schema)}'>
    <style>body{background:#d9e8ce;color:#293623;font:18px system-ui;padding:30px}button{font:inherit}pre{white-space:pre-wrap}</style>
    <button id="settings">Tune this napplet</button><pre id="values"></pre><output id="snapshot"></output>
    <script>
      const n = window.napplet;
      document.querySelector('#snapshot').textContent = n.config.schema.properties.speed.title;
      n.config.subscribe(values => document.querySelector('#values').textContent = JSON.stringify(values));
      document.querySelector('#settings').onclick = () => n.config.openSettings({ section: 'Motion' });
    </script>`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof startPreviewServer> | undefined;
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Settings specimen',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: [],
      }),
    );
    await Bun.write(join(root, 'index.html'), html);
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).nostr = { getPublicKey: async () => 'a'.repeat(64) };
    });
    await page.goto(server.url.href);
    const frame = page.frameLocator('iframe');
    await browserExpect(frame.locator('#values')).toHaveText('{"speed":1,"muted":true}');
    await browserExpect(frame.locator('#snapshot')).toHaveText('Speed');
    await frame.getByRole('button', { name: 'Tune this napplet' }).click();
    await browserExpect(page.getByRole('dialog')).toBeVisible();
    await browserExpect(page.locator('iframe')).toHaveAttribute('inert', '');
    await browserExpect(page.getByLabel('Session token', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await page.getByLabel('Speed', { exact: true }).fill('2');
    await page.getByLabel('Session token', { exact: true }).fill('session-only');
    const screenshots = resolve('.local/config-preview');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, 'desktop.png') });
    await page.getByRole('button', { name: 'Save settings' }).click();
    await browserExpect(frame.locator('#values')).toHaveText(
      '{"speed":2,"muted":true,"token":"session-only"}',
    );
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('session-only');
    await page.reload();
    await browserExpect(frame.locator('#values')).toHaveText('{"speed":2,"muted":true}');
    const child = page.frames().find((candidate) => candidate.parentFrame())!;
    expect(
      await child.evaluate(async () => {
        const config = (window as any).napplet.config;
        const copy = config.schema;
        copy.properties.speed.title = 'tampered';
        parent.postMessage({ type: 'config.set', id: 'forged', values: { speed: 3 } }, '*');
        const handle = config.onSchemaError(() => {});
        handle.close();
        return { title: config.schema.properties.speed.title, values: await config.get() };
      }),
    ).toEqual({ title: 'Speed', values: { speed: 2, muted: true } });
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await browserExpect(frame.locator('#values')).toHaveText('{"speed":1,"muted":true}');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await browserExpect(frame.locator('#values')).toHaveText('{"speed":2,"muted":true}');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
    await browserExpect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: join(screenshots, 'mobile.png') });
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await Bun.write(join(root, 'index.html'), html + '<!-- new build -->');
    await browserExpect(frame.locator('#values')).toHaveText('{"speed":1,"muted":true}');
    await Bun.write(join(root, 'index.html'), '<p>No settings</p>');
    await browserExpect(frame.getByText('No settings')).toBeVisible();
    await browserExpect(
      page.getByRole('button', { name: 'Napplet settings', exact: true }),
    ).toBeDisabled();
    const empty = page.frames().find((candidate) => candidate.parentFrame())!;
    expect(
      await empty.evaluate(async () => {
        const config = (window as any).napplet.config;
        const failures: unknown[] = [];
        const handle = config.onSchemaError((error: unknown) => failures.push(error));
        try {
          await config.registerSchema({
            type: 'object',
            properties: { text: { type: 'string', pattern: 'x' } },
          });
        } catch {}
        await config.registerSchema({
          type: 'object',
          properties: { enabled: { type: 'boolean', default: true } },
        });
        handle.close();
        return { schema: config.schema, values: await config.get(), failures };
      }),
    ).toMatchObject({
      schema: { properties: { enabled: { type: 'boolean' } } },
      values: { enabled: true },
      failures: [{ code: 'pattern-not-allowed' }],
    });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
