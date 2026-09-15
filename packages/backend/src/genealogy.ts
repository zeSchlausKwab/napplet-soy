import { matchFilter, type Filter } from 'nostr-tools';
import { encodeAddress, identityAddress, type SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { nappletAddressSchema } from '../../protocol/src/remix';
import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { manifestResponse } from './manifest-response';
import { profileRelays } from './profiles';
import { socialRelay } from './social-relay';
import { communityStore } from '../../community/src/store';
import { indexStore } from './indexed-catalog';
import { communityBudget, communityFailure, communityHeaders } from './community-http';

import { buildGenealogy as buildTree } from '../../client/src/genealogy';
export { hasAncestry, type Genealogy, type Ancestor } from '../../client/src/genealogy';
export const buildGenealogy = (
  root: SignedEvent,
  find: (reference: string) => Promise<SignedEvent | null>,
) =>
  buildTree(root, find, {
    hidden: (e) => manifestBlocked(e) || !!indexStore()?.removed(e),
    blocked: (type, target) => blocked(type as any, target),
  });
function addressLink(address: string) {
  const [kind, pubkey, ...d] = nappletAddressSchema.parse(address).split(':');
  return encodeAddress({ kind: Number(kind) as 35129 | 15129, pubkey, identifier: d.join(':') });
}
async function localManifest(reference: string) {
  const ref = reference.includes(':') ? addressLink(reference) : reference;
  const response = await manifestResponse(
    new Request(`http://internal/api/manifest?reference=${encodeURIComponent(ref)}`),
  );
  return response.ok ? ((await response.json()).manifest as SignedEvent) : null;
}
let active = 0;
export async function genealogyResponse(request: Request) {
  try {
    communityBudget();
    const revision = new URL(request.url).searchParams.get('revision') ?? '';
    if (!/^[a-f0-9]{64}$/.test(revision)) return new Response(null, { status: 400 });
    const root = await localManifest(revision);
    if (!root || indexStore()?.removed(root))
      return Response.json(null, { headers: communityHeaders });
    if (active >= 4) return new Response(null, { status: 429, headers: communityHeaders });
    active++;
    try {
      const relays = await profileRelays(),
        store = process.env.SPACE_COMMUNITY_DIR ? communityStore() : null;
      let queries = 0;
      const deadline = Date.now() + 9000;
      const tree = await buildGenealogy(root, async (reference) => {
        const local = await localManifest(reference);
        if (local) return !indexStore()?.removed(local) ? local : null;
        let filter: Filter;
        if (reference.includes(':')) {
          const [kind, pubkey, ...d] = nappletAddressSchema.parse(reference).split(':');
          filter = {
            kinds: [Number(kind)],
            authors: [pubkey],
            ...(kind === '35129' ? { '#d': [d.join(':')] } : {}),
            limit: 1,
          };
        } else filter = { ids: [reference], kinds: [35129, 15129, 5129], limit: 1 };
        let events = store?.events('genealogy').filter((e) => matchFilter(filter, e)) ?? [];
        // Exact events are immutable. Mutable parents are refreshed rather than silently using stale lineage.
        if ((!events.length || reference.includes(':')) && queries < 4 && Date.now() < deadline) {
          queries++;
          try {
            events.push(...(await socialRelay.query(relays, [filter])));
          } catch {}
        }
        const candidates: SignedEvent[] = [];
        for (const candidate of events)
          try {
            await validateManifest(candidate);
            if (matchFilter(filter, candidate)) candidates.push(candidate);
          } catch {}
        const winner = candidates.sort(
          (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
        )[0];
        if (!winner || manifestBlocked(winner) || indexStore()?.removed(winner)) return null;
        store?.put('genealogy', [winner]);
        return winner;
      });
      if (manifestBlocked(root) || indexStore()?.removed(root))
        return Response.json(null, { headers: communityHeaders });
      return Response.json(tree, { headers: communityHeaders });
    } finally {
      active--;
    }
  } catch (error) {
    return communityFailure(error);
  }
}
