import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, type EventTemplate } from 'nostr-tools';
import sharp from 'sharp';
import records from '../data/catalog.json';
import {
  appReferences,
  descriptorImages,
  latestMetadata,
  validatedPreview,
  MAX_PREVIEW_BYTES,
  PREVIEW_PROFILE,
} from '../../protocol/src/preview';
import { sha256 } from '../../protocol/src';
import { normalizePreview, indexPreviewImages } from './preview-images';
import { previewResponse, previewImage } from './previews';
import { ogResponse, ogImage } from './og';
import { publicNapplet, publicPoster } from './public-model';
import { readPublicCatalog } from './public-catalog';
import { refreshPublicCatalog } from '../../../scripts/publicdev';

const n = records[0];
const key = new Uint8Array(32);
key[31] = 1;
const sign = (template: EventTemplate) => finalizeEvent({ ...template }, key);
const descriptor = (
  kind = 32267,
  tags = [['image', 'https://images.example/cover.png']],
  content = '',
  created_at = n.current.created_at,
) => sign({ kind, created_at, content, tags: [['d', 'application'], ...tags] });
const manifest = (app = descriptor()) =>
  sign({
    ...n.current,
    tags: [
      ...n.current.tags,
      ['app', `${app.kind}:${app.pubkey}:application`, 'wss://relay.example'],
    ],
  });
const raster = () =>
  sharp({ create: { width: 48, height: 30, channels: 4, background: '#ed7359' } })
    .png()
    .toBuffer();
const source = async () =>
  new Uint8Array(
    await Bun.file(`packages/backend/data/artifacts/${n.artifactHash}.html`).arrayBuffer(),
  );

test('standard app references select the signed newest descriptor without branding or same-author requirements', () => {
  const old = descriptor();
  const latest = descriptor(32267, [], '', old.created_at + 1);
  const event = manifest(old);
  const ref = appReferences(event)[0];
  expect(ref.kind).toBe(32267);
  expect(latestMetadata(ref, [old, latest, { ...latest, content: 'forged' }])?.id).toBe(latest.id);
  expect(descriptorImages(latest)).toEqual([]);
  expect(
    appReferences({
      ...event,
      tags: [
        ['app', `39999:${n.pubkey}:x`],
        ['app', 'bad'],
      ],
    }),
  ).toEqual([]);
  const otherKey = new Uint8Array(32);
  otherKey[31] = 2;
  const copied = finalizeEvent({ ...event }, otherKey);
  expect(appReferences(copied)).toEqual(appReferences(event));
});

test('NIP-89 uses picture and only falls back to its author profile for empty content', () => {
  const profile = sign({
    kind: 0,
    created_at: n.current.created_at,
    tags: [],
    content: JSON.stringify({ picture: 'https://images.example/profile.png' }),
  });
  expect(
    descriptorImages(
      descriptor(31990, [], '{"picture":"https://images.example/app.png"}'),
      profile,
    ),
  ).toEqual(['https://images.example/app.png']);
  expect(descriptorImages(descriptor(31990), profile)).toEqual([
    'https://images.example/profile.png',
  ]);
  expect(descriptorImages(descriptor(31990, [], '{}'), profile)).toEqual([]);
  expect(descriptorImages(descriptor(31990, [], '{broken'), profile)).toEqual([]);
  expect(
    descriptorImages(
      descriptor(32267, [
        ['icon', 'icon'],
        ['image', 'shot'],
      ]),
    ),
  ).toEqual(['shot', 'icon']);
});

