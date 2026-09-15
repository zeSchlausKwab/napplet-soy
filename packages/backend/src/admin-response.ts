import { sha256, verifiedEvent } from '../../protocol/src';
import {
  actionSchema,
  effectiveAdmins,
  configuredAdmins,
  normalizeTarget,
  policyPath,
  PolicyError,
  readPolicy,
  updatePolicy,
} from '../../moderation/src/policy';
import { siteOrigin } from './site-origin';

export const adminKeys = effectiveAdmins;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
async function bodyText(request: Request) {
  if (!request.body) throw new PolicyError('A JSON request body is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) throw new PolicyError('Request too large.', 413);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
let budgetMinute = 0,
  attempts = 0;
export async function adminResponse(request: Request) {
  try {
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== budgetMinute) {
      budgetMinute = minute;
      attempts = 0;
    }
    if (++attempts > 240) throw new PolicyError('Admin request budget exceeded.', 429);
    const admins = adminKeys();
    if (!admins.length || !policyPath()) throw new PolicyError('Administration is not configured.');
    if (!['GET', 'POST'].includes(request.method))
      throw new PolicyError('Method not allowed.', 405);
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization.length > 12000 || !/^Nostr [A-Za-z0-9+/]+=*$/.test(authorization))
      throw new PolicyError('A signed Nostr request is required.', 401);
    let event;
    try {
      event = verifiedEvent(
        JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')),
      );
    } catch {
      throw new PolicyError('Invalid request signature.', 401);
    }
    const now = Math.floor(Date.now() / 1000),
      url = new URL(request.url);
    const canonical = `${siteOrigin()}${url.pathname}${url.search}`;
    const tag = (name: string) => {
      const tags = event.tags.filter((t) => t[0] === name);
      return tags.length === 1 && tags[0].length === 2 ? tags[0][1] : null;
    };
    if (
      event.kind !== 27235 ||
      event.content !== '' ||
      event.created_at < now - 60 ||
      event.created_at > now + 30 ||
      tag('u') !== canonical ||
      tag('method') !== request.method ||
      (request.headers.has('origin') && request.headers.get('origin') !== siteOrigin())
    )
      throw new PolicyError('Signed request does not match this request.', 401);
    if (!admins.includes(event.pubkey))
      throw new PolicyError('This account is not an administrator.', 403);
    let policy = readPolicy();
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        throw new PolicyError('Use application/json.', 415);
      const text = await bodyText(request);
      if (tag('payload') !== (await sha256(new TextEncoder().encode(text))))
        throw new PolicyError('Signed payload does not match.', 401);
      let action;
      try {
        action = actionSchema.parse(JSON.parse(text));
        normalizeTarget(action.type, action.target);
      } catch {
        throw new PolicyError('Invalid moderation action or target.', 400);
      }
      policy = updatePolicy(action, event.pubkey, event.id, now, true);
    }
    return Response.json(
      {
        revision: policy.revision,
        rules: policy.rules,
        featured: policy.featured,
        audit: policy.audit,
        admins: effectiveAdmins(policy),
        recoveryAdmins: configuredAdmins(),
      },
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof PolicyError ? error.message : 'Administration is unavailable.' },
      { status: error instanceof PolicyError ? error.status : 503, headers },
    );
  }
}
