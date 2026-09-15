import { nip19 } from 'nostr-tools';
import { discoveryTarget, type DiscoveryTarget } from './discovery';

export type CommentMedia = {
  type: 'image' | 'video';
  url: string;
  mime: string;
  alt: string;
  hash?: string;
};
export type CommentNappletTarget =
  DiscoveryTarget | { type: 'named'; creator: string; slug: string; key: string; path: string };
export type CommentPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'profile'; text: string; pubkey: string }
  | { type: 'napplet'; text: string; target: CommentNappletTarget }
  | ({ text: string } & CommentMedia);
const formats: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  webm: 'video/webm',
  mp4: 'video/mp4',
};
const supported = new Set(Object.values(formats));
export function commentMediaUrl(input: string) {
  if (input.length > 2048) throw new Error('Media URL is too long.');
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new Error('Use public HTTPS media.');
  return url;
}
/** NIP-27 text references and optional NIP-92 metadata. Never render HTML/Markdown as code. */
export function commentParts(
  content: string,
  tags: string[][] = [],
  origin = 'https://napplet.soy',
): CommentPart[] {
  const text = content.slice(0, 4000);
  const metadata = new Map<string, Map<string, string> | null>();
  for (const tag of tags.filter((t) => t[0] === 'imeta').slice(0, 16)) {
    const fields = new Map<string, string>();
    let valid = tag.length >= 3;
    for (const field of tag.slice(1, 24)) {
      const at = field.indexOf(' ');
      if (at < 1) continue;
      const key = field.slice(0, at);
      if (fields.has(key) && ['url', 'm', 'x', 'alt'].includes(key)) valid = false;
      fields.set(key, field.slice(at + 1));
    }
    const url = fields.get('url');
    if (url) metadata.set(url, valid && !metadata.has(url) ? fields : null);
  }
  const parts: CommentPart[] = [],
    embeds = new Set<string>();
  const pattern =
    /https?:\/\/[^\s<>"\u0000-\u001f]+|(?:nostr:)?(?:naddr|nevent|note|npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+/gi;
  let end = 0,
    links = 0;
  for (const match of text.matchAll(pattern)) {
    if (links++ >= 24) break;
    const start = match.index!,
      raw = match[0].replace(/[.,!?:;\]\)}]+$/, '');
    // Avoid interpreting a bech32-looking substring inside an ordinary word.
    if (start && /[\w]/.test(text[start - 1])) continue;
    if (start > end) parts.push({ type: 'text', text: text.slice(end, start) });
    end = start + raw.length;
    let part: CommentPart = { type: 'text', text: raw };
    try {
      if (/^https?:/i.test(raw)) {
        const url = new URL(raw);
        if (url.username || url.password) throw new Error();
        part = { type: 'link', text: raw, href: url.href };
        const named = /^\/(@[a-z0-9-]{1,32})\/([a-z0-9-]{1,64})(?:\/play)?\/?$/.exec(url.pathname);
        if (named && url.origin === origin) {
          const path = `/${named[1]}/${named[2]}`;
          part = {
            type: 'napplet',
            text: raw,
            target: { type: 'named', creator: named[1], slug: named[2], key: path, path },
          };
        } else if (/^\/(?:n|r)\//.test(url.pathname)) {
          const portable = new URL(url);
          portable.pathname = portable.pathname.replace(/\/play\/?$/, '');
          const target = discoveryTarget(portable.href);
          part = { type: 'napplet', text: raw, target };
        } else {
          const fields = metadata.get(raw);
          const mime = fields?.get('m') || formats[url.pathname.split('.').pop()!.toLowerCase()];
          if (supported.has(mime) && !(metadata.has(raw) && fields === null)) {
            commentMediaUrl(raw);
            const hash =
              fields?.get('x') ||
              /\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i.exec(url.pathname)?.[1]?.toLowerCase();
            if (hash && !/^[a-f0-9]{64}$/.test(hash)) throw new Error();
            part = {
              type: mime.startsWith('image/') ? 'image' : 'video',
              text: raw,
              url: raw,
              mime,
              alt: (fields?.get('alt') || 'Media shared in a comment').slice(0, 300),
              ...(hash ? { hash } : {}),
            };
          }
        }
      } else {
        const decoded = nip19.decode(raw.replace(/^nostr:/i, ''));
        if (decoded.type === 'npub' || decoded.type === 'nprofile')
          part = {
            type: 'profile',
            text: raw,
            pubkey: decoded.type === 'npub' ? decoded.data : decoded.data.pubkey,
          };
        else {
          part = { type: 'link', text: raw, href: `nostr:${raw.replace(/^nostr:/i, '')}` };
          if (
            decoded.type !== 'nevent' ||
            !decoded.data.kind ||
            [35129, 15129, 5129].includes(decoded.data.kind)
          )
            part = { type: 'napplet', text: raw, target: discoveryTarget(raw) };
        }
      }
    } catch {
      /* Invalid or unsupported references retain their original text/link. */
    }
    if (part.type === 'napplet' || part.type === 'image' || part.type === 'video') {
      const key = part.type === 'napplet' ? part.target.key : part.url;
      if (embeds.has(key) || embeds.size >= 4)
        part = {
          type: 'link',
          text: raw,
          href: part.type === 'napplet' ? part.target.path : part.url,
        };
      else embeds.add(key);
    }
    parts.push(part);
  }
  if (end < text.length) parts.push({ type: 'text', text: text.slice(end) });
  return parts;
}
