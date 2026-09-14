import { gallerySearchSchema, type SignedEvent } from '../../protocol/src';
import { socialScope } from '../../protocol/src/social';
import { matchesGallery } from '../../protocol/src/topics';
import { manifestBlocked, manifestFeatured } from '../../moderation/src/policy';
import { communityEntries, catalogStatus } from './public-catalog';
import type { PublicNapplet } from './public-model';
import { SocialService, socialService, type SocialContext } from './social-service';
import { resolveZapEndpoint, zapTotals, type ZapEndpoint } from './zaps';
import { communityBudget, communityFailure, communityHeaders } from './community-http';

export type SocialCounts = {
  likeCount: number;
  liked?: boolean;
  commentCount: number;
  zapCount: number | null;
  msats: number | null;
};
export type GallerySocialData = {
  counts: Record<string, SocialCounts>;
  rankings: { liked: PublicNapplet[]; zapped: PublicNapplet[]; commented: PublicNapplet[] };
  refreshing: boolean;
};

// One bounded sweep per web process, shared by all visitors. Reading a card never
// starts a relay subscription. Rotate through the entire catalog, including older pages.
export class GallerySocialService {
  private cursor = 0;
  private nextRefresh = 0;
  private pending?: Promise<void>;
  private endpoints = new Map<string, { until: number; value: Promise<ZapEndpoint> }>();
  constructor(
    readonly social: SocialService,
    private resolveEndpoint = resolveZapEndpoint,
  ) {}
  refresh(entries: PublicNapplet[], relays: string[], now = Date.now()) {
    if (this.pending) return this.pending;
    if (now < this.nextRefresh || !entries.length) return Promise.resolve();
    this.nextRefresh = now + 30000;
    const ordered = [...entries].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    const batch = Array.from(
      { length: Math.min(24, ordered.length) },
      (_, i) => ordered[(this.cursor + i) % ordered.length]!,
    );
    this.cursor = (this.cursor + batch.length) % ordered.length;
    let index = 0;
    this.pending = Promise.all(
      Array.from({ length: 3 }, async () => {
        while (index < batch.length) {
          const entry = batch[index++];
          if (manifestBlocked(entry.manifest)) continue;
          try {
            await this.social.refresh(this.context(entry, relays));
          } catch {
            // Keep previously verified history through relay outages. Missing counts
            // remain unknown in the UI until a successful fetch populates this scope.
          }
        }
      }),
    )
      .then(() => {})
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private context(entry: PublicNapplet, relays: string[]): SocialContext {
    return { scope: socialScope(entry.manifest), manifest: entry.manifest, relays };
  }
  private endpoint(author: string, events: SignedEvent[]) {
    const profile = events
      .filter((e) => e.kind === 0 && e.pubkey === author)
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
    const key = profile?.id ?? author;
    let cached = this.endpoints.get(key);
    if (!cached || cached.until < Date.now()) {
      if (this.endpoints.size >= 256) this.endpoints.delete(this.endpoints.keys().next().value!);
      cached = { until: Date.now() + 60000, value: this.resolveEndpoint(author, events) };
      this.endpoints.set(key, cached);
    }
    return cached.value;
  }
  async counts(entries: PublicNapplet[], viewer?: string) {
    const counts: Record<string, SocialCounts> = {};
    let index = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (index < entries.length) {
          const entry = entries[index++],
            context = this.context(entry, []);
          if (
            manifestBlocked(entry.manifest) ||
            !this.social.store.events(context.scope.key).length
          )
            continue;
          const data = await this.social.data(context);
          let zapCount: number | null = 0,
            msats: number | null = 0;
          if (data.events.some((e) => e.kind === 9735)) {
            try {
              const totals = await zapTotals(
                context,
                data,
                await this.endpoint(entry.pubkey, data.events),
              );
              zapCount = totals.zapCount;
              msats = totals.msats;
            } catch {
              zapCount = null;
              msats = null;
            }
          }
          counts[entry.revisionId] = {
            likeCount: data.likeCount,
            liked: !!viewer && data.likes.some((e) => e.pubkey === viewer),
            commentCount: data.comments.filter((c) => !c.deleted).length,
            zapCount,
            msats,
          };
        }
      }),
    );
    return counts;
  }
  get refreshing() {
    return !!this.pending;
  }
}

export function socialRankings(entries: PublicNapplet[], counts: Record<string, SocialCounts>) {
  const rank = (metric: 'likeCount' | 'msats' | 'commentCount') =>
    entries
      .filter((n) => !manifestBlocked(n.manifest) && (counts[n.revisionId]?.[metric] ?? 0) > 0)
      .sort(
        (a, b) =>
          (counts[b.revisionId]?.[metric] ?? 0) - (counts[a.revisionId]?.[metric] ?? 0) ||
          b.manifest.created_at - a.manifest.created_at ||
          a.revisionId.localeCompare(b.revisionId),
      )
      .slice(0, 12);
  return { liked: rank('likeCount'), zapped: rank('msats'), commented: rank('commentCount') };
}

let cached: GallerySocialService | undefined;
export async function gallerySocialResponse(request: Request) {
  try {
    communityBudget();
    const params = new URL(request.url).searchParams;
    const search = gallerySearchSchema.parse({
      ...Object.fromEntries(params),
      unavailable: params.get('unavailable') === 'true',
    });
    const social = socialService();
    if (cached?.social !== social) cached = new GallerySocialService(social);
    const all = await communityEntries();
    const status = await catalogStatus();
    const relays = [
      ...new Set([
        ...(process.env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean),
        ...(status.index.relays ?? []),
        ...status.relays,
      ]),
    ].slice(0, 6);
    void cached.refresh(all, relays);
    const visible = all.filter(
      (n) =>
        (search.unavailable || n.availability === 'ready') &&
        (search.sort !== 'featured' || manifestFeatured(n.manifest)) &&
        matchesGallery(n, search),
    );
    const viewer = new URL(request.url).searchParams.get('viewer') ?? '';
    const counts = await cached.counts(visible, /^[a-f0-9]{64}$/.test(viewer) ? viewer : undefined);
    return Response.json(
      { counts, rankings: socialRankings(visible, counts), refreshing: cached.refreshing },
      { headers: communityHeaders },
    );
  } catch (error) {
    return communityFailure(error);
  }
}
