import { nip19 } from 'nostr-tools';
import { z } from 'zod';
import { verifiedEvent, type SignedEvent } from './index';

export function profilePubkey(input: string) {
  if (/^[a-f0-9]{64}$/i.test(input)) return input.toLowerCase();
  if (input.length <= 100 && input.startsWith('npub1')) {
    const decoded = nip19.decode(input);
    if (decoded.type === 'npub') return decoded.data;
  }
  throw new Error('Use a Nostr public key (npub or hexadecimal).');
}
export function profilePath(pubkey: string) {
  return `/p/${nip19.npubEncode(profilePubkey(pubkey))}`;
}
export function shortPubkey(pubkey: string) {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}
export function profileObject(event: SignedEvent | null): Record<string, unknown> | null {
  if (!event) return {};
  try {
    const value = JSON.parse(event.content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
export function profileEvent(input: unknown, pubkey?: string) {
  const event = verifiedEvent(input);
  if (
    event.kind !== 0 ||
    (pubkey && event.pubkey !== pubkey) ||
    event.created_at > Math.floor(Date.now() / 1000) + 60 ||
    new TextEncoder().encode(JSON.stringify(event)).length > 16000
  )
    throw new Error('Invalid profile event.');
  return event;
}
export function latestProfile(events: unknown[], pubkey: string) {
  const candidates: SignedEvent[] = [];
  for (const input of events)
    try {
      candidates.push(profileEvent(input, pubkey));
    } catch {}
  // Select the replaceable winner BEFORE parsing its content. Never resurrect an older profile.
  return (
    candidates.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null
  );
}
export function profileUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function profileView(pubkey: string, event: SignedEvent | null) {
  const data = profileObject(event);
  const text = (key: string, limit: number) =>
    typeof data?.[key] === 'string'
      ? (data[key] as string)
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, limit)
      : '';
  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    eventId: event?.id ?? null,
    name: text('display_name', 80) || text('name', 80) || shortPubkey(pubkey),
    username: text('name', 80),
    about: text('about', 2000),
    website: profileUrl(data?.website),
    picture: profileUrl(data?.picture),
    banner: profileUrl(data?.banner),
    lightning: text('lud16', 254),
    nip05: text('nip05', 254),
    state: !event ? ('missing' as const) : data ? ('ready' as const) : ('invalid' as const),
  };
}
export type ProfileView = ReturnType<typeof profileView>;
const urlField = z
  .string()
  .max(2048)
  .refine((s) => !s || !!profileUrl(s), 'Use a full HTTPS URL.');
export const profileFields = z
  .object({
    name: z.string().max(80),
    display_name: z.string().max(80),
    about: z.string().max(2000),
    website: urlField,
    picture: urlField,
    banner: urlField,
    lud16: z
      .string()
      .max(254)
      .refine(
        (s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
        'Use a Lightning address such as you@example.com.',
      ),
    nip05: z.string().max(254),
  })
  .strict();
export type ProfileFields = z.infer<typeof profileFields>;
export function editableProfile(event: SignedEvent | null): ProfileFields {
  const data = profileObject(event) ?? {};
  return Object.fromEntries(
    Object.keys(profileFields.shape).map((key) => [
      key,
      typeof data[key] === 'string' ? data[key] : '',
    ]),
  ) as ProfileFields;
}
export function mergeProfile(event: SignedEvent | null, fields: ProfileFields) {
  const data = profileObject(event);
  if (!data)
    throw new Error(
      'The current profile contains invalid JSON. Repair it in your other client before editing here.',
    );
  const edited = profileFields.parse(fields);
  const result = { ...data };
  for (const [key, value] of Object.entries(edited)) {
    // Preserve untouched fields, including non-string values written by other clients.
    if (value === (typeof data[key] === 'string' ? data[key] : '')) continue;
    if (value) result[key] = value;
    else delete result[key];
  }
  return result;
}
