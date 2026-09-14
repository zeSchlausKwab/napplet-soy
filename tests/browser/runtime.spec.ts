import { test, expect } from '@playwright/test';

async function start(page: import('@playwright/test').Page) {
  await page.goto('/@space-lab/soft-orbit');
  await page.getByRole('button', { name: 'Start Soft orbit' }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const frame = page.frames().find((f) => f.parentFrame())!;
  await frame.evaluate(() => (window as any).napplet.shell.ready());
  return frame;
}

test('napplet settings stay usable in fullscreen, apply only on save and survive restarting the same release', async ({
  page,
}) => {
  let frame = await start(page);
  const schema = {
    type: 'object',
    properties: {
      speed: { type: 'number', title: 'Speed', minimum: 0.25, maximum: 3, default: 1 },
      token: { type: 'string', title: 'Session token', 'x-napplet-secret': true },
    },
  };
  const register = () =>
    frame.evaluate(async (schema) => {
      const config = (window as any).napplet.config;
      await config.registerSchema(schema);
      (window as any).settings = [];
      config.subscribe((values: unknown) => (window as any).settings.push(values));
      return config.get();
    }, schema);
  expect(await register()).toEqual({ speed: 1 });
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Make it feel like yours.' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const wrapper = document.fullscreenElement ?? document.querySelector('.player-expanded');
      return wrapper?.contains(document.querySelector('.nap-settings-dialog'));
    }),
  ).toBe(true);
  await page.getByLabel('Speed', { exact: true }).fill('2.5');
  await page.getByLabel('Session token', { exact: true }).fill('session-only');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect
    .poll(() => frame.evaluate(() => (window as any).settings.at(-1)))
    .toEqual({ speed: 2.5, token: 'session-only' });
  await page.getByRole('button', { name: 'Napplet settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset defaults' }).click();
  await expect(page.getByLabel('Speed', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await frame.evaluate(() => (window as any).napplet.config.get())).toEqual({
    speed: 2.5,
    token: 'session-only',
  });
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await page.getByRole('button', { name: 'Restart napplet' }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  frame = page.frames().find((f) => f.parentFrame())!;
  expect(await register()).toEqual({ speed: 2.5 });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('session-only');
});

