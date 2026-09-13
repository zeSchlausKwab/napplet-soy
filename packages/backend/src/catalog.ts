import fixtures from '../data/catalog.json';
import { manifestTopics, matchesGallery } from '../../protocol/src/topics';
import { publicArtifact, readPublicCatalog } from './public-catalog';
import { preparePlayback } from '../../runtime/src/playback';
import { indexedArtifact, indexedRevision, indexStore } from './indexed-catalog';
import {
  decodeAddress,
  identityAddress,
  validateRelease,
  type GallerySearch,
} from '../../protocol/src';

const records = fixtures.map((record) => ({ ...record, topics: manifestTopics(record.current) }));
export type Napplet = (typeof records)[number] & { relays?: string[] };
export type NappletCard = Omit<Napplet, 'current' | 'snapshot'> & {
  currentId: string;
  snapshotId: string;
  createdAt: number;
};
let validated: Promise<void> | undefined;
async function ensureValidated() {
  validated ??= Promise.all(
    records.map(async (record) => {
      const release = await validateRelease(record.current, record.snapshot);
      if (
        release.artifactHash !== record.artifactHash ||
        release.identity.identifier !== record.identifier ||
        release.identity.pubkey !== record.pubkey ||
        decodeAddress(record.naddr).identifier !== record.identifier
      )
        throw new Error('Invalid indexed release');
    }),
  ).then(() => {});
  return validated;
}
export function toCard({ current, snapshot, ...record }: Napplet): NappletCard {
  return {
    ...record,
    currentId: current.id,
    snapshotId: snapshot.id,
    createdAt: current.created_at,
  };
}
export async function gallery(search: GallerySearch) {
  await ensureValidated();
  let list = records.filter((n) => {
    const winner = indexStore()?.row(`35129:${n.pubkey}:${n.identifier}`);
    return (
      !indexStore()?.removed(n.current) &&
      (!winner || winner.id === n.current.id) &&
      matchesGallery(n, search)
    );
  });
  if (search.sort === 'new')
    list = [...list].sort((a, b) => b.current.created_at - a.current.created_at);
  return list.map(toCard);
}
export type Lookup =
  | { type: 'named'; creator: string; slug: string }
  | { type: 'address'; naddr: string }
  | { type: 'snapshot'; id: string };
export async function resolveNapplet(input: Lookup) {
  await ensureValidated();
  if (input.type === 'named') {
    if (!/^@[a-z0-9-]{1,32}$/.test(input.creator) || !/^[a-z0-9-]{1,64}$/.test(input.slug))
      return null;
    return records.find((n) => `@${n.handle}` === input.creator && n.slug === input.slug) ?? null;
  }
  if (input.type === 'snapshot')
    return (
      records.find((n) => n.snapshot.id === input.id && !indexStore()?.removed(n.snapshot)) ?? null
    );
  try {
    const address = identityAddress(decodeAddress(input.naddr));
    const indexed = indexStore()?.row(address);
    return (
      records.find(
        (n) =>
          identityAddress({ kind: 35129, pubkey: n.pubkey, identifier: n.identifier }) ===
            address &&
          (!indexed || indexed.id === n.current.id) &&
          !indexStore()?.removed(n.current),
      ) ?? null
    );
  } catch {
    return null;
  }
}
export async function artifact(hash: string) {
  await ensureValidated();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!records.some((n) => n.artifactHash === hash))
    return (await indexedArtifact(hash)) ?? publicArtifact(hash);
  // Trusted bundled fixtures only. Remote Blossom ingestion is a separate bounded worker task.
  const directory =
    process.env.SPACE_ARTIFACT_DIR ?? new URL('../data/artifacts/', import.meta.url).pathname;
  const file = Bun.file(`${directory}/${hash}.html`);
  return (await file.exists()) ? file : null;
}

/** Resolve only indexed, playable manifests; fixture provenance grants no extra capabilities. */
export async function playableManifest(id: string) {
  await ensureValidated();
  const fixture = records.find((n) => n.current.id === id || n.snapshot.id === id);
  if (
    fixture &&
    indexStore()?.removed(fixture.current.id === id ? fixture.current : fixture.snapshot)
  )
    return null;
  const entry =
    fixture ??
    (await indexedRevision(id)) ??
    (await readPublicCatalog())?.entries.find(
      (n) => n.revisionId === id && n.availability === 'ready',
    );
  if (!entry) return null;
  if ('availability' in entry && entry.availability !== 'ready') return null;
  const manifest =
    'manifest' in entry ? entry.manifest : entry.current.id === id ? entry.current : entry.snapshot;
  try {
    return await preparePlayback(manifest, entry.artifactHash);
  } catch {
    return null;
  }
}
