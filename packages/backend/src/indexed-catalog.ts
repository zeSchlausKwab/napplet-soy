import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { join, resolve } from 'node:path';
import { decodeAddress, identityAddress, MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src';
import { IndexStore, indexedProjection } from './index-store';
import type { Lookup } from './catalog';

export type IndexHealth = {
  checkedAt: number;
  release: string;
  relays: string[];
  errors: string[];
};
let connection: IndexStore | undefined;
export function indexStore() {
  const directory = process.env.SPACE_INDEX_DIR ? resolve(process.env.SPACE_INDEX_DIR) : null;
  if (connection?.directory !== directory) {
    connection?.close();
    connection = undefined;
  }
  if (!directory) return null;
  try {
    return (connection ??= new IndexStore(directory));
  } catch {
    return null;
  } // Web can start before the independent worker creates its DB.
}
export function indexHealth() {
  const health = indexStore()?.state<IndexHealth>('health') ?? null;
  return {
    enabled: !!process.env.SPACE_INDEX_DIR,
    ...health,
    stale: !health || Date.now() - health.checkedAt > 300000,
  };
}
function relays() {
  return indexHealth().relays ?? (process.env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean);
}
export async function indexedEntries() {
  const store = indexStore();
  if (!store) return [];
  const entries = await Promise.all(
    store
      .recent()
      .map((row) =>
        store.removed(JSON.parse(row.event)) || manifestBlocked(JSON.parse(row.event))
          ? null
          : indexedProjection(row, relays()),
      ),
  );
  return entries.filter((entry) => entry !== null);
}
export function lookupKey(input: Lookup) {
  if (input.type === 'named') return null;
  if (input.type === 'snapshot') return /^[a-f0-9]{64}$/.test(input.id) ? input.id : null;
  try {
    return identityAddress(decodeAddress(input.naddr));
  } catch {
    return null;
  }
}
export async function indexedLookup(input: Lookup) {
  const key = lookupKey(input),
    row = key ? indexStore()?.row(key) : null;
  return {
    known: !!row,
    entry:
      row &&
      !manifestBlocked(JSON.parse(row.event)) &&
      !indexStore()!.removed(JSON.parse(row.event))
        ? await indexedProjection(row, relays())
        : null,
  };
}
export async function indexedRevision(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const row = indexStore()?.revision(id);
  return row &&
    !manifestBlocked(JSON.parse(row.event)) &&
    !indexStore()!.removed(JSON.parse(row.event))
    ? indexedProjection(row, relays())
    : null;
}
export async function indexedArtifact(hash: string) {
  const store = indexStore();
  if (!store || !/^[a-f0-9]{64}$/.test(hash) || blocked('hash', hash)) return null;
  const entries = await Promise.all(
    store
      .artifactRows(hash)
      .map((row) =>
        store.removed(JSON.parse(row.event)) || manifestBlocked(JSON.parse(row.event))
          ? null
          : indexedProjection(row, relays()),
      ),
  );
  const entry = entries.find((n) => n?.artifactHash === hash && n.availability === 'ready');
  if (!entry) return null;
  const file = Bun.file(join(store.directory, 'artifacts', `${hash}.html`));
  if (!(await file.exists()) || file.size !== entry.bytes || file.size > MAX_ARTIFACT_BYTES)
    return null;
  // Artifact URLs are immutable: never serve corrupted bytes under a valid digest.
  return (await sha256(new Uint8Array(await file.arrayBuffer()))) === hash ? file : null;
}