test('NAP handshake, scoped persistence, policy errors and source binding work through the real shim', async ({
  page,
}) => {
  let frame = await start(page);
  await page.evaluate(() => {
    localStorage.setItem('host-only', 'secret');
    window.postMessage({ type: 'storage.set', id: 'spoof', key: 'forged', value: 'bad' }, '*');
  });
  expect(
    await frame.evaluate(async () => {
      const n = (window as any).napplet;
      await n.storage.setItem('level', 'three');
      await n.storage.instance.setItem('temporary', 'one');
      return {
        shell: n.shell.supports('shell'),
        storage: n.shell.supports('storage'),
        cvm: n.shell.supports('cvm'),
        keys: await n.storage.keys(),
        identity: await n.identity.getPublicKey(),
        private: await n.storage.getItem('host-only'),
      };
    }),
  ).toEqual({
    shell: true,
    storage: true,
    cvm: false,
    keys: ['level'],
    identity: '',
    private: null,
  });
  const denied = await frame.evaluate(async () => {
    try {
      await (window as any).napplet.relay.publish({
        kind: 1,
        tags: [],
        content: 'should never be signed',
        created_at: 1,
      });
      return false;
    } catch (error) {
      return String(error).includes('disabled');
    }
  });
  expect(denied).toBe(true);
  await page.getByRole('button', { name: 'Stop napplet' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  frame = await start(page);
  expect(
    await frame.evaluate(async () => ({
      saved: await (window as any).napplet.storage.getItem('level'),
      temporary: await (window as any).napplet.storage.instance.getItem('temporary'),
    })),
  ).toEqual({ saved: 'three', temporary: null });
  expect(await page.evaluate(() => localStorage.getItem('host-only'))).toBe('secret');
  await page.goto('/@space-lab/tiny-tennis');
  await page.getByRole('button', { name: 'Start Tiny tennis' }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  frame = page.frames().find((f) => f.parentFrame())!;
  expect(
    await frame.evaluate(async () => {
      await (window as any).napplet.shell.ready();
      return (window as any).napplet.storage.getItem('level');
    }),
  ).toBeNull();
});

test('file exports require a host choice, return real bytes, and disappear when playback stops', async ({
  page,
}) => {
  const frame = await start(page);
  const saved = frame.evaluate(async () => {
    const fs = (window as any).napplet.fs;
    const selected = await fs.pickSaveFile({ suggestedName: 'hello.txt' });
    return fs.write(selected.entries[0].path, btoa('hello from a napplet'), { mode: 'replace' });
  });
  await expect(page.getByRole('dialog', { name: 'Save napplet file' })).toBeVisible();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  expect(await saved).toMatchObject({ bytesWritten: 20 });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'hello.txt ↓' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('hello from a napplet');
  await page.getByRole('button', { name: 'Stop napplet' }).click();
  await expect(page.locator('.host-files')).toHaveCount(0);
});

test('unknown NAP messages are silent and consume no request quota', async ({ page }) => {
  const frame = await start(page);
  expect(
    await frame.evaluate(async () => {
      const replies: unknown[] = [];
      const listen = (event: MessageEvent) => {
        if (String(event.data?.id).startsWith('unknown')) replies.push(event.data);
      };
      window.addEventListener('message', listen);
      for (let i = 0; i < 650; i++)
        parent.postMessage(
          { type: i % 2 ? 'future.get' : 'storage.future', id: `unknown-${i}` },
          '*',
        );
      // This request is ordered after the unknown messages and must still succeed.
      const theme = await (window as any).napplet.theme.get();
      window.removeEventListener('message', listen);
      return { title: theme.title, replies };
    }),
  ).toEqual({ title: 'Napplet Space', replies: [] });
});

test('account changes notify the existing frame and replace storage, files and pending prompts', async ({
  page,
}) => {
  const key = 'a'.repeat(64);
  await page.addInitScript((key) => {
    (window as any).nostr = { getPublicKey: async () => key };
  }, key);
  const frame = await start(page);
  await frame.evaluate(async () => {
    const n = (window as any).napplet;
    (window as any).changes = [];
    n.identity.onChanged((pubkey: string) => (window as any).changes.push(pubkey));
    await n.storage.setItem('level', 'guest-level');
    await n.fs.write('/files/guest.txt', btoa('guest file'));
  });
  await expect(page.getByRole('link', { name: 'guest.txt ↓' })).toBeVisible();
  const pending = frame.evaluate(() =>
    (window as any).napplet.fs.pickSaveFile({ suggestedName: 'pending.txt' }).catch(String),
  );
  await expect(page.getByRole('dialog', { name: 'Save napplet file' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Connect browser extension' }).click();
  await expect.poll(() => frame.evaluate(() => (window as any).changes)).toEqual([key]);
  expect(await pending).toContain('Identity changed');
  await expect(page.getByRole('dialog', { name: 'Save napplet file' })).toHaveCount(0);
  await expect(page.locator('.host-files')).toHaveCount(0);
  expect(
    await frame.evaluate(async () => {
      const n = (window as any).napplet;
      const level = await n.storage.getItem('level');
      await n.storage.setItem('level', 'account-level');
      return { level, identity: await n.identity.getPublicKey(), files: await n.fs.list('/files') };
    }),
  ).toEqual({ level: null, identity: key, files: [] });
  await page.getByRole('button', { name: `${key.slice(0, 6)}…`, exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect from this app' }).click();
  await expect.poll(() => frame.evaluate(() => (window as any).changes)).toEqual([key, '']);
  expect(await frame.evaluate(() => (window as any).napplet.storage.getItem('level'))).toBe(
    'guest-level',
  );
  // The same execution context survived both changes: its listener history remains.
  await page.getByRole('button', { name: 'Connect browser extension' }).click();
  await expect.poll(() => frame.evaluate(() => (window as any).changes)).toEqual([key, '', key]);
  expect(await frame.evaluate(() => (window as any).napplet.storage.getItem('level'))).toBe(
    'account-level',
  );
});
