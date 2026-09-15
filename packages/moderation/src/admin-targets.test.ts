import { expect, test } from 'bun:test';
import { nip19 } from 'nostr-tools';
import { adminTarget, targetChoices } from '../../../apps/web/src/lib/admin-targets';
import type { AdminState } from './admin-model';

const pubkey = 'ab'.repeat(32),
  id = 'cd'.repeat(32);
const address = `35129:${pubkey}:a:trailing `;
const naddr = nip19.naddrEncode({ kind: 35129, pubkey, identifier: 'a:trailing ' });
test('admin inputs preserve Nostr identities and reject ambiguous entity types', () => {
  expect(adminTarget('address', `https://napplet.soy/n/${naddr}/play`)).toBe(address);
  expect(adminTarget('address', address)).toBe(address);
  expect(adminTarget('pubkey', nip19.npubEncode(pubkey))).toBe(pubkey);
  expect(adminTarget('pubkey', pubkey.toUpperCase())).toBe(pubkey);
  expect(adminTarget('event', `https://napplet.soy/r/${id}/play`)).toBe(id);
  expect(adminTarget('event', nip19.neventEncode({ id }))).toBe(id);
  expect(adminTarget('hash', `https://blossom.example/${id}.png`)).toBe(id);
  for (const type of ['pubkey', 'hash', 'event'] as const)
    expect(() => adminTarget(type, naddr)).toThrow();
  expect(() => adminTarget('address', id)).toThrow();
  expect(() => adminTarget('address', 'https://example.com/@alice/napp')).toThrow();
});
test('admin search includes titles, profile names and saved unknown blocked identifiers', () => {
  const state: AdminState = {
    revision: 0,
    admins: [pubkey],
    recoveryAdmins: [pubkey],
    audit: [],
    featured: [],
    rules: [
      {
        type: 'address',
        target: `35129:${id}:unknown`,
        reason: 'Retained block',
        actor: pubkey,
        at: 0,
      },
    ],
    catalog: {
      limit: 2000,
      profiles: [{ pubkey, name: 'Alice' }],
      entries: [
        { id, pubkey, address, title: 'My game', hashes: [{ hash: id, label: 'sound.ogg' }] },
      ],
    },
  };
  expect(targetChoices(state, 'address').some((c) => c.search.includes('my game'))).toBe(true);
  expect(targetChoices(state, 'address').some((c) => c.search.includes('alice'))).toBe(true);
  expect(targetChoices(state, 'address').some((c) => c.search.includes('retained block'))).toBe(
    true,
  );
  expect(targetChoices(state, 'admin')[0].label).toBe('Alice');
  expect(targetChoices(state, 'pubkey')[0].search).toContain(nip19.npubEncode(pubkey));
  expect(targetChoices(state, 'hash')[0].label).toContain('sound.ogg');
});
