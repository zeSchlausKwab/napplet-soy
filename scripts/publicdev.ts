import { indexPreviewVideos, prunePreviewVideos } from '../packages/backend/src/preview-videos';
import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  identityAddress,
  verifiedEvent,
  sha256,
  MAX_ARTIFACT_BYTES,
} from '../packages/protocol/src';
import { manifestIdentity, validateManifest } from '../packages/protocol/src/manifest';
import { discoverNapplets } from '../packages/nostr/src/discovery';
import { downloadArtifact } from '../packages/backend/src/blossom';
import { discoverPreviewMetadata } from '../packages/backend/src/preview-discovery';
import { indexPreviewImages, prunePreviewImages } from '../packages/backend/src/preview-images';
import { PREVIEW_PROFILE } from '../packages/protocol/src/preview';
import { missingDomains, RUNTIME_PROFILE } from '../packages/runtime/src/capabilities';
import {
  DEFAULT_PUBLIC_RELAYS,
  PUBLIC_CACHE_TTL,
  publicCacheSchema,
  publicNapplet,
  type PublicCache,
} from '../packages/backend/src/public-model';

export function configuredPublicRelays(value = process.env.SPACE_PUBLIC_RELAYS) {
  const relays = value
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : DEFAULT_PUBLIC_RELAYS;
  if (!relays.length || relays.length > 8)
    throw new Error('Configure between one and eight public relays');
  return [
    ...new Set(
      relays.map((relay) => {
        const url = new URL(relay);
        if (
          relay.length > 256 ||
          url.protocol !== 'wss:' ||
          url.username ||
          url.password ||
          url.hash
        )
          throw new Error('Public relay URLs must use wss:// without credentials');
        return url.href;
      }),
    ),
  ].sort();
}
export async function selectPublicManifests(inputs: unknown[]) {
  const newest = new Map<string, ReturnType<typeof verifiedEvent>>();
  let rejected = 0;
  for (const input of inputs) {
    try {
      const event = verifiedEvent(input);
      if (event.created_at > Date.now() / 1000 + 600) throw new Error('Future event');
      const identity = manifestIdentity(event);
      const key = identity ? identityAddress(identity) : event.id;
      const previous = newest.get(key);
      if (
        !previous ||
        event.created_at > previous.created_at ||
        (event.created_at === previous.created_at && event.id < previous.id)
      )
        newest.set(key, event);
    } catch {
      rejected++;
    }
  }
  const entries = [];
  // Choose replaceable winners before checking the package. Never relabel an older valid event as current.
  for (const event of [...newest.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  )) {
    try {
      entries.push(await publicNapplet(event));
    } catch {
      rejected++;
    }
    if (entries.length === 100) break;
  }
  return { entries, rejected };
}
export async function refreshPublicCatalog(
  directory: string,
  options: {
    refresh?: boolean;
    relays?: string[];
    now?: number;
    discover?: typeof discoverNapplets;
    download?: typeof downloadArtifact;
    metadata?: typeof discoverPreviewMetadata;
    previewDownload?: NonNullable<Parameters<typeof indexPreviewImages>[4]>['download'];
  } = {},
) {
  const relays = options.relays ?? configuredPublicRelays();
  const now = options.now ?? Date.now();
  const path = resolve(directory, 'catalog.json');
  let previous: PublicCache | null = null;
  try {
    const file = Bun.file(path);
    if (file.size <= 16 * 1024 * 1024) previous = publicCacheSchema.parse(await file.json());
  } catch {}
  const sameRelays = previous && JSON.stringify(previous.relays) === JSON.stringify(relays);
  if (
    sameRelays &&
    previous!.runtime === RUNTIME_PROFILE &&
    previous!.previews === PREVIEW_PROFILE &&
    !options.refresh &&
    now >= previous!.fetchedAt &&
    now - previous!.fetchedAt < PUBLIC_CACHE_TTL
  )
    return { cache: previous, source: 'cache' as const };
  try {
    const inputs = await (options.discover ?? discoverNapplets)(relays);
    const { entries, rejected } = await selectPublicManifests(inputs);
    const previews = (async () => {
      try {
        const signal = AbortSignal.timeout(20000);
        const metadata = await (options.metadata ?? discoverPreviewMetadata)(
          entries.map((n) => n.manifest),
          relays,
          signal,
        );
        await Promise.all([
          indexPreviewImages(directory, entries, metadata, signal, {
            download: options.previewDownload,
            previous: sameRelays ? previous!.entries : [],
          }),
          indexPreviewVideos(directory, entries, metadata, signal, {
            download: options.previewDownload,
            previous: sameRelays ? previous!.entries : [],
          }),
        ]);
      } catch {
        /* Missing preview metadata must not roll back a fresh playable catalog. */
      }
    })();
    const artifacts = resolve(directory, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    const signal = AbortSignal.timeout(60000);
    const queue = entries.filter((n) => !missingDomains(n.domains).length);
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let n = queue.shift(); n; n = queue.shift()) {
          try {
            const file = Bun.file(resolve(artifacts, `${n.artifactHash}.html`));
            let data: Uint8Array | undefined;
            if ((await file.exists()) && file.size <= MAX_ARTIFACT_BYTES) {
              const cached = new Uint8Array(await file.arrayBuffer());
              if ((await sha256(cached)) === n.artifactHash) data = cached;
            }
            const manifest = await validateManifest(n.manifest);
            data ??= await (options.download ?? downloadArtifact)(
              manifest.servers,
              n.artifactHash,
              signal,
            );
            if (data.length > MAX_ARTIFACT_BYTES || (await sha256(data)) !== n.artifactHash)
              throw new Error('Hash mismatch');
            new TextDecoder('utf-8', { fatal: true }).decode(data);
            await Bun.write(file, data);
            n.bytes = data.length;
            n.availability = 'ready';
          } catch {
            n.availability = 'unavailable';
          }
        }
      }),
    );
    await previews;
    const cache = publicCacheSchema.parse({
      version: 2,
      runtime: RUNTIME_PROFILE,
      previews: PREVIEW_PROFILE,
      fetchedAt: now,
      relays,
      rejected,
      entries,
    });
    const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify(cache, null, 2) + '\n');
    await rename(temporary, path);
    await prunePreviewVideos(directory, [
      ...entries,
      ...(sameRelays ? previous!.entries : []),
    ]).catch(() => {});
    await prunePreviewImages(directory, [
      ...entries,
      ...(sameRelays ? previous!.entries : []),
    ]).catch(() => {});
    return { cache, source: 'network' as const };
  } catch (error) {
    // An explicitly changed relay set must not fall back to another network's saved catalog.
    if (!sameRelays) {
      await mkdir(directory, { recursive: true });
      const empty: PublicCache = {
        version: 2,
        runtime: RUNTIME_PROFILE,
        previews: PREVIEW_PROFILE,
        fetchedAt: 0,
        relays,
        rejected: 0,
        entries: [],
      };
      const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await Bun.write(temporary, JSON.stringify(empty));
      await rename(temporary, path);
    }
    return {
      cache: sameRelays ? previous : null,
      source: sameRelays ? ('stale-cache' as const) : ('unavailable' as const),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
