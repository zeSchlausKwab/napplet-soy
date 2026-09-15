import type { Filter } from 'nostr-tools';
import type { SignedEvent, GallerySearch } from '../../../../packages/protocol/src';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import { socialScope, socialView, rootComment } from '../../../../packages/protocol/src/social';
import { latestProfile, profileView } from '../../../../packages/protocol/src/profile';
import { resolveZapEndpoint, zapTotals } from '../../../../packages/client/src/zaps';
import { protocolClient, network, manifestAllowed } from './network';
import { queryCatalog, availableCatalog } from './protocol-catalog';
import { matchesGallery } from '../../../../packages/protocol/src/topics';
import type {
  GallerySocialData,
  SocialCounts,
} from '../../../../packages/backend/src/gallery-social';

const history = new Map<string, SignedEvent[]>();
const chunks = <T>(items: T[], size = 64) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
export async function readSocial(
  manifest: SignedEvent,
  hints: string[] = [],
  signal?: AbortSignal,
) {
  await validateManifest(manifest);
  const scope = socialScope(manifest),
    client = protocolClient();
  const filters: Filter[] = [
    {
      kinds: [1111],
      ...(scope.address ? { '#A': [scope.address] } : { '#E': [manifest.id] }),
      limit: 200,
    },
    { kinds: [7, 9735], '#e': [manifest.id], limit: 200 },
    ...(scope.address ? [{ kinds: [7, 9735], '#a': [scope.address], limit: 200 }] : []),
  ];
  const raw = new Map((history.get(scope.key) ?? []).filter(manifestAllowed).map((e) => [e.id, e]));
  const add = (events: SignedEvent[]) => events.forEach((e) => raw.set(e.id, e));
  add(await client.query(filters, hints, signal));
  // Resolve referenced releases, reply parents and comment reactions before reducing.
  const refs = [
    ...new Set(
      [...raw.values()].flatMap((e) =>
        e.tags
          .filter((t) => ['e', 'E'].includes(t[0]) && /^[a-f0-9]{64}$/.test(t[1]))
          .map((t) => t[1]),
      ),
    ),
  ]
    .filter((id) => id !== manifest.id && !raw.has(id))
    .slice(0, 128);
  for (const ids of chunks(refs))
    add(
      await client.query([{ ids, kinds: [35129, 15129, 5129, 1111], limit: 200 }], hints, signal),
    );
  const comments = [...raw.values()]
    .filter((e) => rootComment(e, scope))
    .map((e) => e.id)
    .slice(0, 200);
  for (const ids of chunks(comments))
    add(await client.query([{ kinds: [7, 9735], '#e': ids, limit: 200 }], hints, signal));
  const authors = [
    ...new Set(
      [manifest.pubkey, ...raw.values()].map((e) => (typeof e === 'string' ? e : e.pubkey)),
    ),
  ].slice(0, 256);
  for (const keys of chunks(authors))
    add(await client.query([{ kinds: [0, 5], authors: keys, limit: 200 }], hints, signal));
  const manifests = new Map([[manifest.id, manifest]]);
  for (const e of raw.values())
    if ([35129, 15129, 5129].includes(e.kind))
      try {
        await validateManifest(e);
        manifests.set(e.id, e);
      } catch {}
  const events = [...raw.values()]
    .filter(manifestAllowed)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 2000);
  history.set(scope.key, events);
  while (history.size > 128) history.delete(history.keys().next().value!);
  const profiles = Object.fromEntries(
    authors.map((key) => [key, profileView(key, latestProfile(events, key))]),
  );
  const lastActions: Record<string, number> = {};
  events
    .filter((e) => [7, 5, 1111].includes(e.kind))
    .forEach((e) => (lastActions[e.pubkey] = Math.max(lastActions[e.pubkey] ?? 0, e.created_at)));
  return {
    scope,
    manifest,
    relays: [...new Set([...network().relays, ...hints])].slice(0, 8),
    ...socialView(scope, events, manifests),
    profiles,
    lastActions,
    events,
    manifests,
  };
}
export async function publishSocial(event: SignedEvent, relays: string[]) {
  const accepted = await protocolClient().publish(event, relays);
  // Acknowledged events survive relays' eventual read visibility.
  for (const [key, events] of history)
    history.set(key, [...events.filter((e) => e.id !== event.id), event].slice(-2000));
  return accepted;
}
const counts = new Map<string, SocialCounts>();
let cursor = 0;
export async function gallerySocial(
  search: GallerySearch,
  viewer?: string,
  signal?: AbortSignal,
): Promise<GallerySocialData> {
  const entries = (availableCatalog().length ? availableCatalog() : await queryCatalog()).filter(
    (n) => matchesGallery(n, search) && (search.unavailable || n.availability === 'ready'),
  );
  const batch = Array.from(
    { length: Math.min(12, entries.length) },
    (_, i) => entries[(cursor + i) % entries.length],
  );
  cursor += batch.length;
  let index = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (index < batch.length) {
        const n = batch[index++];
        try {
          const data = await readSocial(n.manifest, n.relays, signal);
          let total: { zapCount: number; msats: number } | null = null;
          try {
            if (!n.manifest.tags.some((t) => t[0] === 'zap'))
              total = await zapTotals(data, data, await resolveZapEndpoint(n.pubkey, data.events));
          } catch {}
          counts.set(n.revisionId, {
            likeCount: data.likeCount,
            liked: !!viewer && data.likes.some((e) => e.pubkey === viewer),
            commentCount: data.comments.filter((e) => !e.deleted).length,
            zapCount: total?.zapCount ?? null,
            msats: total?.msats ?? null,
          });
        } catch {
          signal?.throwIfAborted();
        }
      }
    }),
  );
  const rank = (field: 'likeCount' | 'commentCount' | 'msats') =>
    entries
      .filter((n) => (counts.get(n.revisionId)?.[field] ?? 0) > 0)
      .sort(
        (a, b) =>
          (counts.get(b.revisionId)?.[field] ?? 0) - (counts.get(a.revisionId)?.[field] ?? 0),
      )
      .slice(0, 12);
  return {
    counts: Object.fromEntries(
      entries.flatMap((n) =>
        counts.has(n.revisionId) ? [[n.revisionId, counts.get(n.revisionId)!]] : [],
      ),
    ),
    rankings: { liked: rank('likeCount'), commented: rank('commentCount'), zapped: rank('msats') },
    refreshing: entries.some((n) => !counts.has(n.revisionId)),
  };
}
