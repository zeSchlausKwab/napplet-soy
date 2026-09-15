import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { detailAssets } from './detail-assets';

// Public, offline test key only.
const key = new Uint8Array(32);
key[31] = 1;
const imageUrl = 'https://assets.example/cover.png';
const clipUrl = 'https://assets.example/clip.webm';
const hash = 'a'.repeat(64);
function fixture(extra: string[][] = []) {
  const descriptor = finalizeEvent(
    {
      kind: 32267,
      created_at: 1700000000,
      content: clipUrl,
      tags: [
        ['d', 'assets'],
        ['image', imageUrl],
        ['imeta', `url ${clipUrl}`, 'm video/webm', `x ${hash}`],
        ...extra,
      ],
    },
    key,
  );
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: 1700000000,
      content: '',
      tags: [
        ['d', 'napplet'],
        ['app', `32267:${descriptor.pubkey}:assets`],
        ['source-archive', `https://assets.example/${hash}.tar`],
      ],
    },
    key,
  );
  return {
    manifest,
    image: { descriptor, url: imageUrl, hash, width: 960, height: 600, bytes: 2048 },
    video: {
      descriptor,
      url: clipUrl,
      hash,
      width: 960,
      height: 600,
      bytes: 22521,
      durationMs: 2560,
    },
  };
}

test('linked files use the selected revision and existing verified delivery endpoints', () => {
  const { manifest, image, video } = fixture();
  const assets = detailAssets(manifest, image, video);
  expect(assets.map((a) => a.title)).toEqual(['Preview image', 'Preview clip', 'Source archive']);
  expect(assets[0]).toMatchObject({
    href: `/api/previews/${manifest.id}?v=${hash}`,
    detail: 'PNG · 960 × 600 · 2.0 KB',
  });
  expect(assets[1]).toMatchObject({
    href: `/api/preview-videos/${manifest.id}?v=${hash}`,
    detail: 'WebM · 2.6 sec · 22.0 KB',
  });
  expect(assets[2]).toMatchObject({
    href: `/api/source?revision=${manifest.id}&view=project&archive=1`,
    download: 'source.tar',
  });
});

test('additional declared files are opt-in links, deduplicated and never active URL schemes', () => {
  const { manifest, image, video } = fixture([
    ['image', 'https://assets.example/another.png'],
    ['icon', imageUrl],
    ['icon', 'javascript:alert(1)'],
  ]);
  const additional = detailAssets(manifest, image, video).filter((a) =>
    a.title.startsWith('Additional'),
  );
  expect(additional).toEqual([
    {
      kind: 'image',
      title: 'Additional image 1',
      href: 'https://assets.example/another.png',
      detail: 'Original file · assets.example',
    },
  ]);
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,bad',
    'https://user:password@assets.example/file',
  ]) {
    const f = fixture([['image', url]]);
    expect(detailAssets(f.manifest, f.image, f.video).map((a) => a.href)).not.toContain(url);
  }
});

test('unrelated or tampered metadata does not become an attachment and an empty listing stays empty', () => {
  const { manifest, image, video } = fixture();
  expect(detailAssets({ ...manifest, tags: [] }, image, video)).toEqual([]);
  const forged = { ...image.descriptor, content: 'tampered' };
  expect(
    detailAssets(manifest, { ...image, descriptor: forged }, { ...video, descriptor: forged }).map(
      (a) => a.kind,
    ),
  ).toEqual(['source']);
  expect(detailAssets({ ...manifest, tags: [] })).toEqual([]);
});

test('malformed or ambiguous source archive references do not become downloads', () => {
  const { manifest } = fixture();
  for (const tags of [
    [['source-archive', 'javascript:alert(1)']],
    [['source-archive', 'https://assets.example/not-a-digest.tar']],
    [['source-archive', `https://assets.example/${hash}.tar#other`]],
    [manifest.tags[2], manifest.tags[2]],
  ])
    expect(detailAssets({ ...manifest, tags })).toEqual([]);
});
