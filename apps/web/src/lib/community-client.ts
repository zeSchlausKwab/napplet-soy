import { ExtensionSigner } from 'applesauce-signers';
import { sha256, verifiedEvent, type SignedEvent } from '../../../../packages/protocol/src';
export type Template = Pick<SignedEvent, 'kind' | 'created_at' | 'tags' | 'content'>;
export async function signForAccount(pubkey: string, template: Template) {
  const signer = new ExtensionSigner();
  if ((await signer.getPublicKey()) !== pubkey)
    throw new Error('Your signer account changed. Connect it again.');
  const event = verifiedEvent(await signer.signEvent(template));
  if (
    event.pubkey !== pubkey ||
    event.kind !== template.kind ||
    event.created_at !== template.created_at ||
    event.content !== template.content ||
    JSON.stringify(event.tags) !== JSON.stringify(template.tags)
  )
    throw new Error('The signer changed the requested event.');
  return event;
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Nostr ${btoa(JSON.stringify(event))}`,
      },
    }),
  );
}
