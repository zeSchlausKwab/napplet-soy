import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import records from '../data/catalog.json';
import { gallery, toCard } from './catalog';
import { publicNapplet } from './public-model';
import { gallerySearchSchema } from '../../protocol/src';
import {
  manifestTopics,
  matchesGallery,
  normalizeTopic,
  topicFacets,
} from '../../protocol/src/topics';

test('topic projection normalizes and deduplicates hashtags without changing the signed event', () => {
  const event = {
    tags: [
      ['t', ' Visual '],
      ['t', '#visual'],
      ['t', 'cafe\u0301'],
      ['t', 'café'],
      ['t', '日本語'],
      ['t', 'two words'],
      ['t', 'hidden\u202e'],
      ['t', 'x'.repeat(65)],
      ['t'],
      ['t', ''],
      ['category', 'public'],
      ['requires', 'game'],
    ],
  };
  const original = JSON.stringify(event);
  expect(manifestTopics(event)).toEqual(['visual', 'café', '日本語']);
  expect(JSON.stringify(event)).toBe(original);
  expect(
    manifestTopics({ tags: Array.from({ length: 100 }, (_, i) => ['t', `topic-${i}`]) }),
  ).toHaveLength(32);
  expect(normalizeTopic(' #Pixel-Art ')).toBe('pixel-art');
  expect(gallerySearchSchema.parse({ tag: '#VISUAL' }).tag).toBe('visual');
  expect(gallerySearchSchema.parse({ category: 'public' })).toEqual({
    tag: '',
    sort: 'curated',
    q: '',
  });
});

test('bundled and relay manifests have identical topic discovery, search and facet behavior', async () => {
  const fixture = toCard(records[0]);
  const imported = await publicNapplet(records[0].current);
  expect(imported.topics).toEqual(fixture.topics);
  expect(imported.topics).toEqual(['visual', 'generative', 'animation']);
  expect(manifestTopics(records[0].snapshot)).toEqual(fixture.topics);
  for (const search of [
    { tag: 'generative', q: 'orbit' },
    { tag: '', q: '#animation' },
    { tag: 'game', q: '' },
  ])
    expect(matchesGallery(imported, search)).toBe(matchesGallery(fixture, search));
  const facets = topicFacets([fixture, imported]);
  expect(facets).toContainEqual({ topic: 'generative', count: 2 });
  expect(await gallery({ tag: 'generative', q: '', sort: 'curated' })).toHaveLength(3);
});

test('missing or unusable topics do not exclude a valid napplet or invent a source category', async () => {
  const key = new Uint8Array(32);
  key[31] = 1;
  const manifest = finalizeEvent(
    {
      ...records[0].current,
      tags: records[0].current.tags
        .filter((t) => t[0] !== 't')
        .concat([
          ['t', ''],
          ['t', 'bad\nlabel'],
        ]),
    },
    key,
  );
  const entry = await publicNapplet(manifest);
  expect(entry.topics).toEqual([]);
  expect(matchesGallery(entry, { tag: '', q: 'orbit' })).toBe(true);
  expect(matchesGallery(entry, { tag: 'visual', q: '' })).toBe(false);
  expect(topicFacets([entry])).toEqual([]);
  await expect(
    publicNapplet({ ...manifest, tags: [...manifest.tags, ['t', 'game']] }),
  ).rejects.toThrow();
});
