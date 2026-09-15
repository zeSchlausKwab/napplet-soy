import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { finalizeEvent } from 'nostr-tools';
import { CommentMediaCache, commentMediaResponse, COMMENT_VIDEO_BYTES } from './comment-media';
import { commentTemplate, deletionTemplate, socialScope } from '../../protocol/src/social';
import { sha256 } from '../../protocol/src';
import { communityStore } from '../../community/src/store';
import { initializePolicy, readPolicy, updatePolicy } from '../../moderation/src/policy';
import fixtures from '../data/catalog.json';

const png = new Uint8Array(
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#668844' } })
    .png()
    .toBuffer(),
);
const image = {
  type: 'image' as const,
  url: 'https://media.example/image.png',
  mime: 'image/png',
  alt: 'image',
};
test('comment proxy bounds downloads, deduplicates requests and rejects unsafe formats and digest changes', async () => {
  let calls = 0;
  const cache = new CommentMediaCache(async (_url, _signal, max) => {
    calls++;
    expect(max).toBe(5 * 1024 * 1024);
    return png;
  });
  const [a, b] = await Promise.all([cache.read(image), cache.read(image)]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
  expect(a?.mime).toBe('image/png');
  expect(await cache.read({ ...image, hash: '0'.repeat(64) })).toBeNull();
  const bad = new CommentMediaCache(async () =>
    new TextEncoder().encode('<svg onload="alert(1)"/>'),
  );
  expect(await bad.read(image)).toBeNull();
  await expect(cache.read({ ...image, url: 'http://127.0.0.1/a.png' })).rejects.toThrow();
  const video = await Bun.file(
    new URL('../../../tests/fixtures/preview.webm', import.meta.url),
  ).bytes();
  const clips = new CommentMediaCache(async (_url, _signal, max) => {
    expect(max).toBe(COMMENT_VIDEO_BYTES);
    return video;
  });
  expect((await clips.read({ ...image, type: 'video', mime: 'video/webm' }))?.mime).toBe(
    'video/webm',
  );
  expect(await clips.read({ ...image, type: 'video', mime: 'video/mp4' })).toBeNull();
  const oversize = new CommentMediaCache(async () => new Uint8Array(COMMENT_VIDEO_BYTES + 1));
  expect(await oversize.read({ ...image, type: 'video', mime: 'video/webm' })).toBeNull();
});

test('media cache admission caps concurrent work', async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const cache = new CommentMediaCache(async () => {
    await gate;
    return png;
  });
  const tasks = Array.from({ length: 4 }, (_, i) =>
    cache.read({ ...image, url: `https://media.example/${i}.png` }),
  );
  await expect(cache.read({ ...image, url: 'https://media.example/extra.png' })).rejects.toThrow(
    'busy',
  );
  finish();
  await Promise.all(tasks);
});

test('signed comment media remains bound to its thread and respects deletion and blocks on cache hits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comment-media-'));
  const previous = {
    community: process.env.SPACE_COMMUNITY_DIR,
    moderation: process.env.SPACE_MODERATION_FILE,
  };
  process.env.SPACE_COMMUNITY_DIR = directory;
  process.env.SPACE_MODERATION_FILE = join(directory, 'policy.json');
  initializePolicy(process.env.SPACE_MODERATION_FILE);
  const key = new Uint8Array(32);
  key[31] = 9;
  const root = fixtures[0].current,
    scope = socialScope(root);
  const event = finalizeEvent(commentTemplate(scope, image.url), key);
  let calls = 0;
  const cache = new CommentMediaCache(async () => {
    calls++;
    return png;
  });
  const req = (reference = fixtures[0].naddr, part = 0) =>
    new Request(
      `https://napplet.soy/api/comment-media/${event.id}?reference=${reference}&part=${part}`,
    );
  try {
    communityStore().put(scope.key, [root, event]);
    const ok = await commentMediaResponse(req(), event.id, cache);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('image/png');
    expect((await commentMediaResponse(req(fixtures[1].naddr), event.id, cache)).status).toBe(404);
    expect((await commentMediaResponse(req(fixtures[0].naddr, 9), event.id, cache)).status).toBe(
      404,
    );
    const hash = await sha256(png);
    const change = (
      action: 'block' | 'unblock',
      type: 'hash' | 'pubkey' | 'event',
      target: string,
    ) =>
      updatePolicy(
        { action, type, target, reason: 'Test', revision: readPolicy().revision },
        root.pubkey,
        crypto.randomUUID().replaceAll('-', '').repeat(2),
      );
    for (const [type, target] of [
      ['hash', hash],
      ['pubkey', event.pubkey],
      ['event', event.id],
    ] as const) {
      change('block', type, target);
      expect((await commentMediaResponse(req(), event.id, cache)).ok).toBe(false);
      change('unblock', type, target);
      expect((await commentMediaResponse(req(), event.id, cache)).ok).toBe(true);
    }
    expect(calls).toBe(1);
    communityStore().put(scope.key, [finalizeEvent(deletionTemplate([event]), key)]);
    expect((await commentMediaResponse(req(), event.id, cache)).status).toBe(404);
    expect(calls).toBe(1);
  } finally {
    for (const [name, value] of [
      ['SPACE_COMMUNITY_DIR', previous.community],
      ['SPACE_MODERATION_FILE', previous.moderation],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
