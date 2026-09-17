import { test, expect } from 'bun:test';
import { expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startLocalBackendRelay } from '../../packages/multiplayer/src/local-relay';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { browserEngine } from '../../apps/cli/src/browser';

test('multiplayer choices survive reloads, dismissals stay unset and changes revoke active sessions across tabs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-multiplayer-permission-'));
  const relay = startLocalBackendRelay();
  await Bun.write(
    join(directory, 'napplet.json'),
    JSON.stringify({
      name: 'Permission fixture',
      description: '',
      license: 'MIT',
      entry: 'index.html',
      previewId: crypto.randomUUID(),
      requires: ['webrtc'],
      relays: [relay.url],
    }),
  );
  await Bun.write(
    join(directory, 'index.html'),
    '<!doctype html><body>Multiplayer permission fixture</body>',
  );
  const server = startPreviewServer(
    pathToFileURL(directory + '/'),
    0,
    false,
    await previewAssets(),
  );
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const frame = async () => {
      await page.locator('iframe').waitFor();
      const frame = page.frames().find((f) => f.parentFrame())!;
      await frame.waitForFunction(() => !!(window as any).napplet?.webrtc);
      return frame;
    };
    const request = async () => {
      const f = await frame();
      await f.evaluate(() => {
        const w = window as any;
        w.result = null;
        w.events ??= [];
        w.napplet.webrtc.onEvent((event: unknown) => w.events.push(event));
        void w.napplet.webrtc
          .open({ scope: { type: 'room', room: crypto.randomUUID(), peers: [] }, channel: 'test' })
          .then((result: unknown) => {
            w.result = result;
          })
          .catch((error: Error) => {
            w.result = { error: error.message };
          });
      });
      return f;
    };
    const result = async () => {
      const f = await frame();
      await f.waitForFunction(() => (window as any).result !== null);
      return f.evaluate(() => (window as any).result);
    };
    const choice = () => page.getByLabel('Multiplayer permission', { exact: true });
    const revealSettings = async () => {
      await page.getByText('Network settings', { exact: true }).click();
    };
    await page.goto(server.url.href);
    const f = await frame();
    // Napplet-owned storage cannot grant a host permission.
    await f.evaluate(async () =>
      (window as any).napplet.storage.setItem('napplet:multiplayer-permission:v1', 'allow'),
    );
    await request();
    await ui(page.getByRole('dialog')).toBeVisible();
    await ui(page.getByRole('dialog')).toContainText('all napplets in this browser');
    await page.screenshot({ path: '/tmp/soy-multiplayer-prompt-mobile.png' });
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    expect((await result()).error).toContain('denied');
    await revealSettings();
    await ui(choice()).toHaveValue('ask');

    await request();
    await page.locator('#cancel').focus();
    await page.keyboard.press('Escape');
    expect((await result()).error).toContain('denied');
    await ui(choice()).toHaveValue('ask');

    await page.clock.install();
    await request();
    await ui(page.getByRole('dialog')).toBeVisible();
    await page.clock.fastForward(26000);
    expect((await result()).error).toContain('denied');
    await ui(choice()).toHaveValue('ask');
    await page.clock.resume();

    await request();
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    expect((await result()).error).toContain('denied');
    await page.reload();
    await request();
    expect((await result()).error).toContain('denied');
    await ui(page.getByRole('dialog')).not.toBeVisible();
    await revealSettings();
    await ui(choice()).toHaveValue('block');
    await choice().selectOption('ask');
    await request();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    expect((await result()).session.id).toBeString();
    await page.reload();
    await request();
    expect((await result()).session.id).toBeString();
    await ui(page.getByRole('dialog')).not.toBeVisible();

    const settings = await context.newPage();
    await settings.goto(server.url.href);
    await settings.getByText('Network settings', { exact: true }).click();
    await settings.getByLabel('Multiplayer permission', { exact: true }).selectOption('block');
    const active = await frame();
    await active.waitForFunction(() =>
      (window as any).events.some(
        (e: any) => e.type === 'closed' && e.reason === 'Multiplayer permission changed',
      ),
    );
    await request();
    expect((await result()).error).toContain('denied');

    // The broad multiplayer choice does not grant access to arbitrary CVM providers.
    await active.evaluate((url) => {
      const w = window as any;
      w.backendError = null;
      void w.napplet.cvm
        .callTool({ pubkey: 'b'.repeat(64), relays: [url] }, 'soy_session', {})
        .catch((e: Error) => {
          w.backendError = e.message;
        });
    }, relay.url);
    await ui(page.getByRole('dialog')).toContainText('Connect to backend');
    await ui(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await active.waitForFunction(() => !!(window as any).backendError);

    // A separate browser profile starts without the remembered choice.
    const fresh = await browser.newPage();
    await fresh.goto(server.url.href);
    await fresh.getByText('Network settings', { exact: true }).click();
    await ui(fresh.getByLabel('Multiplayer permission', { exact: true })).toHaveValue('ask');
    await fresh.evaluate(() => {
      const native = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'napplet:multiplayer-permission:v1') throw new Error('Storage unavailable');
        return native.call(this, key, value);
      };
    });
    await fresh.getByLabel('Multiplayer permission', { exact: true }).selectOption('allow');
    await ui(
      fresh.getByText('Browser storage is unavailable. Saved for this page only.'),
    ).toBeVisible();
    await ui(fresh.getByLabel('Multiplayer permission', { exact: true })).toHaveValue('allow');
    expect(errors).toEqual([]);
    await revealSettings();
    await page.screenshot({ path: '/tmp/soy-multiplayer-settings-mobile.png', fullPage: true });
  } finally {
    await browser.close();
    server.stop(true);
    relay.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
