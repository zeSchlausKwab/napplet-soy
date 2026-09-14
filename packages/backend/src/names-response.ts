import { z } from 'zod';
import { decodeAddress, identityAddress } from '../../protocol/src';
import { blocked } from '../../moderation/src/policy';
import { communityStore, CommunityError, type CommunityStore } from '../../community/src/store';
import {
  boundedJson,
  signedRequest,
  communityFailure,
  communityHeaders,
  communityBudget,
} from './community-http';
const claimSchema = z
  .object({ handle: z.string().max(32), slug: z.string().max(64), naddr: z.string().max(4096) })
  .strict();
export function visibleAlias(alias: { pubkey: string; address: string }) {
  return !blocked('pubkey', alias.pubkey) && !blocked('address', alias.address);
}
export async function namesResponse(request: Request, suppliedStore?: CommunityStore) {
  try {
    communityBudget();
    const store = suppliedStore ?? communityStore();
    if (request.method === 'GET') {
      const naddr = new URL(request.url).searchParams.get('naddr') ?? '';
      let address;
      try {
        address = identityAddress(decodeAddress(naddr));
      } catch {
        throw new CommunityError('Invalid napplet address.');
      }
      return Response.json(
        { aliases: store.aliases(address).filter(visibleAlias) },
        { headers: communityHeaders },
      );
    }
    if (request.method !== 'POST') throw new CommunityError('Method not allowed.', 405);
    const { text, value } = await boundedJson(request, 8192),
      event = await signedRequest(request, text);
    const parsed = claimSchema.safeParse(value);
    if (!parsed.success) throw new CommunityError('Invalid name claim.');
    const { handle, slug, naddr } = parsed.data;
    let address;
    try {
      address = identityAddress(decodeAddress(naddr));
    } catch {
      throw new CommunityError('Invalid napplet address.');
    }
    if (!visibleAlias({ pubkey: event.pubkey, address }))
      throw new CommunityError('This creation or account is blocked here.', 403);
    const alias = store.claim(
      handle,
      slug,
      naddr,
      event.pubkey,
      event.id,
      Math.floor(Date.now() / 1000),
    );
    return Response.json({ alias }, { headers: communityHeaders });
  } catch (error) {
    return communityFailure(error);
  }
}
