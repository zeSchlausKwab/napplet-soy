import {
  aggregateHash,
  encodeAddress,
  identityAddress,
  verifiedEvent,
  type NappletIdentity,
  type SignedEvent,
} from './index';

export function manifestIdentity(event: SignedEvent): NappletIdentity | null {
  const d = event.tags.filter((t) => t[0] === 'd');
  if (event.kind === 5129) {
    if (d.length) throw new Error('Snapshots must not contain d tags');
    return null;
  }
  if (event.kind !== 35129 && event.kind !== 15129) throw new Error('Not a napplet manifest');
  if (event.kind === 35129 ? d.length !== 1 || d[0].length !== 2 : d.length !== 0)
    throw new Error('Invalid manifest identifier');
  const identity: NappletIdentity = {
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: d[0]?.[1] ?? '',
  };
  identityAddress(identity);
  return identity;
}

/** NIP-5D single-file profile. Space's release-pointer convention is deliberately optional. */
export async function validateManifest(input: unknown) {
  const manifest = verifiedEvent(input);
  const identity = manifestIdentity(manifest);
  const paths = manifest.tags.filter((t) => t[0] === 'path');
  if (paths.length !== 1 || paths[0].length !== 3 || paths[0][1] !== '/index.html')
    throw new Error('This client supports one self-contained /index.html');
  const artifactHash = paths[0][2];
  const aggregate = await aggregateHash([{ path: '/index.html', hash: artifactHash }]);
  const x = manifest.tags.filter((t) => t[0] === 'x');
  if (
    x.length > 1 ||
    (x.length && (x[0].length !== 3 || x[0][1] !== aggregate || x[0][2] !== 'aggregate'))
  )
    throw new Error('Manifest aggregate hash mismatch');
  if (manifest.kind === 5129) {
    const a = manifest.tags.filter((t) => t[0] === 'a');
    if (x.length !== 1 || a.length !== 1 || !/^(35129|15129):[a-f0-9]{64}:.{0,256}$/.test(a[0][1]))
      throw new Error('Snapshot requires an aggregate and a source address');
  }
  for (const tag of ['title', 'description', 'source'])
    if (manifest.tags.filter((t) => t[0] === tag).length > 1)
      throw new Error(`Ambiguous ${tag} tag`);
  const domains = manifest.tags
    .filter((t) => t[0] === 'requires')
    .map((t) => {
      if (t.length !== 2 || !/^[a-z][a-z0-9-]{0,39}$/.test(t[1]))
        throw new Error('Invalid required domain');
      return t[1];
    });
  return {
    manifest,
    identity,
    artifactHash,
    aggregateHash: aggregate,
    naddr: identity ? encodeAddress(identity) : null,
    domains: [...new Set(domains)],
    servers: manifest.tags
      .filter((t) => t[0] === 'server')
      .map((t) => t[1])
      .filter(Boolean)
      .slice(0, 8),
  };
}
