import { nip19, verifyEvent } from 'nostr-tools';
import { z } from 'zod';

export const NAPPLET_KIND = 35129;
export const ROOT_NAPPLET_KIND = 15129;
export const SNAPSHOT_KIND = 5129;
export { MAX_ARTIFACT_BYTES, sha256 } from './artifact';
import { sha256 } from './artifact';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const eventSchema = z.object({
  id: hex,
  pubkey: hex,
  sig: z.string().regex(/^[a-f0-9]{128}$/),
  kind: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  content: z.string().max(65536),
  tags: z.array(z.array(z.string().max(4096)).max(16)).max(256),
});
export type SignedEvent = z.infer<typeof eventSchema>;
export type NappletIdentity = {
  kind: typeof NAPPLET_KIND | typeof ROOT_NAPPLET_KIND;
  pubkey: string;
  identifier: string;
};

export function identityAddress(identity: NappletIdentity) {
  if (
    ![NAPPLET_KIND, ROOT_NAPPLET_KIND].includes(identity.kind) ||
    !hex.safeParse(identity.pubkey).success ||
    identity.identifier.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(identity.identifier) ||
    (identity.kind === ROOT_NAPPLET_KIND && identity.identifier !== '')
  )
    throw new Error('Invalid napplet identity');
  return `${identity.kind}:${identity.pubkey}:${identity.identifier}`;
}
export function encodeAddress(identity: NappletIdentity, relays: string[] = []) {
  identityAddress(identity);
  return nip19.naddrEncode({ ...identity, relays });
}
export function decodeAddress(value: string): NappletIdentity {
  if (value.length > 4096) throw new Error('Address is too long');
  const decoded = nip19.decode(value);
  if (decoded.type !== 'naddr' || ![NAPPLET_KIND, ROOT_NAPPLET_KIND].includes(decoded.data.kind))
    throw new Error('Expected a napplet naddr');
  const identity = {
    kind: decoded.data.kind as NappletIdentity['kind'],
    pubkey: decoded.data.pubkey,
    identifier: decoded.data.identifier,
  } as const;
  identityAddress(identity);
  return identity;
}
export async function aggregateHash(paths: Array<{ path: string; hash: string }>) {
  if (!paths.length || new Set(paths.map((p) => p.path)).size !== paths.length)
    throw new Error('Missing or duplicate paths');
  for (const { path, hash } of paths) {
    if (
      !hex.safeParse(hash).success ||
      !path.startsWith('/') ||
      /[\s\\]/.test(path) ||
      path.split('/').some((s) => s === '..' || s === '.')
    )
      throw new Error('Invalid path mapping');
  }
  return sha256(
    paths
      .map((p) => `${p.hash} ${p.path}\n`)
      .sort()
      .join(''),
  );
}
function singleTag(event: SignedEvent, name: string) {
  const tags = event.tags.filter((t) => t[0] === name);
  if (tags.length !== 1) throw new Error(`Expected exactly one ${name} tag`);
  return tags[0];
}
export function verifiedEvent(input: unknown): SignedEvent {
  const event = eventSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(event)).length > 65536 || !verifyEvent(event))
    throw new Error('Invalid Nostr signature');
  return event;
}
export async function validateRelease(currentInput: unknown, snapshotInput: unknown) {
  const current = verifiedEvent(currentInput);
  const snapshot = verifiedEvent(snapshotInput);
  if (
    current.kind !== NAPPLET_KIND ||
    snapshot.kind !== SNAPSHOT_KIND ||
    current.pubkey !== snapshot.pubkey
  )
    throw new Error('Mismatched release author or kind');
  const identity: NappletIdentity = {
    kind: NAPPLET_KIND,
    pubkey: current.pubkey,
    identifier: singleTag(current, 'd')[1],
  };
  const address = identityAddress(identity);
  if (singleTag(snapshot, 'a')[1] !== address || snapshot.tags.some((t) => t[0] === 'd'))
    throw new Error('Snapshot belongs to another napplet');
  const pointers = current.tags.filter((t) => t[0] === 'e' && t[3] === 'snapshot');
  if (pointers.length !== 1 || pointers[0][1] !== snapshot.id)
    throw new Error('Invalid snapshot pointer');
  const path = singleTag(snapshot, 'path');
  if (path.length !== 3 || path[1] !== '/index.html' || !hex.safeParse(path[2]).success)
    throw new Error('Expected one self-contained HTML artifact');
  const hash = await aggregateHash([{ path: path[1], hash: path[2] }]);
  for (const event of [current, snapshot]) {
    const x = singleTag(event, 'x');
    if (
      x[1] !== hash ||
      x[2] !== 'aggregate' ||
      JSON.stringify(singleTag(event, 'path')) !== JSON.stringify(path)
    )
      throw new Error('Artifact manifest mismatch');
  }
  for (const key of ['title', 'description']) {
    if (JSON.stringify(singleTag(current, key)) !== JSON.stringify(singleTag(snapshot, key)))
      throw new Error('Metadata mismatch');
  }
  return { identity, address, artifactHash: path[2], aggregateHash: hash, current, snapshot };
}

export const gallerySearchSchema = z.object({
  category: z.enum(['all', 'game', 'visual', 'toy', 'meme', 'public']).catch('all'),
  sort: z.enum(['curated', 'new']).catch('curated'),
  q: z.string().max(100).catch(''),
});
export type GallerySearch = z.infer<typeof gallerySearchSchema>;
