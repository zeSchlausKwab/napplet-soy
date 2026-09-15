import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 as hashBytes } from '@noble/hashes/sha2.js';
import { sha256, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { inspectInvoice } from '../../protocol/src/invoice';
import { oneTag, targetManifest, commentScope, type SocialScope } from '../../protocol/src/social';
import { fetchPublicBytes, publicResourceUrl } from './blossom';
import {
  allowedSocial,
  socialContext,
  socialService,
  type SocialContext,
  type SocialService,
} from './social-service';
import { CommunityError } from '../../community/src/store';
import { boundedJson, communityBudget, communityFailure, communityHeaders } from './community-http';
import * as zap from '../../client/src/zaps';
export type { ZapEndpoint, JsonLoader } from '../../client/src/zaps';
import type { ZapEndpoint, JsonLoader } from '../../client/src/zaps';
const loadJson: JsonLoader = async (url) =>
  JSON.parse(
    new TextDecoder().decode(await fetchPublicBytes(url, AbortSignal.timeout(6000), 20000)),
  );
export const validZapRequest = zap.validZapRequest;
export const verifiedZapReceipt = zap.verifiedZapReceipt;
export const zapTotals = zap.zapTotals;
export const resolveZapEndpoint = (pubkey: string, events: SignedEvent[], load = loadJson) =>
  zap.resolveZapEndpoint(pubkey, events.filter(allowedSocial), load);
export const requestZapInvoice = (
  context: SocialContext,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
  input: unknown,
  load = loadJson,
) => zap.requestZapInvoice(context, manifests, endpoint, input, load);

export async function zapResponse(request: Request) {
  try {
    communityBudget();
    const ref = new URL(request.url).searchParams.get('reference') ?? '';
    if (ref.length > 4096) throw new CommunityError('Invalid reference.');
    let context = await socialContext(ref);
    const service = socialService();
    await service.refresh(context);
    const data = await service.data(context);
    let targets = data.manifests;
    const commentId = new URL(request.url).searchParams.get('comment');
    if (commentId !== null) {
      const comment = data.comments.find((event) => event.id === commentId && !event.deleted);
      if (!/^[a-f0-9]{64}$/.test(commentId) || !comment || !allowedSocial(comment))
        throw new CommunityError('Comment not found in this conversation.', 404);
      const original = data.events.find((event) => event.id === comment.id)!;
      context = { ...context, manifest: original, scope: commentScope(original) };
      targets = new Map([[original.id, original]]);
    }
    // A split payment requires a multi-invoice flow; do not silently redirect it to the author.
    if (context.manifest.tags.some((t) => t[0] === 'zap'))
      throw new CommunityError(
        'This creation requests split zaps. Use a Nostr client that supports its recipient split.',
        409,
      );
    const endpoint = await resolveZapEndpoint(context.manifest.pubkey, data.events);
    if (request.method === 'POST') {
      const { value } = await boundedJson(request);
      return Response.json(await requestZapInvoice(context, targets, endpoint, value), {
        headers: communityHeaders,
      });
    }
    if (request.method !== 'GET') throw new CommunityError('Method not allowed.', 405);
    return Response.json(
      { endpoint, relays: context.relays, ...(await zapTotals(context, data, endpoint, targets)) },
      { headers: communityHeaders },
    );
  } catch (error) {
    return communityFailure(error);
  }
}
