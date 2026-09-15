import {
  commentParts,
  commentMediaUrl,
  type CommentMedia,
} from '../../protocol/src/comment-content';
import { sha256, verifiedEvent } from '../../protocol/src';
import { blocked } from '../../moderation/src/policy';
import { socialContext, socialService } from './social-service';
import { CommunityError } from '../../community/src/store';
import { communityBudget, communityFailure, communityHeaders } from './community-http';
import { fetchPublicBytes } from './blossom';
import { normalizePreview } from './preview-images';
import { videoBytesResponse } from './preview-videos';
import { siteOrigin } from './site-origin';

type CachedMedia = { bytes: Uint8Array; mime: string; hash: string };
export const COMMENT_VIDEO_BYTES = 20 * 1024 * 1024;
function videoMime(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (
    buffer.subarray(0, 4).toString('hex') === '1a45dfa3' &&
    buffer.subarray(0, 256).includes(Buffer.from('webm'))
  )
    return 'video/webm';
  if (
    buffer.length >= 16 &&
    buffer.subarray(4, 8).toString() === 'ftyp' &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(buffer.subarray(8, 12).toString())
  )
    return 'video/mp4';
  throw new Error('Unsupported video container.');
}
/** Bounded, short-lived proxy cache. Only the signed-comment endpoint can admit requests. */
export class CommentMediaCache {
  private cache = new Map<string, { value: CachedMedia | null; until: number }>();
  private pending = new Map<string, Promise<CachedMedia | null>>();
  private minute = 0;
  private reserved = 0;
  private attempts = 0;
  constructor(private download = fetchPublicBytes) {}
  async read(media: CommentMedia) {
    const url = commentMediaUrl(media.url);
    const key = `${media.mime}:${media.url}:${media.hash ?? ''}`;
    for (const [key, entry] of this.cache) if (entry.until <= Date.now()) this.cache.delete(key);
    const saved = this.cache.get(key);
    if (saved) return saved.value;
    let task = this.pending.get(key);
    if (task) return task;
    const max = media.type === 'image' ? 5 * 1024 * 1024 : COMMENT_VIDEO_BYTES;
    if (this.minute !== Math.floor(Date.now() / 60000)) {
      this.minute = Math.floor(Date.now() / 60000);
      this.reserved = 0;
      this.attempts = 0;
    }
    if (this.pending.size >= 4 || this.attempts >= 60 || this.reserved + max > 100 * 1024 * 1024)
      throw new CommunityError('Comment media is busy. Try again shortly.', 429);
    this.attempts++;
    this.reserved += max;
    task = (async () => {
      try {
        const bytes = await this.download(url, AbortSignal.timeout(8000), max);
        if (!bytes.length || bytes.length > max) throw new Error('Media exceeds byte limit.');
        const hash = await sha256(bytes);
        if (media.hash && media.hash !== hash) throw new Error('Media hash mismatch.');
        if (blocked('hash', hash)) throw new Error('Media is blocked.');
        if (media.type === 'image')
          return {
            bytes: new Uint8Array((await normalizePreview(bytes)).data),
            mime: 'image/png',
            hash,
          };
        const mime = videoMime(bytes);
        if (mime !== media.mime) throw new Error('Video format does not match.');
        // The browser decoder decides codec support. Bytes are never passed to an HTML renderer.
        return { bytes, mime, hash };
      } catch {
        return null;
      }
    })();
    this.pending.set(key, task);
    try {
      const value = await task;
      while (
        this.cache.size &&
        (this.cache.size >= 128 ||
          [...this.cache.values()].reduce((n, v) => n + (v.value?.bytes.length ?? 0), 0) +
            (value?.bytes.length ?? 0) >
            64 * 1024 * 1024)
      )
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value, until: Date.now() + (value ? 600000 : 30000) });
      return value;
    } finally {
      this.pending.delete(key);
    }
  }
}
const cache = new CommentMediaCache();
export async function commentMediaResponse(request: Request, id: string, mediaCache = cache) {
  try {
    communityBudget();
    const params = new URL(request.url).searchParams;
    const reference = params.get('reference') ?? '',
      position = params.get('part') ?? '';
    if (!/^[a-f0-9]{64}$/.test(id) || !/^\d{1,2}$/.test(position) || reference.length > 4096)
      throw new CommunityError('Invalid comment media reference.');
    async function attachment() {
      const context = await socialContext(reference);
      const data = await socialService().data(context);
      const comment = data.comments.find((e) => e.id === id && !e.deleted);
      if (!comment) throw new CommunityError('This comment is unavailable.', 404);
      const event = verifiedEvent(comment);
      const part = commentParts(event.content, event.tags, siteOrigin())[Number(position)];
      if (!part || (part.type !== 'image' && part.type !== 'video'))
        throw new CommunityError('This media is unavailable.', 404);
      if (part.hash && blocked('hash', part.hash))
        throw new CommunityError('This media is unavailable.', 404);
      return part;
    }
    const part = await attachment();
    const value = await mediaCache.read(part);
    await attachment(); // Deletion, parent/author/event/hash blocks rechecked after I/O and on cache hits.
    if (!value || blocked('hash', value.hash))
      throw new CommunityError('This media is unavailable or exceeds this client’s limits.', 404);
    if (part.type === 'video')
      return videoBytesResponse(value.bytes, request, value.mime as 'video/webm' | 'video/mp4');
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(value.bytes), {
      headers: {
        ...communityHeaders,
        'Content-Type': value.mime,
        'Content-Length': String(value.bytes.length),
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return communityFailure(error);
  }
}
