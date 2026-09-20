import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stack } from './publish-stack';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { writeBinding, readBinding } from '../../packages/publish/src/binding';
import { checkpoint } from '../../packages/publish/src/git-source';
import { sourceGit } from '../../packages/grasp/src/client';
import { importAsset } from '../../packages/assets/src';
import { loadRemix, createRemix } from '../../packages/remix/src';
import { createWorkshop, type Workshop } from '../../apps/cli/src/workshop';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { sha256 } from '../../packages/protocol/src';

test('local workshop: edit, checkpoint, check, publish, propose with an asset, play both versions, merge and release', async () => {
  const services = await stack();
  let uploadsBlocked = true;
  const uploadProxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'PUT' && uploadsBlocked)
        return new Response('Temporary upload failure', { status: 503 });
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete('host');
      return fetch(services.targets.blossom + url.pathname + url.search, {
        method: request.method,
        headers,
        redirect: 'manual',
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      });
    },
  });
  const workshops: Workshop[] = [],
    servers: ReturnType<typeof startPreviewServer>[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const values = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => values.get(id) ?? null,
    set: async (id, value) => {
      values.set(id, value);
    },
    delete: async (id) => {
      values.delete(id);
    },
  };
  async function serve(directory: string, accounts: Accounts) {
    const workshop = createWorkshop({ directory, network: 'local', accounts });
    workshops.push(workshop);
    const server = startPreviewServer(
      pathToFileURL(directory + '/'),
      0,
      false,
      await previewAssets(),
      { network: 'local', workshop },
    );
    servers.push(server);
    return { workshop, server };
  }
  async function tab(page: Page, name: string) {
    await page
      .getByRole('navigation', { name: 'Workshop sections' })
      .getByRole('button', { name, exact: true })
      .click();
  }
  async function done(workshop: Workshop) {
    await browserExpect
      .poll(async () => (await workshop.snapshot()).busy, { timeout: 60000 })
      .toBe(false);
    const state = await workshop.snapshot();
    expect(state.job?.error).toBeUndefined();
    expect(state.job?.state).toBe('done');
    return state;
  }
  try {
    const owner = new Accounts('local', join(services.directory, 'owner-keys'), vault),
      contributor = new Accounts('local', join(services.directory, 'contributor-keys'), vault);
    const alice = await owner.create(),
      bob = await contributor.create();
    const original = join(services.directory, 'original');
    await mkdir(original);
    await Bun.write(
      join(original, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Shared toy',
        entry: 'index.html',
        identifier: 'shared-toy',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        preview: { delayMs: 250 },
      }),
    );
    await Bun.write(
      join(original, 'index.html'),
      '<!doctype html><style>body{background:#e7ecd9;padding:40px;font:24px sans-serif}</style><h1>One idea</h1>',
    );
    await Bun.write(join(original, 'LICENSE'), 'MIT');
    await Bun.write(join(original, '.gitignore'), '.napplet-space/\n');
    await checkpoint(original, 'Initial idea', alice.pubkey);
    await writeBinding(original, {
      version: 1,
      project: {
        creator: { pubkey: alice.pubkey, network: 'local' },
        publish: { networks: { local: { ...services.targets, blossom: uploadProxy.url.origin } } },
      },
    });
    const first = await serve(original, owner);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1360, height: 1024 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(first.server.url.href);
    const token = await page.locator('meta[name=soyli-token]').getAttribute('content');
    expect((await fetch(new URL('/workshop', first.server.url))).status).toBe(403);
    expect(
      (
        await fetch(new URL('/workshop', first.server.url), {
          method: 'POST',
          headers: { 'X-Soyli-Token': token!, Origin: 'https://untrusted.invalid' },
          body: '{"action":"review"}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(new URL('/workshop', first.server.url), {
          method: 'POST',
          headers: { 'X-Soyli-Token': token! },
          body: '{"action":"review"}',
        })
      ).status,
    ).toBe(403);
    await page.getByRole('button', { name: 'Manage project', exact: true }).click();
    await page.getByLabel('Display title', { exact: true }).fill('The shared toy');
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved to project files.', { exact: false }).waitFor();
    await tab(page, 'Changes');
    await page.getByRole('button', { name: 'napplet.json', exact: true }).click();
    await browserExpect(page.locator('.workshop-diff')).toContainText('The shared toy');
    await page.getByLabel('What changed?', { exact: true }).fill('Polish the title');
    await page.getByRole('button', { name: 'Save local checkpoint', exact: true }).click();
    await page.getByText('Checkpoint saved locally', { exact: false }).waitFor();
    await tab(page, 'Publish');
    await page.getByRole('button', { name: 'Build & check', exact: true }).click();
    await page
      .getByRole('button', { name: 'Publish this revision', exact: true })
      .waitFor({ timeout: 60000 });
    expect((await done(first.workshop)).prepared?.cover).toBe(true);
    await browserExpect(page.getByAltText('Checked cover image')).toBeVisible();
    const approvedCover = await sha256(first.workshop.media('preview')!);
    await page.getByRole('button', { name: 'Publish this revision', exact: true }).click();
    await page.getByRole('button', { name: /^Retry publish/ }).waitFor({ timeout: 60000 });
    expect((await first.workshop.snapshot()).pendingJob).toBeTruthy();
    const changedTargets = (await readBinding(original))!;
    changedTargets.project.publish = { networks: { local: services.targets } };
    await writeBinding(original, changedTargets);
    uploadsBlocked = false;
    await page.getByRole('button', { name: 'Reload from files', exact: true }).click();
    await page.getByRole('button', { name: 'Resume saved release', exact: true }).click();
    await browserExpect
      .poll(async () => (await first.workshop.snapshot()).job?.action)
      .toBe('resume');
    await done(first.workshop);
    await page.getByText('Release processed.', { exact: true }).waitFor({ timeout: 60000 });
    const published = (await done(first.workshop)).publication;
    if (published.status === 'not_started') throw new Error('Publication missing');
    expect(published.targets.blossom).toBe(uploadProxy.url.origin);
    expect(published.preview?.hash).toBe(approvedCover);
    const loaded = await loadRemix(published.naddr, 'local', AbortSignal.timeout(15000));
    const remix = await createRemix(services.directory, 'contribution', loaded);
    const binding = (await readBinding(remix.directory))!;
    binding.project.creator = { pubkey: bob.pubkey, network: 'local' };
    binding.project.publish = { networks: { local: services.targets } };
    await writeBinding(remix.directory, binding);
    await importAsset(remix.directory, {
      id: 'portal',
      storage: 'external',
      license: 'MIT',
      bytes: new Uint8Array(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
          'base64',
        ),
      ),
    });
    await Bun.write(
      join(remix.directory, 'index.html'),
      '<!doctype html><style>body{background:#efd6ab;padding:40px;font:24px sans-serif}</style><h1>Two ideas and a portal</h1>',
    );
    const second = await serve(remix.directory, contributor);
    const other = await browser.newPage();
    other.setDefaultTimeout(10000);
    await other.goto(second.server.url.href);
    await other.getByRole('button', { name: 'Manage project', exact: true }).click();
    await tab(other, 'Changes');
    await other.getByLabel('What changed?', { exact: true }).fill('Add a portal and its image');
    await other.getByRole('button', { name: 'Save local checkpoint', exact: true }).click();
    await other.getByText('Checkpoint saved locally', { exact: false }).waitFor();
    await tab(other, 'Proposals');
    await other
      .getByLabel('Describe your proposal', { exact: true })
      .fill('A portal for the shared toy');
    await other.getByRole('button', { name: 'Publish playable proposal', exact: true }).click();
    await other
      .getByText('Playable proposal published.', { exact: true })
      .waitFor({ timeout: 60000 });
    const contribution = await done(second.workshop);
    expect(contribution.publication.status).toBe('not_started');
    const beforeMerge = await sourceGit(original, ['rev-parse', 'HEAD']);
    await tab(page, 'Proposals');
    await page.getByRole('button', { name: 'Open proposal review', exact: true }).click();
    const review = page.frameLocator('.workshop-review');
    await review
      .getByRole('button', { name: 'Play proposed', exact: true })
      .waitFor({ timeout: 60000 });
    await review.getByRole('button', { name: 'Play proposed', exact: true }).click();
    await browserExpect(
      review.frameLocator('#content iframe').frameLocator('#stage iframe').getByRole('heading'),
    ).toHaveText('Two ideas and a portal');
    await review.getByRole('button', { name: 'Play original', exact: true }).click();
    await browserExpect(
      review.frameLocator('#content iframe').frameLocator('#stage iframe').getByRole('heading'),
    ).toHaveText('One idea');
    await review.getByRole('button', { name: 'Changes', exact: true }).click();
    await browserExpect(review.locator('#content pre')).toContainText('napplet.assets.json');
    await mkdir('.local/workshop', { recursive: true });
    await page.screenshot({ path: '.local/workshop/proposals-desktop.png', fullPage: true });
    await review.getByRole('button', { name: 'Merge locally', exact: true }).click();
    await browserExpect(review.locator('#status')).toContainText('Merged locally', {
      timeout: 30000,
    });
    expect(await sourceGit(original, ['rev-parse', 'HEAD'])).not.toBe(beforeMerge);
    expect((await first.workshop.snapshot()).publication).toMatchObject({
      sourceCommit: beforeMerge,
    });
    expect(await Bun.file(join(original, 'napplet.assets.json')).exists()).toBe(true);
    expect((await readBinding(original))?.project.creator?.pubkey).toBe(alice.pubkey);
    await tab(page, 'Publish');
    await page.getByRole('button', { name: 'Build & check', exact: true }).click();
    await page
      .getByRole('button', { name: 'Publish this revision', exact: true })
      .waitFor({ timeout: 60000 });
    await page.screenshot({ path: '.local/workshop/publish-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.local/workshop/publish-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Publish this revision', exact: true }).click();
    await page.getByText('Release processed.', { exact: true }).waitFor({ timeout: 60000 });
    expect((await done(first.workshop)).publication).toMatchObject({
      sourceCommit: await sourceGit(original, ['rev-parse', 'HEAD']),
    });
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(error);
    for (const workshop of workshops) console.error((await workshop.snapshot()).job);
    throw error;
  } finally {
    await browser?.close();
    for (const server of servers) server.stop(true);
    for (const workshop of workshops) await workshop.close();
    uploadProxy.stop(true);
    await services.close();
  }
}, 240000);
