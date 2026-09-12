import records from '../data/catalog.json';
import { publicArtifact, readPublicCatalog } from './public-catalog';
import { preparePlayback } from '../../runtime/src/playback';
import {
  decodeAddress,
  identityAddress,
  validateRelease,
  type GallerySearch,
} from '../../protocol/src';

export type Napplet = (typeof records)[number] & { relays?: string[] };
export type NappletCard = Omit<Napplet, 'current' | 'snapshot'> & {
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
  return { ...record, snapshotId: snapshot.id, createdAt: current.created_at };
}
export async function gallery(search: GallerySearch) {
  await ensureValidated();
  const query = search.q.trim().toLowerCase();
  let list = records.filter(
    (n) =>
      (search.category === 'all' || n.category === search.category) &&
      (!query || `${n.title} ${n.description} ${n.creator}`.toLowerCase().includes(query)),
  );
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
  if (input.type === 'snapshot') return records.find((n) => n.snapshot.id === input.id) ?? null;
  try {
    const address = identityAddress(decodeAddress(input.naddr));
    return (
      records.find(
        (n) =>
          identityAddress({ kind: 35129, pubkey: n.pubkey, identifier: n.identifier }) === address,
      ) ?? null
    );
  } catch {
    return null;
  }
}
export async function artifact(hash: string) {
  await ensureValidated();
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!records.some((n) => n.artifactHash === hash)) return publicArtifact(hash);
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
  const entry =
    fixture ??
    (await readPublicCatalog())?.entries.find(
      (n) => n.revisionId === id && n.availability === 'ready',
    );
  if (!entry) return null;
  const manifest =
    'manifest' in entry ? entry.manifest : entry.current.id === id ? entry.current : entry.snapshot;
  try {
    return await preparePlayback(manifest, entry.artifactHash);
  } catch {
    return null;
  }
}
