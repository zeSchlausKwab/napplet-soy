import { browserIdentity } from './browser-identity';
import { PrivateKeySigner } from 'applesauce-signers';
import { sha256, verifiedEvent, type SignedEvent } from '../../../../packages/protocol/src';
export type Template = Pick<SignedEvent, 'kind' | 'created_at' | 'tags' | 'content'>;
/** Fresh browser-memory identity for exactly one anonymous payment request. */
export async function signAnonymousZap(template: Template) {
  if (template.kind !== 9734) throw new Error('Anonymous signing is only available for zaps.');
  const signer = new PrivateKeySigner();
  try {
    return verifiedEvent(await signer.signEvent(template));
  } finally {
    signer.key.fill(0);
  }
}
export async function signForAccount(pubkey: string, template: Template) {
  return browserIdentity().sign(pubkey, template);
}

export async function jsonResponse(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
export async function claimName(
  pubkey: string,
  claim: { handle: string; slug: string; naddr: string },
) {
  const body = JSON.stringify(claim),
    url = new URL('/api/names', location.origin).href;
  const event = await signForAccount(pubkey, {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', await sha256(new TextEncoder().encode(body))],
    ],
  });
  return jsonResponse(
    await fetch(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Nostr ${btoa(JSON.stringify(event))}`,
      },
    }),
  );
}
