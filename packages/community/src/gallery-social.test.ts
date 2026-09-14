import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, matchFilters } from 'nostr-tools';
import { CommunityStore } from './store';
import { SocialService } from '../../backend/src/social-service';
import { GallerySocialService, socialRankings } from '../../backend/src/gallery-social';
import { publicNapplet } from '../../backend/src/public-model';
import {
  socialScope,
  likeTemplate,
  commentTemplate,
  deletionTemplate,
  commentLikeTemplate,
} from '../../protocol/src/social';
import { signAnonymousZap } from '../../../apps/web/src/lib/community-client';
import fixtures from '../../backend/data/catalog.json';

test('gallery aggregation shares bounded refreshes, rotates past the first page and distinguishes unknown counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gallery-social-'));
  const store = new CommunityStore(directory);
  const author = generateSecretKey(),
    visitor = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const entries = await Promise.all(
    Array.from({ length: 30 }, async (_, i) =>
      publicNapplet(
        finalizeEvent(
          {
            ...fixtures[0].current,
            created_at: now - i - 100,
            tags: fixtures[0].current.tags
              .filter((t) => t[0] !== 'd')
              .concat([['d', `entry-${i}`]]),
          },
          author,
        ),
      ),
    ),
  );
  const oldest = entries.at(-1)!,
    scope = socialScope(oldest.manifest);
  const like = finalizeEvent(likeTemplate(scope, oldest.manifest, now - 10), visitor);
  const duplicate = finalizeEvent(likeTemplate(scope, oldest.manifest, now - 9), visitor);
  const comment = finalizeEvent(commentTemplate(scope, 'hello', undefined, now - 8), visitor);
  const reply = finalizeEvent(commentTemplate(scope, 'reply', comment, now - 7), author);
  const commentLike = finalizeEvent(commentLikeTemplate(comment, now - 6), author);
  const deletion = finalizeEvent(deletionTemplate([comment, like], now - 5), visitor);
  const events = [oldest.manifest, like, duplicate, comment, reply, commentLike, deletion];
  let calls = 0,
    active = 0,
    peak = 0;
  const social = new SocialService(store, {
    query: async (_relays, filters) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((done) => setTimeout(done, 1));
      active--;
      return events.filter((e) => matchFilters(filters, e));
    },
    publish: async () => [],
  });
  const gallery = new GallerySocialService(social);
  try {
    expect(await gallery.counts(entries)).toEqual({});
    const first = gallery.refresh(entries, ['wss://relay.example']);
    expect(gallery.refresh(entries, ['wss://relay.example'])).toBe(first);
    await first;
    expect(peak).toBeLessThanOrEqual(3);
    expect(Object.keys(await gallery.counts(entries))).toHaveLength(24);
    const before = calls;
    await gallery.refresh(entries, ['wss://relay.example']);
    expect(calls).toBe(before);
    await gallery.refresh(entries, ['wss://relay.example'], Date.now() + 31000);
    const counts = await gallery.counts(entries, like.pubkey);
    expect(Object.keys(counts)).toHaveLength(30);
    expect(counts[oldest.revisionId]).toEqual({
      likeCount: 1,
      liked: true,
      commentCount: 1,
      zapCount: 0,
      msats: 0,
    });
    const ranks = socialRankings(entries, counts);
    expect(ranks.liked.map((e) => e.revisionId)).toEqual([oldest.revisionId]);
    expect(ranks.commented.map((e) => e.revisionId)).toEqual([oldest.revisionId]);
    expect(ranks.zapped).toEqual([]);
    expect((await gallery.counts(entries, oldest.pubkey))[oldest.revisionId].liked).toBe(false);
    const zapped = {
      ...counts,
      [oldest.revisionId]: { ...counts[oldest.revisionId], zapCount: 1, msats: 100000 },
      [entries[0].revisionId]: { likeCount: 0, commentCount: 0, zapCount: 2, msats: 42000 },
    };
    expect(socialRankings(entries, zapped).zapped[0].revisionId).toBe(oldest.revisionId);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('anonymous signing uses a different verified key per zap and cannot sign comments or likes', async () => {
  const template = {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['p', fixtures[0].pubkey]],
  };
  const first = await signAnonymousZap(template),
    second = await signAnonymousZap(template);
  expect(first.pubkey).not.toBe(second.pubkey);
  expect(first.tags).toEqual(template.tags);
  await expect(signAnonymousZap({ ...template, kind: 7 })).rejects.toThrow(
    'only available for zaps',
  );
  await expect(signAnonymousZap({ ...template, kind: 1111 })).rejects.toThrow();
});
