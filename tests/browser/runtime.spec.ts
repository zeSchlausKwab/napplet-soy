import { test, expect } from '@playwright/test';

async function start(page: import('@playwright/test').Page) {
  await page.goto('/@space-lab/soft-orbit');
  await page.getByRole('button', { name: 'Start Soft orbit' }).click();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const frame = page.frames().find((f) => f.parentFrame())!;
  await frame.evaluate(() => (window as any).napplet.shell.ready());
  return frame;
}

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
