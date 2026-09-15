import { test, expect } from 'bun:test';
import { nip19 } from 'nostr-tools';
import { commentParts } from './comment-content';
import fixtures from '../../backend/data/catalog.json';
import { PlaybackCoordinator } from '../../../apps/web/src/lib/playback-coordinator';

test('comments preserve ordinary text and recognize portable, named, revision and profile references', () => {
  const reference = fixtures[0].naddr;
  const text = `Try (nostr:${reference}), https://other.example/n/${reference}/play!\nhttps://napplet.soy/@alice/demo/play ${nip19.npubEncode(fixtures[0].pubkey)}`;
  const parts = commentParts(text);
  expect(parts.map((p) => p.text).join('')).toBe(text);
  expect(parts.filter((p) => p.type === 'napplet')).toHaveLength(2); // Same address is embedded once.
  expect(parts.find((p) => p.type === 'profile')).toMatchObject({ pubkey: fixtures[0].pubkey });
  expect(commentParts(`nostr:${nip19.noteEncode(fixtures[0].snapshot.id)}`)[0]).toMatchObject({
    type: 'napplet',
    target: { type: 'snapshot' },
  });
  expect(commentParts('https://other.example/@alice/demo')[0].type).toBe('link');
  expect(
    commentParts(
      `nostr:${nip19.naddrEncode({ kind: 30023, pubkey: fixtures[0].pubkey, identifier: 'article' })}`,
    )[0].type,
  ).toBe('link');
});

test('media supports exact NIP-92 URL metadata, optional hashes and bounded safe fallbacks', () => {
  const url = 'https://media.example/blob',
    hash = 'a'.repeat(64);
  const tags = [['imeta', `url ${url}`, 'm image/png', `x ${hash}`, 'alt A tiny world']];
  expect(commentParts(url, tags)[0]).toMatchObject({ type: 'image', hash, alt: 'A tiny world' });
  expect(commentParts(url + '?other', tags)[0].type).toBe('link');
  expect(commentParts(url, [...tags, ...tags])[0].type).toBe('link');
  expect(commentParts(url, [['imeta', `url ${url}`, 'm image/png', 'x bad']])[0].type).toBe('link');
  expect(
    commentParts(
      'http://media.example/a.png https://media.example/a.svg https://user:pass@media.example/a.png',
    ).filter((p) => p.type === 'image'),
  ).toHaveLength(0);
  expect(
    commentParts(
      Array.from({ length: 8 }, (_, n) => `https://media.example/${n}.png`).join(' '),
    ).filter((p) => p.type === 'image'),
  ).toHaveLength(4);
  expect(commentParts('<script>alert(1)</script>')[0]).toEqual({
    type: 'text',
    text: '<script>alert(1)</script>',
  });
});

test('explicit playback replaces earlier owners, while automatic previews cannot interrupt it', () => {
  const state = new PlaybackCoordinator(),
    a = {},
    b = {},
    c = {};
  let stopped = 0;
  expect(
    state.claim(a, 'napplet', () => {
      stopped++;
      state.release(a);
    }),
  ).toBe(true);
  expect(state.claim(b, 'preview', () => {})).toBe(false);
  expect(state.claim(b, 'media', () => stopped++)).toBe(true);
  expect(stopped).toBe(1);
  state.release(a); // Old cleanup cannot clear the new owner.
  expect(state.claim(c, 'preview', () => {})).toBe(false);
  expect(state.claim(c, 'napplet', () => {})).toBe(true);
  expect(stopped).toBe(2);
});
