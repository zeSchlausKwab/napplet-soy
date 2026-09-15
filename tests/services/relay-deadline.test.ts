import { beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools';
import { compilePreviewAssets } from '../../apps/cli/src/preview/bundle';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

let assets: Awaited<ReturnType<typeof compilePreviewAssets>>;
beforeAll(async () => {
  assets = await compilePreviewAssets();
});

test.each([
  {
    name: 'responsive relays',
    stallFallback: false,
    stallPlanning: false,
    empty: false,
    operation: 'query',
  },
  {
    name: 'stalled fallback',
    stallFallback: true,
    stallPlanning: false,
    empty: false,
    operation: 'query',
  },
  {
    name: 'stalled discovery and fallback',
    stallFallback: true,
    stallPlanning: true,
    empty: false,
    operation: 'query',
  },
  {
    name: 'empty stalled reads',
    stallFallback: true,
    stallPlanning: true,
    empty: true,
    operation: 'query',
  },
  {
    name: 'getEvent with stalled fallback',
    stallFallback: true,
    stallPlanning: true,
    empty: false,
    operation: 'getEvent',
  },
])(
  'the real SDK settles before its deadline: $name',
  async ({ stallFallback, stallPlanning, empty, operation }) => {
    const root = await mkdtemp(join(tmpdir(), 'napplet-relay-deadline-'));
    const browser = await chromium.launch({ headless: true });
    let server: ReturnType<typeof startPreviewServer> | undefined;
    const station = finalizeEvent(
      {
        kind: 31237,
        tags: [['d', 'station']],
        content: 'stream',
        created_at: Math.floor(Date.now() / 1000),
      },
      new Uint8Array(32).fill(2),
    );
    try {
      await Bun.write(
        join(root, 'napplet.json'),
        JSON.stringify({
          previewId: crypto.randomUUID(),
          entry: 'index.html',
          requires: ['outbox'],
          relays: ['wss://fallback.example/'],
        }),
      );
      await Bun.write(join(root, 'index.html'), '<!doctype html><p>Relay deadline fixture</p>');
      server = startPreviewServer(pathToFileURL(root + '/'), 0, false, assets);
      const page = await browser.newPage();
      let delivered = false;
      await page.route('**/api/relay-read', async (route) => {
        const input = route.request().postDataJSON();
        if (input.filters[0].kinds?.includes(10002) && !stallPlanning)
          return route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"EOSE"}\n' });
        if (input.relay === 'wss://station.example/' && !empty) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          delivered = true;
          return route.fulfill({
            contentType: 'application/x-ndjson',
            body: JSON.stringify({ type: 'EVENT', event: station }) + '\n{"type":"EOSE"}\n',
          });
        }
        // The host must settle and abort this read before the SDK gives up.
        if (stallFallback) await new Promise((resolve) => setTimeout(resolve, 1200));
        await route
          .fulfill({ contentType: 'application/x-ndjson', body: '{"type":"EOSE"}\n' })
          .catch(() => {});
      });
      await page.goto(String(server.url));
      await page.frameLocator('iframe').getByText('Relay deadline fixture').waitFor();
      const frame = page.frames().find((f) => f.parentFrame())!;
      const result = await frame.evaluate(
        async ({ author, id, operation }) => {
          try {
            const outbox = (window as any).napplet.outbox;
            const options = {
              authors: [author],
              relays: ['wss://station.example'],
              timeoutMs: 800,
              limit: 10,
            };
            return operation === 'getEvent'
              ? await outbox.getEvent(id, options)
              : await outbox.query(
                  [{ kinds: [31237], authors: [author], '#d': ['station'], limit: 10 }],
                  options,
                );
          } catch (error) {
            return { error: (error as Error).message };
          }
        },
        { author: station.pubkey, id: station.id, operation },
      );
      expect(delivered).toBe(!empty);
      if (empty)
        expect(result).toEqual({
          events: [],
          incomplete: true,
          error: 'Relay read did not complete. Please retry.',
        });
      else {
        const wrapped = { event: JSON.parse(JSON.stringify(station)) };
        expect(result).toMatchObject(
          operation === 'getEvent'
            ? { result: wrapped, incomplete: true }
            : { events: [wrapped], incomplete: true },
        );
        expect(result.error).toBeUndefined();
      }
    } finally {
      await browser.close();
      server?.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
