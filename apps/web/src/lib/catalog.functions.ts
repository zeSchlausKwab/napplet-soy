import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { gallerySearchSchema } from '../../../../packages/protocol/src';
import { artifact, gallery, resolveNapplet } from '../../../../packages/backend/src/catalog';
import {
  catalogStatus,
  communityEntries,
  resolvePublicNapplet,
} from '../../../../packages/backend/src/public-catalog';
import { siteOrigin } from '../../../../packages/backend/src/site-origin';
import { indexedLookup, indexStore } from '../../../../packages/backend/src/indexed-catalog';
import { newerManifest } from '../../../../packages/backend/src/index-store';

import { communityStore } from '../../../../packages/community/src/store';
import { visibleAlias } from '../../../../packages/backend/src/names-response';

const lookupSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('named'), creator: z.string().max(40), slug: z.string().max(64) }),
  z.object({ type: z.literal('address'), naddr: z.string().max(4096) }),
  z.object({ type: z.literal('snapshot'), id: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export const getGallery = createServerFn({ method: 'GET' })
  .validator(gallerySearchSchema)
  .handler(({ data }) => gallery(data));
export const getNapplet = createServerFn({ method: 'GET' })
  .validator(lookupSchema)
  .handler(async ({ data }) => {
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
  });
export const getPublicCatalog = createServerFn({ method: 'GET' }).handler(async () => ({
  status: await catalogStatus(),
  entries: await communityEntries(),
}));
export const getSource = createServerFn({ method: 'GET' })
  .validator(z.string().regex(/^[a-f0-9]{64}$/))
  .handler(async ({ data }) => {
    const release =
      (await resolveNapplet({ type: 'snapshot', id: data })) ??
      (await resolvePublicNapplet({ type: 'snapshot', id: data }));
    if (!release) return null;
    const file = await artifact(release.artifactHash);
    return file ? { release, source: await file.text() } : null;
  });

export const getCreatorNames = createServerFn({ method: 'GET' })
  .validator(z.string().regex(/^@[a-z0-9-]{1,32}$/))
  .handler(({ data }) =>
    process.env.SPACE_COMMUNITY_DIR
      ? communityStore().creator(data.slice(1)).filter(visibleAlias)
      : [],
  );
