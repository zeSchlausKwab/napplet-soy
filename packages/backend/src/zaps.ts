import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 as hashBytes } from '@noble/hashes/sha2.js';
import { sha256, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { inspectInvoice } from '../../protocol/src/invoice';
import { oneTag, targetManifest, type SocialScope } from '../../protocol/src/social';
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
export type ZapEndpoint = {
  pubkey: string;
  lnurl: string;
  callback: string;
  nostrPubkey: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed: number;
};
export type JsonLoader = (url: URL) => Promise<any>;
const loadJson: JsonLoader = async (url) =>
  JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      await fetchPublicBytes(url, AbortSignal.timeout(6000), 20000),
    ),
  );
function endpointUrl(profile: SignedEvent) {
  const metadata = JSON.parse(profile.content);
  if (typeof metadata.lud16 === 'string') {
    const match = /^([a-zA-Z0-9._+-]{1,128})@([a-zA-Z0-9.-]{1,253})$/.exec(metadata.lud16);
    if (!match) throw new CommunityError('The author has an invalid Lightning address.');
    return publicResourceUrl(
      `https://${match[2]}/.well-known/lnurlp/${encodeURIComponent(match[1])}`,
    );
  }
  if (typeof metadata.lud06 === 'string') {
    const { prefix, words } = bech32.decode(metadata.lud06 as `${string}1${string}`, 2000);
    if (prefix !== 'lnurl') throw new Error('Invalid LNURL');
    return publicResourceUrl(
      new TextDecoder('utf-8', { fatal: true }).decode(bech32.fromWords(words)),
    );
  }
  throw new CommunityError(
    'This author has not added a Lightning address to their Nostr profile.',
    404,
  );
}
export async function resolveZapEndpoint(
  pubkey: string,
  events: SignedEvent[],
  load: JsonLoader = loadJson,
): Promise<ZapEndpoint> {
  const profile = events
    .filter((e) => e.kind === 0 && e.pubkey === pubkey && allowedSocial(e))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  if (!profile) throw new CommunityError('The author’s Lightning profile is unavailable.', 404);
  const url = endpointUrl(verifiedEvent(profile)),
    data = await load(url);
  if (
    data.tag !== 'payRequest' ||
    data.allowsNostr !== true ||
    !/^[a-f0-9]{64}$/.test(data.nostrPubkey) ||
    typeof data.callback !== 'string' ||
    !Number.isSafeInteger(data.minSendable) ||
    !Number.isSafeInteger(data.maxSendable) ||
    data.minSendable < 1 ||
    data.maxSendable < data.minSendable
  )
    throw new CommunityError('This Lightning service does not support Nostr zaps.');
  publicResourceUrl(data.callback);
  return {
    pubkey,
    lnurl: bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url.href)), 2000),
    callback: data.callback,
    nostrPubkey: data.nostrPubkey,
    minSendable: data.minSendable,
    maxSendable: Math.min(data.maxSendable, 1000000000),
    commentAllowed: Math.max(
      0,
      Math.min(280, Number.isSafeInteger(data.commentAllowed) ? data.commentAllowed : 0),
    ),
  };
}
export function validZapRequest(
  event: SignedEvent,
  scope: SocialScope,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
  fresh = false,
) {
  const amount = oneTag(event, 'amount');
  const msats = amount && /^[1-9][0-9]*$/.test(amount) ? Number(amount) : 0;
  if (
    event.kind !== 9734 ||
    oneTag(event, 'p') !== endpoint.pubkey ||
    !targetManifest(event, scope, manifests) ||
    oneTag(event, 'lnurl') !== endpoint.lnurl ||
    !Number.isSafeInteger(msats) ||
    msats < endpoint.minSendable ||
    msats > endpoint.maxSendable ||
    event.content.length > endpoint.commentAllowed ||
    event.tags.filter((t) => t[0] === 'e').length !== 1 ||
    event.tags.filter((t) => t[0] === 'relays').length !== 1
  )
    throw new CommunityError('Invalid zap request or amount.');
  const relays = event.tags.find((t) => t[0] === 'relays')!.slice(1);
  if (
    !relays.length ||
    relays.length > 6 ||
    relays.some((r) => {
      try {
        const u = new URL(r);
        return u.protocol !== 'wss:' || !!u.username || !!u.password || !!u.hash || r.length > 256;
      } catch {
        return true;
      }
    })
  )
    throw new CommunityError('Zaps require public WSS relay hints.');
  if (
    fresh &&
    (event.created_at < Date.now() / 1000 - 120 || event.created_at > Date.now() / 1000 + 30)
  )
    throw new CommunityError('The zap request has expired.');
  return msats;
}
export async function requestZapInvoice(
  context: SocialContext,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
  input: unknown,
  load: JsonLoader = loadJson,
) {
  const event = verifiedEvent(input);
  if (!allowedSocial(event)) throw new CommunityError('This account is blocked here.', 403);
  const amount = validZapRequest(event, context.scope, manifests, endpoint, true);
  const serialized = JSON.stringify(event),
    url = publicResourceUrl(endpoint.callback);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('nostr', serialized);
  url.searchParams.set('lnurl', endpoint.lnurl);
  if (event.content) url.searchParams.set('comment', event.content);
  const response = await load(url);
  if (response.status === 'ERROR' || typeof response.pr !== 'string')
    throw new CommunityError('The Lightning provider could not create an invoice.', 502);
  const invoice = inspectInvoice(response.pr);
  if (
    invoice.msats !== amount ||
    invoice.descriptionHash !== (await sha256(new TextEncoder().encode(serialized))) ||
    invoice.expiresAt <= Date.now() / 1000
  )
    throw new CommunityError('Invoice does not match the signed zap request.', 502);
  return {
    invoice: response.pr,
    msats: amount,
    expiresAt: invoice.expiresAt,
    paymentHash: invoice.paymentHash,
    request: event,
  };
}
export async function verifiedZapReceipt(
  input: unknown,
  scope: SocialScope,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
) {
  const receipt = verifiedEvent(input);
  if (receipt.kind !== 9735 || receipt.pubkey !== endpoint.nostrPubkey || !allowedSocial(receipt))
    throw new Error('Untrusted zap receipt');
  const description = oneTag(receipt, 'description');
  if (!description) throw new Error('Missing zap request');
  const request = verifiedEvent(JSON.parse(description));
  if (!allowedSocial(request)) throw new Error('Blocked sender');
  // Historical requests can predate the provider's current limits or omit optional lnurl.
  const endpointForReceipt = {
    ...endpoint,
    minSendable: 1,
    maxSendable: Number.MAX_SAFE_INTEGER,
    commentAllowed: 4000,
  };
  const requestForValidation = oneTag(request, 'lnurl')
    ? request
    : { ...request, tags: [...request.tags, ['lnurl', endpoint.lnurl]] };
  const amount = validZapRequest(requestForValidation, scope, manifests, endpointForReceipt);
  for (const key of ['p', 'e', 'a'])
    if (oneTag(receipt, key) !== oneTag(request, key)) throw new Error('Wrong receipt target');
  if (oneTag(receipt, 'P') && oneTag(receipt, 'P') !== request.pubkey)
    throw new Error('Wrong zap sender');
  const invoice = inspectInvoice(oneTag(receipt, 'bolt11') ?? '');
  if (
    invoice.msats !== amount ||
    invoice.descriptionHash !== (await sha256(new TextEncoder().encode(description)))
  )
    throw new Error('Wrong zap invoice');
  const preimage = oneTag(receipt, 'preimage');
  if (
    preimage &&
    (!/^[a-f0-9]{64}$/.test(preimage) ||
      bytesToHex(hashBytes(hexToBytes(preimage))) !== invoice.paymentHash)
  )
    throw new Error('Wrong payment preimage');
  return {
    id: receipt.id,
    pubkey: request.pubkey,
    msats: amount,
    paymentHash: invoice.paymentHash,
  };
}
export async function zapResponse(request: Request) {
  try {
    communityBudget();
    const ref = new URL(request.url).searchParams.get('reference') ?? '';
    if (ref.length > 4096) throw new CommunityError('Invalid reference.');
    const context = await socialContext(ref),
      service = socialService();
    // A split payment requires a multi-invoice flow; do not silently redirect it to the author.
    if (context.manifest.tags.some((t) => t[0] === 'zap'))
      throw new CommunityError(
        'This creation requests split zaps. Use a Nostr client that supports its recipient split.',
        409,
      );
    await service.refresh(context);
    const data = await service.data(context);
    const endpoint = await resolveZapEndpoint(context.manifest.pubkey, data.events);
    if (request.method === 'POST') {
      const { value } = await boundedJson(request);
      return Response.json(await requestZapInvoice(context, data.manifests, endpoint, value), {
        headers: communityHeaders,
      });
    }
    if (request.method !== 'GET') throw new CommunityError('Method not allowed.', 405);
    const receipts = [];
    const hashes = new Set<string>();
    for (const e of data.events.filter((e) => e.kind === 9735).slice(0, 150))
      try {
        const receipt = await verifiedZapReceipt(e, context.scope, data.manifests, endpoint);
        if (!hashes.has(receipt.paymentHash)) {
          receipts.push(receipt);
          hashes.add(receipt.paymentHash);
        }
      } catch {}
    return Response.json(
      { endpoint, receipts, msats: receipts.reduce((sum, r) => sum + r.msats, 0) },
      { headers: communityHeaders },
    );
  } catch (error) {
    return communityFailure(error);
  }
}
