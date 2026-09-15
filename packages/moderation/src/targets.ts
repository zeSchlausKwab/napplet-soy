import { nip19 } from 'nostr-tools';

const hex = /^[a-f0-9]{64}$/;
export const ruleTypes = ['pubkey', 'address', 'event', 'hash'] as const;
export type RuleType = (typeof ruleTypes)[number];
export function normalizeTarget(type: RuleType, input: string) {
  // Trailing spaces can be part of a valid d tag. Preserve an explicit address;
  // trim transport identifiers before decoding them, not the decoded identity.
  let target = (/^(?:nostr:)?(?:35129|15129):/.test(input) ? input : input.trim()).replace(
    /^nostr:/,
    '',
  );
  if (type === 'pubkey' && target.startsWith('npub1')) {
    const value = nip19.decode(target);
    if (value.type !== 'npub') throw new Error('Expected an npub.');
    target = value.data;
  }
  if (type === 'address' && target.startsWith('naddr1')) {
    const value = nip19.decode(target);
    if (value.type !== 'naddr') throw new Error('Expected a napplet naddr.');
    target = `${value.data.kind}:${value.data.pubkey}:${value.data.identifier}`;
  }
  if (type === 'event' && /^(note|nevent)1/.test(target)) {
    const value = nip19.decode(target);
    if (value.type !== 'note' && value.type !== 'nevent') throw new Error('Expected an event.');
    target = value.type === 'note' ? value.data : value.data.id;
  }
  if (
    type === 'address'
      ? !/^(?:35129:[a-f0-9]{64}:[^\u0000-\u001f\u007f]{0,256}|15129:[a-f0-9]{64}:)$/.test(target)
      : !hex.test(target)
  )
    throw new Error(
      type === 'address'
        ? 'Enter a napplet naddr or 35129:pubkey:identifier.'
        : 'Enter a valid public identifier or lowercase SHA-256 hash.',
    );
  return target;
}