test('previews are decoded into bounded PNGs; SVG, invalid images, oversized bodies and pixel bombs fail', async () => {
  const normalized = await normalizePreview(await raster());
  expect(normalized.width).toBe(48);
  expect((await sharp(normalized.data).metadata()).format).toBe('png');
  await expect(
    normalizePreview(new TextEncoder().encode('<svg><script>bad()</script></svg>')),
  ).rejects.toThrow('Unsupported');
  await expect(normalizePreview(new Uint8Array(MAX_PREVIEW_BYTES + 1))).rejects.toThrow(
    'byte limit',
  );
  const bomb = await sharp({
    create: { width: 4001, height: 4001, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  await expect(normalizePreview(bomb)).rejects.toThrow();
});

test('linked screenshots reach cached gallery/player covers and OG images, with safe missing-file fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-linked-preview-'));
  const oldEnv = {
    enabled: process.env.SPACE_PUBLICDEV,
    directory: process.env.SPACE_PUBLICDEV_DIR,
  };
  let downloads = 0;
  try {
    const app = descriptor();
    const event = manifest(app);
    const bytes = await raster();
    const options = {
      relays: ['wss://relay.example/'],
      discover: async () => [event],
      download: source,
      metadata: async () => [app],
      previewDownload: async () => {
        downloads++;
        return bytes;
      },
    };
    const indexed = await refreshPublicCatalog(directory, options);
    expect(indexed.cache?.previews).toBe(PREVIEW_PROFILE);
    const entry = indexed.cache!.entries[0];
    expect(entry.availability).toBe('ready');
    expect(entry.preview?.descriptor.id).toBe(app.id);
    expect(publicPoster(entry)).toStartWith('/api/previews/');
    expect((await refreshPublicCatalog(directory, options)).source).toBe('cache');
    await refreshPublicCatalog(directory, { ...options, refresh: true });
    // Mutable HTTPS images are fetched again on refresh; the ordinary TTL cache does no work.
    expect(downloads).toBe(2);
    process.env.SPACE_PUBLICDEV = '1';
    process.env.SPACE_PUBLICDEV_DIR = directory;
    expect((await readPublicCatalog())?.entries[0].preview?.hash).toBe(entry.preview!.hash);
    expect((await previewImage(event.id))?.equals(bytes)).toBe(true);
    const request = new Request(`http://localhost/api/previews/${event.id}`);
    const response = await previewResponse(event.id, request);
    expect(response.headers.get('content-type')).toBe('image/png');
    const etag = response.headers.get('etag')!;
    expect(
      (await previewResponse(event.id, new Request(request, { method: 'HEAD' }))).body,
    ).toBeNull();
    expect(
      (
        await previewResponse(
          event.id,
          new Request(request, { headers: { 'if-none-match': etag } }),
        )
      ).status,
    ).toBe(304);
    const og = (await ogImage(event.id))!;
    expect((await sharp(og).metadata()).width).toBe(1200);
    const pixel = await sharp(og)
      .extract({ left: 900, top: 300, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([237, 115, 89]);
    const ogEtag = (await ogResponse(event.id, request)).headers.get('etag');
    await Bun.write(join(directory, 'previews', `${entry.preview!.hash}.png`), 'corrupt');
    expect(await previewImage(event.id)).toBeNull();
    expect((await previewResponse(event.id, request)).status).toBe(200);
    expect((await ogResponse(event.id, request)).headers.get('etag')).not.toBe(ogEtag);
    expect((await previewResponse('0'.repeat(64), request)).status).toBe(404);
    process.env.SPACE_PUBLICDEV = '0';
    expect((await previewResponse(event.id, request)).status).toBe(404);
  } finally {
    if (oldEnv.enabled === undefined) delete process.env.SPACE_PUBLICDEV;
    else process.env.SPACE_PUBLICDEV = oldEnv.enabled;
    if (oldEnv.directory === undefined) delete process.env.SPACE_PUBLICDEV_DIR;
    else process.env.SPACE_PUBLICDEV_DIR = oldEnv.directory;
    await rm(directory, { recursive: true, force: true });
  }
});

test('bad metadata, missing images, unsafe URLs and wrong hashes cannot block or change playable manifests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-preview-fallback-'));
  try {
    const bytes = await raster();
    const digest = await sha256(bytes);
    const app = descriptor(32267, [
      ['image', `https://images.example/${'0'.repeat(64)}`],
      ['image', `https://images.example/${digest}`],
    ]);
    const event = manifest(app);
    const entry = await publicNapplet(event);
    await indexPreviewImages(directory, [entry], [app], AbortSignal.timeout(5000), {
      download: async () => bytes,
    });
    expect(entry.preview?.url).toEndWith(digest);
    expect(
      validatedPreview(event, { ...entry.preview, url: 'https://unrelated.example/' }),
    ).toBeNull();
    expect(
      validatedPreview(event, { ...entry.preview, descriptor: { ...app, content: 'forged' } }),
    ).toBeNull();
    for (const url of [
      'https://127.0.0.1/a.png',
      'http://example.com/a.png',
      'file:///etc/passwd',
      'data:image/png;base64,bad',
    ]) {
      const bad = descriptor(32267, [['image', url]]);
      const item = await publicNapplet(manifest(bad));
      await indexPreviewImages(directory, [item], [bad], AbortSignal.timeout(1000));
      expect(item.preview).toBeNull();
    }
    const result = await refreshPublicCatalog(directory, {
      refresh: true,
      relays: ['wss://relay.example/'],
      discover: async () => [event],
      download: source,
      metadata: async () => {
        throw new Error('offline');
      },
    });
    expect(result.source).toBe('network');
    expect(result.cache?.entries[0].availability).toBe('ready');
    expect(result.cache?.entries[0].preview).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('screenshots take priority over pictures/icons across multiple linked app descriptors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-preview-priority-'));
  try {
    const picture = descriptor(31990, [], '{"picture":"https://images.example/picture.png"}');
    const screenshot = descriptor();
    const event = sign({
      ...manifest(picture),
      tags: [
        ...manifest(picture).tags,
        ['app', `32267:${screenshot.pubkey}:application`, 'wss://relay.example'],
      ],
    });
    const entry = await publicNapplet(event);
    const requested: string[] = [];
    await indexPreviewImages(directory, [entry], [picture, screenshot], AbortSignal.timeout(5000), {
      download: async (url) => {
        requested.push(url.href);
        return raster();
      },
    });
    expect(requested).toEqual(['https://images.example/cover.png']);
    expect(entry.preview?.descriptor.id).toBe(screenshot.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
