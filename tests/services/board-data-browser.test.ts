import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { backendProject, localBackend } from '../../apps/cli/src/backend';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { browserEngine } from '../../apps/cli/src/browser';

test('independent browsers share run data through the real shim, registry and isolated CVM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-board-data-browser-'));
  let backend: Awaited<ReturnType<typeof localBackend>>;
  let server: ReturnType<typeof startPreviewServer> | undefined;
  let browser: import('@playwright/test').Browser | undefined;
  try {
    await Bun.write(
      join(directory, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Score data fixture',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        requires: ['cvm'],
        backend: {
          boards: [
            {
              board: 'race',
              title: 'Fastest',
              order: 'lowest',
              minimum: 1,
              maximum: 10000,
              dataSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['car'],
                properties: { car: { type: 'string' }, replay: { type: 'string' } },
              },
            },
          ],
        },
      }),
    );
    await Bun.write(join(directory, 'index.html'), '<!doctype html><body>Score attachments</body>');
    const context = await backendProject(directory);
    backend = await localBackend(directory);
    server = startPreviewServer(pathToFileURL(directory + '/'), 0, false, await previewAssets(), {
      network: 'local',
      backend: backend!.provider,
    });
    browser = await (await browserEngine()).chromium.launch({ headless: true });
    const [a, b] = await Promise.all([browser.newPage(), browser.newPage()]);
    await Promise.all([a.goto(server.url.href), b.goto(server.url.href)]);
    const frames = await Promise.all(
      [a, b].map(async (page) => {
        await page.locator('iframe').waitFor();
        const frame = page.frames().find((f) => f.parentFrame())!;
        await frame.waitForFunction(() => !!(window as any).napplet?.cvm);
        return frame;
      }),
    );
    const call = (
      frame: (typeof frames)[number],
      tool: string,
      args: Record<string, unknown> = {},
    ) =>
      frame.evaluate(
        async ({ tool, args }) =>
          (window as any).napplet.cvm.registry.call('soy.boards.v2', tool, args),
        { tool, args },
      );
    const [sessionA, sessionB] = await Promise.all(frames.map((f) => call(f, 'soy_session')));
    const actor = sessionA.structuredContent.actor;
    expect(actor).not.toBe(sessionB.structuredContent.actor);
    const described = await frames[0].evaluate(() =>
      (window as any).napplet.cvm.registry.describe('soy.boards.v2'),
    );
    expect(described.tools.some((t: any) => t.name === 'soy_board_entry' && t.schemaHash)).toBe(
      true,
    );
    const ref = { napplet: context!.napplet, board: 'race' };
    // The entire 8 KiB payload travels both ways through the encrypted transport.
    const data = { car: 'coral', replay: 'x'.repeat(8165) };
    expect(Buffer.byteLength(JSON.stringify(data))).toBe(8192);
    const result = await call(frames[0], 'soy_board_submit', { ...ref, score: 42, data });
    expect(result.isError).not.toBe(true);
    const old = result.structuredContent.own;
    const read = await call(frames[1], 'soy_board_read', ref);
    expect(read.structuredContent.rows[0]).toMatchObject({ actor, score: 42, hasData: true });
    expect(read.structuredContent.rows[0]).not.toHaveProperty('data');
    const entry = await call(frames[1], 'soy_board_entry', {
      ...ref,
      actor,
      revision: old.revision,
    });
    expect(entry.isError).not.toBe(true);
    expect(entry.structuredContent.entry.data).toEqual(data);
    const invalid = await call(frames[0], 'soy_board_submit', {
      ...ref,
      score: 1,
      data: { car: 42 },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain('data.car');
    const competing = await Promise.all([
      call(frames[0], 'soy_board_submit', { ...ref, score: 41, data: { car: 'slower' } }),
      call(frames[0], 'soy_board_submit', { ...ref, score: 40, data: { car: 'fastest' } }),
    ]);
    expect(competing.every((r) => !r.isError)).toBe(true);
    expect(
      (await call(frames[1], 'soy_board_entry', { ...ref, actor })).structuredContent.entry,
    ).toMatchObject({ score: 40, data: { car: 'fastest' } });
    expect(
      (await call(frames[1], 'soy_board_entry', { ...ref, actor, revision: old.revision }))
        .structuredContent,
    ).toMatchObject({ stale: true, entry: null });
    const retry = await call(frames[0], 'soy_board_submit', {
      ...ref,
      score: 40,
      data: { car: 'tie' },
    });
    expect(retry.isError).not.toBe(true);
    expect(
      (await call(frames[1], 'soy_board_entry', { ...ref, actor })).structuredContent.entry.data,
    ).toEqual({ car: 'fastest' });
  } finally {
    await browser?.close();
    server?.stop(true);
    await backend?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
