import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeEvent, matchFilter } from 'nostr-tools';
import records from '../data/catalog.json';
import { encodeAddress } from '../../protocol/src';
import { discoveryTarget } from '../../protocol/src/discovery';
import { DiscoveryQueue } from './discovery-queue';
import { IndexWorker } from './index-worker';
import { indexedProjection } from './index-store';
import { publicNapplet } from './public-model';
import { galleryPage } from './gallery';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const key = new Uint8Array(32);
key[31] = 1;

test('portable inputs normalize identities while preserving bounded relay hints', () => {
  const record = records[0];
  const naddr = encodeAddress(
    { kind: 35129, pubkey: record.pubkey, identifier: record.identifier },
    ['wss://relay.example'],
  );
  const target = discoveryTarget(`https://other-client.example/n/${naddr}`);
  expect(target.key).toBe(`35129:${record.pubkey}:${record.identifier}`);
  expect(target.hints).toEqual(['wss://relay.example']);
  expect(discoveryTarget(`nostr:${naddr}`).key).toBe(target.key);
  expect(discoveryTarget(`https://example.com/r/${record.snapshot.id}`).key).toBe(
    record.snapshot.id,
  );
  for (const bad of [
    'https://example.com/internal',
    'not-an-address',
    'naddr1broken',
    'x'.repeat(4100),
  ])
    expect(() => discoveryTarget(bad)).toThrow();
});

test('discovery queue deduplicates hints, bounds work and recovers abandoned jobs', async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-discovery-'));
  const queue = new DiscoveryQueue(directory);
  try {
    const now = Date.now(),
      address = records[0].naddr;
    const first = queue.request(address, now);
    expect(queue.request(address, now + 1)).toEqual(first);
    expect(queue.take(now)?.key).toBe(first.key);
    expect(queue.take(now + 100)).toBeNull();
    expect(queue.take(now + 61000)?.key).toBe(first.key);
    queue.finish(first.key, 'missing', now + 62000);
    expect(queue.request(address, now + 62001).state).toBe('missing');
    for (let i = 1; i <= 19; i++) queue.request(i.toString(16).padStart(64, '0'), now);
    expect(() => queue.request('f'.repeat(64), now)).toThrow('busy');
  } finally {
    queue.close();
  }
});

test('on-demand discovery verifies and hydrates an exact identity and respects prior deletion', async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-discovery-'));
  const worker = new IndexWorker({
    directory,
    relays: ['wss://configured.example'],
    release: 'test',
  });
  try {
    const manifest = finalizeEvent(
      { ...records[0].current, created_at: Math.floor(Date.now() / 1000) - 60 },
      key,
    );
    const target = discoveryTarget(
      encodeAddress({ kind: 35129, pubkey: manifest.pubkey, identifier: records[0].identifier }),
    );
    const bytes = await Bun.file(
      new URL(`../data/artifacts/${records[0].artifactHash}.html`, import.meta.url),
    ).bytes();
    const queries: unknown[] = [];
    const options = {
      read: async (_: string, filter: Parameters<typeof matchFilter>[0]) => {
        queries.push(filter);
        return matchFilter(filter, manifest) ? [manifest] : [];
      },
      hints: async () => ({ events: [], complete: false }),
      hydrate: { download: async () => bytes, metadata: async () => [] },
    };
    expect(worker.store.row(target.key)).toBeNull();
    expect(await worker.discover(target, AbortSignal.timeout(5000), options)).toBe('found');
    expect((await indexedProjection(worker.store.row(target.key)!, []))?.availability).toBe(
      'ready',
    );
    expect(queries.some((q: any) => q.kinds.includes(5) && q['#a']?.includes(target.key))).toBe(
      true,
    );
    worker.store.admit(
      finalizeEvent(
        { kind: 5, created_at: manifest.created_at + 1, content: '', tags: [['a', target.key]] },
        key,
      ),
    );
    expect(await worker.discover(target, AbortSignal.timeout(5000), options)).toBe('missing');
    const unknown = discoveryTarget('f'.repeat(64));
    expect(
      await worker.discover(unknown, AbortSignal.timeout(5000), {
        ...options,
        read: async () => {
          throw new Error('offline');
        },
      }),
    ).toBe('failed');
  } finally {
    worker.close();
  }
});

test('pagination filters the full indexed collection before slicing and keeps late matches discoverable', async () => {
  const template = await publicNapplet(records[0].current);
  const entries = Array.from({ length: 260 }, (_, i) => ({
    ...template,
    revisionId: i.toString(16).padStart(64, '0'),
    title: i === 259 ? 'Hidden beyond the old window' : `Creation ${i}`,
    topics: i === 259 ? ['rare'] : ['visual'],
    availability: 'ready' as const,
    manifest: { ...template.manifest, created_at: 1000 - i },
  }));
  const search = { tag: '', q: '', sort: 'new' as const };
  expect(galleryPage(entries, search).napplets).toHaveLength(24);
  expect(galleryPage(entries, search).pages).toBe(11);
  expect(galleryPage(entries, { ...search, page: 11 }).napplets).toHaveLength(20);
  expect(galleryPage(entries, { ...search, q: 'Hidden' }).napplets[0].title).toBe(
    'Hidden beyond the old window',
  );
  expect(galleryPage(entries, { ...search, tag: 'rare' }).matches).toBe(1);
});
