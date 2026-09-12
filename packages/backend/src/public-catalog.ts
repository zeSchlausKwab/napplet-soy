import { resolve } from 'node:path';
import {
  publicCacheSchema,
  PUBLIC_CACHE_TTL,
  publicNapplet,
  type PublicCache,
} from './public-model';
import { decodeAddress, identityAddress } from '../../protocol/src';
import type { Lookup } from './catalog';
import { missingDomains } from '../../runtime/src/capabilities';

// Set by the dev launcher only. No request, hostname, or URL parameter can enable this mode.
export function publicDirectory() {
  return process.env.SPACE_PUBLICDEV === '1' && process.env.SPACE_PUBLICDEV_DIR
    ? resolve(process.env.SPACE_PUBLICDEV_DIR)
    : null;
}
let memo: { directory: string; cache: PublicCache } | undefined;
export async function readPublicCatalog() {
  const directory = publicDirectory();
  if (!directory) return null;
  if (memo?.directory === directory) return memo.cache;
  try {
    const file = Bun.file(resolve(directory, 'catalog.json'));
    if (file.size > 8 * 1024 * 1024) return null;
    const cache = publicCacheSchema.parse(await file.json());
    cache.entries = await Promise.all(
      cache.entries.map(async (entry) => {
        const derived = await publicNapplet(entry.manifest, cache.relays);
        if (derived.artifactHash !== entry.artifactHash || derived.revisionId !== entry.revisionId)
          throw new Error('Corrupt public catalog');
        return {
          ...derived,
          bytes: entry.bytes,
          availability: missingDomains(derived.domains).length
            ? ('host-required' as const)
            : entry.availability,
        };
      }),
    );
    memo = { directory, cache };
    return cache;
  } catch {
    return null;
  }
}
export async function resolvePublicNapplet(input: Lookup) {
  const entries = (await readPublicCatalog())?.entries ?? [];
  if (input.type === 'named') return null;
  if (input.type === 'snapshot')
    return entries.find((n) => n.manifest.kind === 5129 && n.revisionId === input.id) ?? null;
  try {
    const address = identityAddress(decodeAddress(input.naddr));
    return (
      entries.find((n) => n.naddr && identityAddress(decodeAddress(n.naddr)) === address) ?? null
    );
  } catch {
    return null;
  }
}
export async function publicArtifact(hash: string) {
  const directory = publicDirectory();
  if (!directory || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const entry = (await readPublicCatalog())?.entries.find(
    (n) =>
      n.artifactHash === hash && n.availability === 'ready' && !missingDomains(n.domains).length,
  );
  if (!entry) return null;
  const file = Bun.file(resolve(directory, 'artifacts', `${hash}.html`));
  return (await file.exists()) ? file : null;
}
export async function catalogStatus() {
  const cache = await readPublicCatalog();
  return {
    publicdev: !!publicDirectory(),
    publicCount: cache?.entries.length ?? 0,
    fetchedAt: cache?.fetchedAt ?? null,
    stale: !!cache && Date.now() - cache.fetchedAt > PUBLIC_CACHE_TTL,
    relays: cache?.relays ?? [],
    rejected: cache?.rejected ?? 0,
  };
}
