import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools';
import records from '../packages/backend/data/catalog.json';
import { configuredPublicRelays, selectPublicManifests, refreshPublicCatalog } from './publicdev';
import { decodeAddress } from '../packages/protocol/src';
import { validateManifest } from '../packages/protocol/src/manifest';
import { publicIp, blossomUrl } from '../packages/backend/src/blossom';
import { RUNTIME_PROFILE } from '../packages/runtime/src/capabilities';
const n = records[0];
const key = new Uint8Array(32);
key[31] = 1;
const sign = (
  tags = n.current.tags.filter((t) => !['e', 'x', 'd'].includes(t[0])),
  kind = 35129,
  time = n.current.created_at,
) =>
  finalizeEvent(
    {
      kind,
      created_at: time,
      content: '',
      tags: kind === 35129 ? [...tags, ['d', 'a-long-public-napplet-identifier']] : tags,
    },
    key,
  );
test('public manifests need no Space snapshot tag; roots and actual snapshots are supported', async () => {
  const result = await validateManifest(sign());
  expect(decodeAddress(result.naddr!).identifier).toBe('a-long-public-napplet-identifier');
  expect((await validateManifest(sign(undefined, 15129))).identity?.kind).toBe(15129);
  expect((await validateManifest(n.snapshot)).identity).toBeNull();
  await expect(validateManifest(sign(undefined, 35128))).rejects.toThrow();
  await expect(validateManifest({ ...sign(), content: 'forged' })).rejects.toThrow();
});
test('the newest signed but invalid package never exposes an older version as current', async () => {
  const older = sign();
  const newer = sign([['path', '/invalid.html', n.artifactHash]], 35129, older.created_at + 1);
  const result = await selectPublicManifests([older, newer]);
  expect(result.entries).toHaveLength(0);
  expect(result.rejected).toBe(1);
});
test('public import verifies downloaded bytes, caches once, and survives relay outages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-public-'));
  let requests = 0;
  const options = {
    relays: ['wss://relay.example/'],
    now: Date.now(),
    discover: async () => {
      requests++;
      return [sign()];
    },
    download: async () =>
      new Uint8Array(
        await Bun.file(`packages/backend/data/artifacts/${n.artifactHash}.html`).arrayBuffer(),
      ),
  };
  try {
    const first = await refreshPublicCatalog(dir, options);
    expect(first.cache?.entries[0].availability).toBe('ready');
    expect((await refreshPublicCatalog(dir, options)).source).toBe('cache');
    expect(requests).toBe(1);
    const fail = async () => {
      throw new Error('offline');
    };
    expect(
      (await refreshPublicCatalog(dir, { ...options, refresh: true, discover: fail })).source,
    ).toBe('stale-cache');
    const mismatchDir = join(dir, 'wrong');
    const mismatch = await refreshPublicCatalog(mismatchDir, {
      ...options,
      download: async () => new TextEncoder().encode('tampered'),
    });
    expect(mismatch.cache?.entries[0].availability).toBe('unavailable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('Blossom hints cannot reach private or special IP ranges; credentials and redirects are not accepted', () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
  ])
    expect(publicIp(ip)).toBe(false);
  expect(publicIp('1.1.1.1')).toBe(true);
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com:8443',
    'https://example.com/?x=1',
  ])
    expect(() => blossomUrl(url, n.artifactHash)).toThrow();
  expect(() => configuredPublicRelays('https://example.com')).toThrow();
  expect(configuredPublicRelays('wss://relay.example')).toEqual(['wss://relay.example/']);
});

test('a new runtime profile refreshes cached capability decisions and downloads supported manifests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-profile-'));
  const tags = n.current.tags.filter((t) => !['e', 'x', 'd'].includes(t[0]));
  const supported = sign([...tags, ['requires', 'fs']]);
  let calls = 0;
  const options = {
    relays: ['wss://relay.example/'],
    now: Date.now(),
    discover: async () => {
      calls++;
      return [supported];
    },
    download: async () =>
      new Uint8Array(
        await Bun.file(`packages/backend/data/artifacts/${n.artifactHash}.html`).arrayBuffer(),
      ),
  };
  try {
    const first = await refreshPublicCatalog(dir, options);
    expect(first.cache?.entries[0].availability).toBe('ready');
    await Bun.write(
      join(dir, 'catalog.json'),
      JSON.stringify({ ...first.cache, runtime: 'older-host-profile' }),
    );
    const next = await refreshPublicCatalog(dir, options);
    expect(next.source).toBe('network');
    expect(calls).toBe(2);
    expect(next.cache?.runtime).toBe(RUNTIME_PROFILE);
    const unsupported = sign([...tags, ['requires', 'connect']]);
    const result = await refreshPublicCatalog(dir, {
      ...options,
      refresh: true,
      discover: async () => [unsupported],
      download: async () => {
        throw new Error('must not download');
      },
    });
    expect(result.cache?.entries[0].availability).toBe('host-required');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
