import { profilePubkey, profileView } from '../../protocol/src/profile';
import { CommunityError } from '../../community/src/store';
import { profileRelays, profileService } from './profiles';
import { fetchPublicBytes } from './blossom';
import { normalizePreview } from './preview-images';
import { previewSvg, renderOg } from './og';
import { communityBudget, communityFailure, communityHeaders } from './community-http';
import { blocked } from '../../moderation/src/policy';

const cache = new Map<string, { bytes: Uint8Array | null; until: number }>();
const pending = new Map<string, Promise<Uint8Array | null>>();
let minute = 0,
  attempts = 0;
export async function profileMediaResponse(request: Request, key: string, mode: 'image' | 'og') {
  try {
    communityBudget();
    const pubkey = profilePubkey(key),
      service = profileService();
    await service.read([pubkey], await profileRelays());
    const event = service.event(pubkey),
      profile = profileView(pubkey, event);
    const field =
      new URL(request.url).searchParams.get('field') === 'banner' ? 'banner' : 'picture';
    const id = `${pubkey}:${event?.id ?? 'missing'}:${mode}:${field}`;
    for (const [key, entry] of cache) if (entry.until <= Date.now()) cache.delete(key);
    let value = cache.get(id);
    if (!value) {
      let task = pending.get(id);
      if (!task) {
        if (minute !== Math.floor(Date.now() / 60000)) {
          minute = Math.floor(Date.now() / 60000);
          attempts = 0;
        }
        if (pending.size >= 4 || ++attempts > 60)
          throw new CommunityError('Profile images are busy. Try again shortly.', 429);
        task = (async () => {
          if (mode === 'og') {
            const svg = previewSvg({
              title: profile.name,
              description: profile.about || 'Discover this creator’s napplets on napplet.soy.',
              creator: profile.npub,
              slug: '',
              topics: [],
              label: 'NOSTR CREATOR',
            });
            return new Uint8Array(await renderOg(svg));
          }
          const url = profile[field];
          if (!url) return null;
          // Resolve DNS and reject private networks on every fetch. No redirects, SVGs, or remote renderer input.
          try {
            return new Uint8Array(
              (
                await normalizePreview(
                  await fetchPublicBytes(new URL(url), AbortSignal.timeout(4000), 5 * 1024 * 1024),
                )
              ).data,
            );
          } catch {
            return null;
          }
        })();
        pending.set(id, task);
      }
      try {
        const bytes = await task;
        while (
          cache.size &&
          (cache.size >= 64 ||
            [...cache.values()].reduce((n, x) => n + (x.bytes?.length ?? 0), 0) +
              (bytes?.length ?? 0) >
              24 * 1024 * 1024)
        )
          cache.delete(cache.keys().next().value!);
        value = { bytes, until: Date.now() + (bytes ? 600000 : 30000) };
        cache.set(id, value);
      } finally {
        pending.delete(id);
      }
    }
    service.event(pubkey); // Recheck moderation after I/O, including cache hits.
    if (event && blocked('event', event.id))
      throw new CommunityError('This profile is unavailable here.', 404);
    if (!value.bytes) return new Response(null, { status: 404, headers: communityHeaders });
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(value.bytes), {
      headers: {
        ...communityHeaders,
        'Content-Type': 'image/png',
        'Content-Length': String(value.bytes.length),
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return communityFailure(error);
  }
}
