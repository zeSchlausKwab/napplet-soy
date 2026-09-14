import { nip19 } from 'nostr-tools';
import { decodeAddress, encodeAddress, identityAddress } from './index';

/** Parse an identity, never fetch the pasted web URL. Relay hints remain untrusted. */
export function discoveryTarget(input: string) {
  if (input.length > 4096) throw new Error('Napplet address is too long');
  let value = input.trim().replace(/^nostr:/i, '');
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const match = /^\/(?:n|r)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) throw new Error('Paste a napplet naddr or a portable /n/ or /r/ link');
    value = decodeURIComponent(match[1]);
  }
  if (/^[a-f0-9]{64}$/.test(value))
    return {
      key: value,
      type: 'snapshot' as const,
      id: value,
      hints: [] as string[],
      path: `/r/${value}`,
    };
  const decoded = nip19.decode(value);
  if (decoded.type === 'naddr') {
    const identity = decodeAddress(value);
    return {
      key: identityAddress(identity),
      type: 'address' as const,
      naddr: encodeAddress(identity, decoded.data.relays?.slice(0, 4)),
      hints: (decoded.data.relays ?? []).slice(0, 4),
      path: `/n/${value}`,
    };
  }
  if (decoded.type === 'note' || decoded.type === 'nevent') {
    const id = decoded.type === 'note' ? decoded.data : decoded.data.id;
    return {
      key: id,
      type: 'snapshot' as const,
      id,
      hints: decoded.type === 'nevent' ? (decoded.data.relays ?? []).slice(0, 4) : [],
      path: `/r/${id}`,
    };
  }
  throw new Error('Expected a napplet naddr, note or nevent');
}
export type DiscoveryTarget = ReturnType<typeof discoveryTarget>;
