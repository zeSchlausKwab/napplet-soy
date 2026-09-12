import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src/artifact';

export const PLAYER_SANDBOX = 'allow-scripts';
export const PLAYER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export async function verifiedDocument(
  bytes: Uint8Array,
  expectedHash: string,
  prelude = 'window.napplet=Object.freeze({});',
) {
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('This napplet exceeds the 10 MiB limit.');
  if ((await sha256(bytes)) !== expectedHash)
    throw new Error('The downloaded creation does not match its expected hash.');
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // The first CSP constrains every later policy. The opaque iframe has no host cookies or signer.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PLAYER_CSP}"><meta name="referrer" content="no-referrer"><script>${prelude.replace(/<\/script/gi, '<\\/script')}</script>${html}`;
}

export async function loadArtifact(hash: string, signal: AbortSignal, prelude?: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid artifact hash');
  const response = await fetch(`/api/artifacts/${hash}`, { signal, credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('This creation is temporarily unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ARTIFACT_BYTES) throw new Error('This napplet exceeds the 10 MiB limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return verifiedDocument(bytes, hash, prelude);
}
