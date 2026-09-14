import { sha256, verifiedEvent } from '../../protocol/src';
import { CommunityError } from '../../community/src/store';
import { siteOrigin } from './site-origin';
export const communityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export function communityFailure(error: unknown) {
  return Response.json(
    { error: error instanceof CommunityError ? error.message : 'Community service unavailable.' },
    { status: error instanceof CommunityError ? error.status : 503, headers: communityHeaders },
  );
}
export async function boundedJson(request: Request, limit = 20000) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    throw new CommunityError('Use application/json.', 415);
  if (request.headers.has('origin') && request.headers.get('origin') !== siteOrigin())
    throw new CommunityError('Origin does not match this site.', 403);
  if (!request.body) throw new CommunityError('A JSON body is required.');
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new CommunityError('Request too large.', 413);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    throw new CommunityError('Invalid JSON.');
  }
}
export async function signedRequest(request: Request, text: string) {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.length > 12000 || !/^Nostr [A-Za-z0-9+/]+=*$/.test(auth))
    throw new CommunityError('Sign in to sign this request.', 401);
  let event;
  try {
    event = verifiedEvent(JSON.parse(Buffer.from(auth.slice(6), 'base64').toString('utf8')));
  } catch {
    throw new CommunityError('Invalid request signature.', 401);
  }
  const tag = (key: string) => {
    const list = event.tags.filter((t) => t[0] === key);
    return list.length === 1 && list[0].length === 2 ? list[0][1] : null;
  };
  const url = new URL(request.url),
    now = Math.floor(Date.now() / 1000);
  if (
    event.kind !== 27235 ||
    event.content !== '' ||
    event.created_at < now - 60 ||
    event.created_at > now + 30 ||
    tag('u') !== `${siteOrigin()}${url.pathname}${url.search}` ||
    tag('method') !== request.method ||
    tag('payload') !== (await sha256(new TextEncoder().encode(text)))
  )
    throw new CommunityError('Signed request does not match this URL, method, body or time.', 401);
  return event;
}
let minute = 0,
  count = 0;
export function communityBudget() {
  const current = Math.floor(Date.now() / 60000);
  if (current !== minute) {
    minute = current;
    count = 0;
  }
  if (++count > 300)
    throw new CommunityError('Community request budget exceeded. Please try again shortly.', 429);
}
