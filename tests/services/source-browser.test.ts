import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { aggregateHash, sha256 } from '../../packages/protocol/src';
import { DiscoveryQueue } from '../../packages/backend/src/discovery-queue';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { freezeSource } from '../../packages/publish/src/project';
import { initializePolicy } from '../../packages/moderation/src/policy';

test('source browser: pinned tree, safe highlighting, downloads, fallbacks, moderation and mobile layout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-source-browser-'));
  const root = resolve(import.meta.dir, '../..');
  const html = new TextEncoder().encode(
    '<!doctype html><h1>Small world</h1><script>window.sourceWasExecuted = true</script>',
  );
  const code =
    'export const greeting = "Hello, little world";\n// ' +
    'A deliberately long source line '.repeat(12);
  const files = new Map([
    [
      'README.md',
      new TextEncoder().encode(
        '# Little source world\n<script>window.sourceWasExecuted = true</script>\n\n' +
          Array.from({ length: 9 }, (_, i) => `Readme line ${i + 4}`).join('\n'),
      ),
    ],
    ['src/main.ts', new TextEncoder().encode(code)],
    ['LICENSE', new TextEncoder().encode('MIT — Original author attribution')],
    ['assets/audio.wav', new Uint8Array([0, 255, 0, 10])],
    ['assets/large.txt', new Uint8Array(210 * 1024).fill(65)],
    ['index.html', html],
  ]);
  await freezeSource(join(directory, 'frozen'), files, 1800000000);
  const tar = await Bun.file(join(directory, 'frozen/source.tar')).bytes();
  const archiveHash = await sha256(tar),
    artifactHash = await sha256(html);
  let reads = 0;
  const blossom = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== `/${archiveHash}`)
        return new Response('missing', { status: 404 });
      reads++;
      return new Response(tar);
    },
  });
  const key = new Uint8Array(32);
  key[31] = 1;
  const tags = [
    ['d', 'source-browser'],
    ['title', 'Little source world'],
    ['path', '/index.html', artifactHash],
    ['x', await aggregateHash([{ path: '/index.html', hash: artifactHash }]), 'aggregate'],
  ];
  const event = finalizeEvent(
    {
      kind: 5129,
      created_at: 1,
      content: '',
      tags: [
        ...tags.filter((tag) => tag[0] !== 'd'),
        ['a', '35129:' + getPublicKey(key) + ':source-browser'],
        ['source-archive', `${blossom.url}${archiveHash}`],
        ['source-commit', 'a'.repeat(40)],
        ['source', 'https://git.example/project'],
      ],
    },
    key,
  );
  const noArchive = finalizeEvent({ kind: 35129, created_at: 2, content: '', tags }, key);
  const index = new IndexStore(join(directory, 'index'), true);
  for (const item of [event, noArchive]) {
    index.admit(item);
    index.project(
      item.id,
      { ...(await publicNapplet(item)), availability: 'ready', bytes: html.length },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
  }
  await Bun.write(join(directory, 'index/artifacts', `${artifactHash}.html`), html);
  index.close();
  const policy = join(directory, 'policy.json');
  initializePolicy(policy);
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_LOCAL_BLOSSOM: String(blossom.url),
      SPACE_PUBLICDEV: '0',
      SPACE_MODERATION_FILE: policy,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const logs = new Response(child.stderr).text();
  const stdout = new Response(child.stdout).text();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw new Error('Source browser test server did not start');
    const path = `/r/${event.id}/source`;
    const ssr = await fetch(origin + path);
    expect(ssr.status).toBe(200);
    expect((await ssr.text()).length).toBeLessThan(150000);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/r/${event.id}`);
    await page.locator('.source-section').scrollIntoViewIfNeeded();
    const excerpt = page.getByLabel('First 10 lines of README.md', { exact: true });
    await excerpt.waitFor();
    expect(await excerpt.locator('.readme-line').count()).toBe(10);
    expect(await excerpt.textContent()).toContain('Readme line 10');
    expect(await excerpt.textContent()).not.toContain('Readme line 11');
    expect(await excerpt.textContent()).toContain(
      '<script>window.sourceWasExecuted = true</script>',
    );
    expect(await page.evaluate(() => (window as any).sourceWasExecuted)).toBeUndefined();
    expect(await excerpt.locator('script, iframe, img').count()).toBe(0);
    await page.screenshot({ path: '/tmp/napplet-readme-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.source-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/napplet-readme-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('link', { name: 'Read full file', exact: false }).click();
    expect(new URL(page.url()).searchParams.get('file')).toBe('README.md');
    await page.setViewportSize({ width: 1365, height: 1000 });
    await page.getByRole('heading', { name: 'Made of little things.' }).waitFor();
    expect(await page.getByLabel('Source code for README.md').textContent()).toContain(
      '<script>window.sourceWasExecuted = true</script>',
    );
    expect(await page.evaluate(() => (window as any).sourceWasExecuted)).toBeUndefined();
    expect(await page.locator('.source-reader script, .source-reader iframe').count()).toBe(0);
    await page
      .getByRole('navigation', { name: 'Project files' })
      .getByRole('link', { name: 'main.ts', exact: true })
      .click();
    await page.getByLabel('Source code for src/main.ts').waitFor();
    expect(await page.getByLabel('Source code for src/main.ts').textContent()).toBe(code);
    expect(new URL(page.url()).searchParams.get('file')).toBe('src/main.ts');
    expect(await page.locator('.source-reader .hljs-keyword').count()).toBeGreaterThan(0);
    const permalink = await page
      .getByRole('link', { name: 'Permalink', exact: true })
      .getAttribute('href');
    await page.reload();
    await page.getByLabel('Source code for src/main.ts').waitFor();
    expect(permalink).toContain(event.id);
    const download = await fetch(
      origin +
        (await page.getByRole('link', { name: 'Download src/main.ts' }).getAttribute('href')),
    );
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('content-type')).toBe('application/octet-stream');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await download.text()).toBe(code);
    const archive = await fetch(
      origin + (await page.getByRole('link', { name: 'Download archive' }).getAttribute('href')),
    );
    expect(await sha256(new Uint8Array(await archive.arrayBuffer()))).toBe(archiveHash);
    await page.screenshot({ path: '/tmp/napplet-source-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '/tmp/napplet-source-mobile.png', fullPage: true });
    await page
      .getByRole('navigation', { name: 'Project files' })
      .getByRole('link', { name: 'audio.wav' })
      .click();
    await page.getByRole('heading', { name: 'A binary file.' }).waitFor();
    expect(
      await page.locator('.source-reader audio, .source-reader video, .source-reader img').count(),
    ).toBe(0);
    await page
      .getByRole('navigation', { name: 'Project files' })
      .getByRole('link', { name: 'large.txt' })
      .click();
    await page.getByRole('heading', { name: 'A little too big for this view.' }).waitFor();
    await page.goto(origin + path + '?file=does-not-exist');
    await page.getByRole('heading', { name: 'File not found.' }).waitFor();
    expect((await fetch(`${origin}/api/source?revision=${event.id}&file=../secret`)).status).toBe(
      404,
    );
    await page.goto(`${origin}/r/${noArchive.id}/source`);
    await page
      .getByText('The author has not attached a pinned source archive to this release.', {
        exact: true,
      })
      .waitFor();
    await page.getByRole('link', { name: 'Inspect the built HTML' }).click();
    await page.getByLabel('Source code for index.html').waitFor();
    expect(await page.evaluate(() => (window as any).sourceWasExecuted)).toBeUndefined();
    await page.goto(`${origin}/r/${noArchive.id}`);
    expect(await page.locator('.readme-terminal').count()).toBe(0);
    await page.getByRole('link', { name: 'Browse source', exact: true }).click();
    await page.getByRole('heading', { name: 'Made of little things.' }).waitFor();
    // A queued playable download must not hide the already-verified source archive.
    const updating = new IndexStore(join(directory, 'index'), true);
    updating.project(
      event.id,
      { ...(await publicNapplet(event)), availability: 'unavailable' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    updating.close();
    const queue = new DiscoveryQueue(join(directory, 'index'));
    queue.request(event.id);
    queue.close();
    await page.goto(origin + path);
    await page.getByLabel('Source code for README.md').waitFor();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(reads).toBe(1);
    const blockedPolicy = await Bun.file(policy).json();
    blockedPolicy.revision++;
    blockedPolicy.rules.push({
      type: 'event',
      target: event.id,
      reason: 'test moderation',
      actor: event.pubkey,
      at: 1,
    });
    await Bun.write(policy, JSON.stringify(blockedPolicy));
    expect((await fetch(`${origin}/api/source?revision=${event.id}&archive=1`)).status).toBe(404);
    expect((await fetch(origin + path)).status).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    blossom.stop(true);
    const stderr = await logs;
    await stdout;
    if (stderr) console.error(stderr.slice(-3000));
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
