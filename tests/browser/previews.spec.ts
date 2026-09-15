import { test, expect, type BrowserContext } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string,
  origin: string,
  storageOrigin: string,
  server: ChildProcess,
  storage: ChildProcess;
let entry: {
  title: string;
  naddr: string;
  revisionId: string;
  preview: { hash: string; url: string };
  video: { hash: string; url: string };
};
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-linked-assets-'));
  storage = spawn('bun', ['tests/fixtures/linked-assets-server.ts', directory], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  storageOrigin = await listening(storage);
  entry = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
  await writeFile(
    join(directory, 'policy.json'),
    JSON.stringify({ version: 1, revision: 0, rules: [], audit: [], used: [] }),
  );
  server = spawn('bun', ['apps/web/server.ts'], {
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SPACE_PUBLICDEV: '1',
      SPACE_PUBLICDEV_DIR: directory,
      SPACE_SITE_ORIGIN: 'http://localhost',
      SPACE_MODERATION_FILE: join(directory, 'policy.json'),
      SPACE_INDEX_DIR: '',
      SPACE_INDEX_RELAYS: JSON.parse(await readFile(join(directory, 'relay.json'), 'utf8')).url,
      SPACE_INDEX_LOCAL_BLOSSOM: storageOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await listening(server);
});
function listening(child: ChildProcess) {
  return new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Asset test server did not start')), 10000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
    child.stdout!.on('data', (data) => {
      const match = String(data).match(/listening on (http:\/\/[^\s/]+)/);
      if (match) {
        clearTimeout(timer);
        accept(match[1]);
      }
    });
  });
}
test.afterAll(async () => {
  for (const child of [server, storage])
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill();
      await stopped;
    }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('linked screenshot uses original storage in gallery and player while sharing remains SSR', async ({
  page,
  request,
  browser,
}) => {
  await storageMapping(page.context());
  const remote: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && /^https?:/.test(r.url())) remote.push(r.url());
  });
  await page.goto(`${origin}/?q=${encodeURIComponent(entry.title)}`);
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(1);
  await page.getByRole('link', { name: '#generative', exact: true }).click();
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Filter by #generative', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Filter by #generative', exact: true }).click();
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(1);
  await page.goto(`${origin}/?q=${encodeURIComponent(entry.title)}`);
  await page.getByLabel('Sort napplets').selectOption('featured');
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(0);
  await expect(page.getByText('No featured napplets found.')).toBeVisible();
  await writeFile(
    join(directory, 'policy.json'),
    JSON.stringify({
      version: 1,
      revision: 1,
      rules: [],
      audit: [],
      used: [],
      featured: [
        {
          type: 'event',
          target: entry.revisionId,
          actor: 'a'.repeat(64),
          at: 1,
          reason: 'Browser fixture selection',
        },
      ],
    }),
  );
  await page.reload();
  await expect(page.locator('.napplet-grid > .napplet-card')).toHaveCount(1);
  const image = page.locator('.napplet-grid .card-preview img');
  await expect(image).toHaveAttribute('src', entry.preview.url);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(960);
  await page.locator('.napplet-grid .napplet-card .card-heading a').click();
  const cover = page.locator('.player-cover img');
  await expect(cover).toHaveAttribute('src', entry.preview.url);
  await page.screenshot({ path: resolve('.local/linked-preview-browser.png') });
  await page.getByRole('button', { name: `Start ${entry.title}` }).click();
  await expect(page.locator('iframe')).toBeVisible();
  expect(remote).toContain(entry.preview.url);
  expect(remote.every((url) => url.startsWith(storageOrigin) || url === entry.preview.url)).toBe(
    true,
  );
  const context = await browser.newContext({ javaScriptEnabled: false });
  await storageMapping(context);
  try {
    const noJs = await context.newPage();
    await noJs.goto(`${origin}/n/${entry.naddr}`);
    await expect(noJs.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      new RegExp(`cover=${entry.preview.hash}`),
    );
    expect(
      (await request.get(`${origin}/api/og/${entry.revisionId}`)).headers()['content-type'],
    ).toBe('image/png');
  } finally {
    await context.close();
  }
});

async function storageMapping(context: BrowserContext) {
  // Map the fixture's declared HTTPS origin to our real offline Blossom service.
  // Preserve its bytes, media headers and Range handling, including in new tabs.
  await context.route('https://images.example/**', async (route) => {
    const range = route.request().headers().range;
    const response = await context.request.get(
      `${storageOrigin}${new URL(route.request().url()).pathname}`,
      {
        headers: range ? { Range: range } : {},
      },
    );
    await route.fulfill({ response });
  });
}
