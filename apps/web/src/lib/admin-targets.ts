import { nip19 } from 'nostr-tools';
import { normalizeTarget, type RuleType } from '../../../../packages/moderation/src/targets';
import type { AdminState } from '../../../../packages/moderation/src/admin-model';

export type Entity = RuleType | 'admin' | 'backend';
export type TargetChoice = { target: string; label: string; search: string };
export function adminTarget(type: RuleType, value: string) {
  let input = value;
  if (/^https?:\/\//.test(input.trim())) {
    const url = new URL(input.trim());
    const paths: Record<RuleType, RegExp> = {
      address: /^\/n\/([^/]+)(?:\/play)?\/?$/,
      pubkey: /^\/p\/([^/]+)\/?$/,
      event: /^\/r\/([^/]+)(?:\/play)?\/?$/,
      hash: /^\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i,
    };
    const match = url.pathname.match(paths[type]);
    if (!match) throw new Error('Use the public identifier for this section.');
    input = decodeURIComponent(match[1]);
  }
  if (/^[a-f0-9]{64}$/i.test(input.trim())) input = input.trim().toLowerCase();
  return normalizeTarget(type, input);
}
export function targetChoices(state: AdminState, entity: Entity): TargetChoice[] {
  const type = entity === 'admin' || entity === 'backend' ? 'pubkey' : entity;
  const names = new Map(state.catalog.profiles.map((p) => [p.pubkey, p.name]));
  const choices = new Map<string, TargetChoice>();
  function add(target: string, label: string, extra = '') {
    if (choices.has(target)) return;
    let encoded = '';
    try {
      if (type === 'pubkey') encoded = nip19.npubEncode(target);
      if (type === 'event')
        encoded = `${nip19.noteEncode(target)} ${nip19.neventEncode({ id: target })}`;
      if (type === 'address') {
        const [kind, pubkey, ...d] = target.split(':');
        encoded = nip19.naddrEncode({ kind: Number(kind), pubkey, identifier: d.join(':') });
      }
    } catch {}
    choices.set(target, {
      target,
      label,
      search: `${label} ${target} ${encoded} ${extra}`.toLowerCase(),
    });
  }
  for (const entry of state.catalog.entries) {
    if (type === 'address' && entry.address)
      add(
        entry.address,
        entry.title,
        `${entry.pubkey} ${nip19.npubEncode(entry.pubkey)} ${names.get(entry.pubkey) ?? ''}`,
      );
    if (type === 'event')
      add(
        entry.id,
        entry.title,
        `${entry.pubkey} ${nip19.npubEncode(entry.pubkey)} ${names.get(entry.pubkey) ?? ''}`,
      );
    if (type === 'pubkey')
      add(entry.pubkey, names.get(entry.pubkey) || `Creator of ${entry.title}`, entry.title);
    if (type === 'hash')
      for (const file of entry.hashes) add(file.hash, `${entry.title} · ${file.label}`);
  }
  if (type === 'pubkey')
    for (const profile of state.catalog.profiles) add(profile.pubkey, profile.name);
  if (entity === 'admin')
    for (const key of state.admins) add(key, names.get(key) || 'Administrator');
  if (entity === 'backend')
    for (const key of state.backendCreators) add(key, names.get(key) || 'Backend creator');
  for (const rule of [...state.rules, ...state.featured])
    if (rule.type === type)
      add(rule.target, names.get(rule.target) || 'Saved identifier', rule.reason);
  return [...choices.values()];
}
