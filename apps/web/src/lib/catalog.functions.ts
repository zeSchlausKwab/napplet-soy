import { sourceBrowser, sourceInput } from '../../../../packages/backend/src/source';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { gallerySearchSchema } from '../../../../packages/protocol/src';
import { gallery, resolveNapplet } from '../../../../packages/backend/src/catalog';
import {
  catalogStatus,
  resolvePublicNapplet,
} from '../../../../packages/backend/src/public-catalog';
import { siteOrigin } from '../../../../packages/backend/src/site-origin';
import { indexedLookup, indexStore } from '../../../../packages/backend/src/indexed-catalog';
import { newerManifest } from '../../../../packages/backend/src/index-store';

import { communityStore } from '../../../../packages/community/src/store';
import { visibleAlias } from '../../../../packages/backend/src/names-response';
import { DiscoveryQueue } from '../../../../packages/backend/src/discovery-queue';
import { discoveryTarget } from '../../../../packages/protocol/src/discovery';
import { browseGallery } from '../../../../packages/backend/src/gallery';

const lookupSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('named'), creator: z.string().max(40), slug: z.string().max(64) }),
  z.object({ type: z.literal('address'), naddr: z.string().max(4096) }),
  z.object({ type: z.literal('snapshot'), id: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export const getGallery = createServerFn({ method: 'GET' })
  .validator(gallerySearchSchema)
  .handler(({ data }) => gallery(data));
export const getBrowseGallery = createServerFn({ method: 'GET' })
  .validator(gallerySearchSchema)
  .handler(({ data }) => browseGallery(data));
async function lookupNapplet(data: z.infer<typeof lookupSchema>) {
  if (data.type === 'named' && data.creator !== '@space-lab') {
    if (!process.env.SPACE_COMMUNITY_DIR) return null;
    const alias = communityStore().lookup(data.creator.replace(/^@/, ''), data.slug);
    if (!alias || !data.creator.startsWith('@') || !visibleAlias(alias)) return null;
    data = { type: 'address', naddr: alias.naddr };
  }
  let napplet = (await resolveNapplet(data)) as
    Awaited<ReturnType<typeof resolveNapplet>> | Awaited<ReturnType<typeof resolvePublicNapplet>>;
  const remote = await resolvePublicNapplet(data);
  if (
    !napplet ||
    ('current' in napplet && remote && newerManifest(remote.manifest, napplet.current))
  )
    napplet = remote;
  // Existing curated aliases remain attached to their Nostr identity after an update.
  if (data.type === 'named' && napplet && 'current' in napplet) {
    const indexed = await indexedLookup({ type: 'address', naddr: napplet.naddr });
    const remote = await resolvePublicNapplet({ type: 'address', naddr: napplet.naddr });
    if (
      indexed.known ||
      indexStore()?.removed(napplet.current) ||
      (remote && newerManifest(remote.manifest, napplet.current))
    )
      if (!remote || remote.revisionId !== napplet.current.id) napplet = remote;
  }
  return napplet
    ? {
        ...napplet,
        relays: 'relays' in napplet ? napplet.relays : (await catalogStatus()).relays,
        siteOrigin: siteOrigin(),
      }
    : null;
}
export const getNapplet = createServerFn({ method: 'GET' })
  .validator(lookupSchema)
  .handler(({ data }) => lookupNapplet(data));
export const getDiscoveredNapplet = createServerFn({ method: 'GET' })
  .validator(lookupSchema)
  .handler(async ({ data }) => {
    let napplet = await lookupNapplet(data);
    const result = (state: string | null, message?: string) => ({
      napplet,
      discovery: state,
      message,
    });
    if (!process.env.SPACE_INDEX_DIR || data.type === 'named') return result(null);
    let target;
    try {
      target = discoveryTarget(data.type === 'address' ? data.naddr : data.id);
    } catch {
      return result(null);
    }
    const queue = new DiscoveryQueue(process.env.SPACE_INDEX_DIR);
    try {
      const previous = queue.get(target.key);
      if (napplet && (!previous || !['queued', 'searching'].includes(previous.state)))
        return result(null);
      // A known deletion or invalid replacement is not a discovery miss.
      if (!napplet && indexStore()?.row(target.key)) return result(null);
      let job = previous;
      if (!napplet)
        try {
          job = queue.request(data.type === 'address' ? data.naddr : data.id);
        } catch (error) {
          return result(
            'failed',
            error instanceof Error ? error.message : 'Discovery is unavailable',
          );
        }
      const deadline = Date.now() + 5500;
      while (job && ['queued', 'searching'].includes(job.state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        napplet = await lookupNapplet(data);
        job = queue.get(target.key);
        if (
          napplet &&
          'availability' in napplet &&
          napplet.availability === 'ready' &&
          napplet.preview
        )
          break;
      }
      return result(job?.state ?? 'failed');
    } finally {
      queue.close();
    }
  });
export const getSource = createServerFn({ method: 'GET' })
  .validator(sourceInput)
  .handler(({ data }) => sourceBrowser.view(data));

export const getCreatorNames = createServerFn({ method: 'GET' })
  .validator(z.string().regex(/^@[a-z0-9-]{1,32}$/))
  .handler(({ data }) =>
    process.env.SPACE_COMMUNITY_DIR
      ? communityStore().creator(data.slice(1)).filter(visibleAlias)
      : [],
  );
