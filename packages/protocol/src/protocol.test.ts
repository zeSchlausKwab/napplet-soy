import { describe, expect, test } from 'bun:test';
import { finalizeEvent, nip19 } from 'nostr-tools';
import records from '../../backend/data/catalog.json';
import {
  aggregateHash,
  decodeAddress,
  encodeAddress,
  gallerySearchSchema,
  identityAddress,
  sha256,
  validateRelease,
  verifiedEvent,
} from './index';
import { gallery, resolveNapplet } from '../../backend/src/catalog';

const record = records[0];
const key = new Uint8Array(32);
key[31] = 1;
const sign = (event: typeof record.current) =>
  finalizeEvent(
    { kind: event.kind, content: event.content, created_at: event.created_at, tags: event.tags },
    key,
  );
describe('signed napplet identities and releases', () => {
  test('all fixtures validate with the pinned NIP-5A aggregate format', async () => {
    for (const n of records)
      expect((await validateRelease(n.current, n.snapshot)).artifactHash).toBe(n.artifactHash);
  });
  test('SHA-256 known vector', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  test('aggregate is sorted by hash/path lines and ignores caller order', async () => {
    const paths = [
      { path: '/b.html', hash: 'b'.repeat(64) },
      { path: '/index.html', hash: 'a'.repeat(64) },
    ];
    expect(await aggregateHash(paths)).toBe(
      await sha256(`${'a'.repeat(64)} /index.html\n${'b'.repeat(64)} /b.html\n`),
    );
    expect(await aggregateHash(paths)).toBe(await aggregateHash(paths.reverse()));
  });
  test('duplicate and traversal paths are rejected', async () => {
    await expect(
      aggregateHash([
        { path: '/index.html', hash: record.artifactHash },
        { path: '/index.html', hash: record.artifactHash },
      ]),
    ).rejects.toThrow('duplicate');
    await expect(
      aggregateHash([{ path: '/../secret', hash: record.artifactHash }]),
    ).rejects.toThrow('Invalid');
  });
  test('relay hints do not change identity', () => {
    const identity = decodeAddress(record.naddr);
    expect(identityAddress(decodeAddress(encodeAddress(identity, ['wss://example.com'])))).toBe(
      identityAddress(identity),
    );
  });
  test('nsites and profiles cannot masquerade as napplet addresses', () => {
    expect(() =>
      decodeAddress(nip19.naddrEncode({ kind: 35128, pubkey: record.pubkey, identifier: 'orbit' })),
    ).toThrow();
    expect(() => decodeAddress(nip19.npubEncode(record.pubkey))).toThrow();
  });
  test('forged or changed event signatures are rejected', () => {
    expect(() => verifiedEvent({ ...record.current, content: 'forged' })).toThrow('signature');
  });
  test('a snapshot of another napplet cannot be associated with the current release', async () => {
    const snapshot = sign({
      ...record.snapshot,
      tags: record.snapshot.tags.map((t) =>
        t[0] === 'a' ? ['a', `35129:${record.pubkey}:another-app`] : t,
      ),
    });
    await expect(validateRelease(record.current, snapshot)).rejects.toThrow('another napplet');
  });
  test('optional metadata and aggregate on current do not become release requirements', async () => {
    const current = sign({
      ...record.current,
      tags: record.current.tags.filter(
        (t) => !['e', 't', 'title', 'description', 'x'].includes(t[0]),
      ),
    });
    expect((await validateRelease(current, record.snapshot)).artifactHash).toBe(
      record.artifactHash,
    );
  });
  test('a correctly signed duplicate playable path is rejected', async () => {
    const snapshot = sign({
      ...record.snapshot,
      tags: [...record.snapshot.tags, ['path', '/extra.html', record.artifactHash]],
    });
    await expect(validateRelease(record.current, snapshot)).rejects.toThrow('one self-contained');
  });
  test('named, portable, and snapshot routes agree', async () => {
    const named = await resolveNapplet({ type: 'named', creator: '@space-lab', slug: record.slug });
    const address = await resolveNapplet({ type: 'address', naddr: record.naddr });
    const snapshot = await resolveNapplet({ type: 'snapshot', id: record.snapshot.id });
    expect(named?.snapshot.id).toBe(address?.snapshot.id);
    expect(address?.snapshot.id).toBe(snapshot?.snapshot.id);
    expect(
      await resolveNapplet({ type: 'named', creator: 'space-lab', slug: record.slug }),
    ).toBeNull();
  });
  test('gallery filters are validated and composable', async () => {
    expect((await gallery({ tag: 'game', sort: 'curated', q: '' })).map((n) => n.slug)).toEqual([
      'tiny-tennis',
    ]);
    expect(await gallery({ tag: 'game', sort: 'new', q: 'blob' })).toHaveLength(0);
    expect(
      gallerySearchSchema.parse({ tag: 'x'.repeat(500), sort: 'broken', q: 'x'.repeat(500) }),
    ).toEqual({ tag: '', sort: 'new', q: '' });
  });
});
