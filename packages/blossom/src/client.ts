import type { EventTemplate } from 'nostr-tools';
import { sha256, verifiedEvent, type SignedEvent } from '../../protocol/src';
import {
  blossomOrigin,
  HASH,
  MAX_BLOB_BYTES,
  type BlobDescriptor,
  type BlossomAction,
} from './protocol';

export type BlossomSigner = { signEvent(event: EventTemplate): Promise<SignedEvent> | SignedEvent };
export async function blossomAuthorization(
  signer: BlossomSigner,
  action: BlossomAction,
  origin: string,
  hash?: string,
) {
  const now = Math.floor(Date.now() / 1000);
  if (hash !== undefined && !HASH.test(hash)) throw new Error('Invalid blob hash');
  const template: EventTemplate = {
    kind: 24242,
    created_at: now - 1,
    content: `${action === 'upload' ? 'Upload' : action === 'delete' ? 'Delete' : 'List'} ${hash ? `blob ${hash}` : 'my blobs'} on ${new URL(origin).hostname}`,
    tags: [
      ['t', action],
      ['expiration', String(now + 300)],
      ['server', new URL(origin).hostname],
      ...(hash ? [['x', hash]] : []),
    ],
  };
  const event = verifiedEvent(await signer.signEvent(template));
  if (
    event.kind !== template.kind ||
    event.created_at !== template.created_at ||
    event.content !== template.content ||
    JSON.stringify(event.tags) !== JSON.stringify(template.tags)
  )
    throw new Error('Signer changed the requested Blossom authorization');
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64url')}`;
}
/** Shared uploader for CLI publication and local seeds. It verifies the returned descriptor AND bytes. */
export async function uploadBlob(input: {
  origin: string;
  bytes: Uint8Array;
  type: string;
  signer: BlossomSigner;
  local?: boolean;
  signal?: AbortSignal;
}) {
  const origin = blossomOrigin(input.origin, input.local);
  if (input.bytes.byteLength > MAX_BLOB_BYTES) throw new Error('Blob exceeds upload limit');
  const hash = await sha256(input.bytes);
  const authorization = await blossomAuthorization(input.signer, 'upload', origin, hash);
  const signal = AbortSignal.any([
    AbortSignal.timeout(30000),
    ...(input.signal ? [input.signal] : []),
  ]);
  const response = await fetch(`${origin}/upload`, {
    method: 'PUT',
    redirect: 'error',
    signal,
    headers: { Authorization: authorization, 'Content-Type': input.type, 'X-SHA-256': hash },
    body: input.bytes as Uint8Array<ArrayBuffer>,
  });
  if (![200, 201].includes(response.status))
    throw new Error(
      `Blossom upload refused (${response.status}): ${response.headers.get('x-reason') ?? 'See server response'}`,
    );
  if (Number(response.headers.get('content-length')) > 4096)
    throw new Error('Blossom descriptor exceeds limit');
  // Descriptor bodies are untrusted too; do not follow a URL returned by a server.
  const text = await readBounded(response, 4096);
  const result = JSON.parse(new TextDecoder().decode(text)) as BlobDescriptor;
  const url = new URL(result.url);
  if (
    result.sha256 !== hash ||
    result.size !== input.bytes.byteLength ||
    typeof result.type !== 'string' ||
    !Number.isSafeInteger(result.uploaded) ||
    result.uploaded < 0 ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        input.local &&
        url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(url.hostname)
      )) ||
    url.search ||
    url.hash ||
    !new RegExp(`^/${hash}\\.[a-z0-9]+$`).test(url.pathname)
  )
    throw new Error('Blossom returned an inconsistent descriptor');
  const downloaded = await fetch(`${origin}/${hash}`, { redirect: 'error', signal });
  if (
    !downloaded.ok ||
    (await sha256(await readBounded(downloaded, input.bytes.byteLength))) !== hash
  )
    throw new Error('Uploaded blob could not be independently hash-verified');
  return { descriptor: result, created: response.status === 201 };
}
export async function readBounded(response: Response, limit: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('Response exceeds byte limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
