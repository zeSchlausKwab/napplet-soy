import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { finalizeEvent } from 'nostr-tools';
import { RUNTIME_DOMAINS } from '../../packages/runtime/src/capabilities';

let root: string, project: string, origin: string, config: Record<string, unknown>, html: string;
let child: ChildProcess, relay: WebSocketServer;
const messages: unknown[][] = [];
const key = new Uint8Array(32);
key[31] = 4;
const event = finalizeEvent(
  { kind: 1, tags: [], content: 'local relay fixture', created_at: Math.floor(Date.now() / 1000) },
  key,
);
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'space-cli-browser-'));
  execFileSync(
    'bun',
    [fileURLToPath(new URL('../../apps/cli/src/index.ts', import.meta.url)), 'new', 'experiment'],
    { cwd: root },
  );
  project = join(root, 'experiment');
  html = await readFile(join(project, 'index.html'), 'utf8');
  config = JSON.parse(await readFile(join(project, 'napplet.json'), 'utf8'));
  relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  relay.on('connection', (socket) =>
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      messages.push(message);
      if (message[0] === 'REQ') {
        socket.send(JSON.stringify(['EVENT', message[1], event]));
        socket.send(JSON.stringify(['EOSE', message[1]]));
      }
    }),
  );
  config.relays = [`ws://127.0.0.1:${(relay.address() as { port: number }).port}/`];
  await writeFile(join(project, 'napplet.json'), JSON.stringify(config));
  child = spawn('bun', ['dev.ts'], {
    cwd: project,
    env: { PATH: process.env.PATH, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 10000);
    child.stdout!.on('data', (data) => {
      output += String(data);
      const url = /Local napplet preview: (http:\/\/[^\s]+)/.exec(output)?.[1];
      if (url) {
        clearTimeout(timeout);
        resolve(url);
      }
    });
    child.stderr!.on('data', (data) => {
      output += String(data);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error(output));
    });
  });
});
test.afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  if (relay) {
    relay.clients.forEach((socket) => socket.terminate());
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});
test.beforeEach(async () => {
  await writeFile(join(project, 'index.html'), html);
  await writeFile(join(project, 'napplet.json'), JSON.stringify(config));
});

test('standalone CLI runs the shared shim and host in verified srcdoc with relay reads and file exports', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  expect(await page.locator('iframe').getAttribute('src')).toBeNull();
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await page.locator('iframe').getAttribute('srcdoc')).toContain("connect-src 'none'");
  const frame = page.frames().find((f) => f.parentFrame())!;
  expect(
    await frame.evaluate(async () => {
      const n = (window as any).napplet;
      const environment = await n.shell.ready();
      await n.storage.setItem('score', '42');
      return {
        domains: environment.capabilities.domains,
        identity: await n.identity.getPublicKey(),
        relays: await n.identity.getRelays(),
        events: await n.relay.query({ kinds: [1] }),
      };
    }),
  ).toEqual({
    domains: [...RUNTIME_DOMAINS],
    identity: '',
    relays: {},
    events: [{ event: JSON.parse(JSON.stringify(event)) }],
  });
  expect(
    await frame.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return 'escaped';
      } catch {
        return 'blocked';
      }
    }),
  ).toBe('blocked');
  // Raw envelope forces the shared resource endpoint, instead of the shim's data-URL shortcut.
  expect(
    await frame.evaluate(
      () =>
        new Promise((resolve) => {
          const id = crypto.randomUUID();
          const listen = async (event: MessageEvent) => {
            if (event.source !== parent || event.data?.id !== id) return;
            window.removeEventListener('message', listen);
            resolve({ type: event.data.type, content: await event.data.blob.text() });
          };
          window.addEventListener('message', listen);
          parent.postMessage(
            { type: 'resource.bytes', id, url: 'data:text/plain,shared-resource-policy' },
            '*',
          );
        }),
    ),
  ).toEqual({ type: 'resource.bytes.result', content: 'shared-resource-policy' });
  const save = frame.evaluate(async () => {
    const fs = (window as any).napplet.fs;
    const picked = await fs.pickSaveFile({ suggestedName: 'score.txt' });
    return fs.write(picked.entries[0].path, btoa('42'));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  expect(await save).toMatchObject({ bytesWritten: 2 });
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'score.txt ↓' }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!, 'utf8')).toBe('42');
  await page.evaluate(() => {
    (window as any).nostr = { getPublicKey: async () => 'a'.repeat(64) };
  });
  await frame.evaluate(() => {
    (window as any).changes = [];
    (window as any).napplet.identity.onChanged((key: string) => (window as any).changes.push(key));
  });
  await page.getByRole('button', { name: 'Connect browser extension' }).click();
  await expect.poll(() => frame.evaluate(() => (window as any).changes)).toEqual(['a'.repeat(64)]);
  expect(await frame.evaluate(() => (window as any).napplet.storage.getItem('score'))).toBeNull();
  await expect(page.getByRole('link', { name: 'score.txt ↓' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect
    .poll(() => frame.evaluate(() => (window as any).changes))
    .toEqual(['a'.repeat(64), '']);
  await page.reload();
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const next = page.frames().find((f) => f.parentFrame())!;
  expect(
    await next.evaluate(async () => {
      const n = (window as any).napplet;
      await n.shell.ready();
      return { score: await n.storage.getItem('score'), files: await n.fs.list('/files') };
    }),
  ).toEqual({ score: '42', files: [] });
  expect(messages.some((message) => message[0] === 'EVENT' || message[0] === 'AUTH')).toBe(false);
});

test('CLI reloads edited source, gates required capabilities and rejects tampered artifact bytes', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  await writeFile(
    join(project, 'index.html'),
    '<body><p id="check">booting</p><script>const before=napplet.shell.supports("storage");napplet.shell.ready().then(()=>document.querySelector("#check").textContent=`before:${before} after:${napplet.shell.supports("storage")}`)</script>',
  );
  await expect(page.frameLocator('iframe').locator('#check')).toHaveText('before:false after:true');
  await writeFile(join(project, 'napplet.json'), JSON.stringify({ ...config, requires: ['cvm'] }));
  await expect(page.getByRole('status')).toContainText('Unsupported required capabilities: cvm');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.route('**/api/artifacts/*', (route) =>
    route.fulfill({ body: '<script>parent.postMessage("unverified", "*")</script>' }),
  );
  await writeFile(join(project, 'napplet.json'), JSON.stringify(config));
  await expect(page.getByRole('status')).toContainText('hash');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.unroute('**/api/artifacts/*');
  await expect(page.frameLocator('iframe').locator('#check')).toHaveText('before:false after:true');
});
