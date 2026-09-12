import { validateManifest } from '../../protocol/src/manifest';
import { identityAddress } from '../../protocol/src';
import { missingDomains } from './capabilities';

/** The same signed manifest determines playback permissions for every catalog source. */
export async function preparePlayback(input: unknown, expectedArtifactHash: string) {
  const release = await validateManifest(input);
  if (release.artifactHash !== expectedArtifactHash)
    throw new Error('Release metadata does not match its artifact.');
  const missing = missingDomains(release.domains);
  if (missing.length)
    throw new Error(`This napplet requires unsupported capabilities: ${missing.join(', ')}.`);
  const { manifest, aggregateHash } = release;
  const address = release.identity
    ? identityAddress(release.identity)
    : manifest.tags.find((t) => t[0] === 'a')![1];
  const [kind, author, ...identifier] = address.split(':');
  return {
    ...release,
    // Current and pinned views of the same build share saves. The snapshot signer remains
    // part of the scope so a third party cannot claim another author's storage via an a tag.
    hostIdentity:
      author === manifest.pubkey
        ? `${manifest.pubkey}:${kind}:${identifier.join(':')}:${aggregateHash}`
        : `${manifest.pubkey}:5129:${address}:${aggregateHash}`,
  };
}
