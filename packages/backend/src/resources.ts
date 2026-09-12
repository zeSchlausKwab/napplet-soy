import { z } from 'zod';
import { fetchPublicBytes, fetchPublicBlob, publicResourceUrl } from './blossom';
import { playableManifest } from './catalog';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src/artifact';

export const resourceInput = z
  .object({
    manifest: z.string().regex(/^[a-f0-9]{64}$/),
    url: z.string().max(4096),
    servers: z.array(z.string().max(2048)).max(8).optional(),
  })
  .strict();

/** MIME is derived from bytes, never an upstream header. Active documents are not resources. */
export function resourceMime(bytes: Uint8Array, verifiedBinary = false): string {
  const head = Array.from(bytes.slice(0, 16));
  const ascii = new TextDecoder().decode(bytes.slice(0, 512));
  if (head.slice(0, 8).join() === '137,80,78,71,13,10,26,10') return 'image/png';
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(ascii)) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (ascii.startsWith('ID3') || (head[0] === 255 && (head[1] & 224) === 224)) return 'audio/mpeg';
  if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
  if (ascii.startsWith('wOF2')) return 'font/woff2';
  if (ascii.startsWith('wOFF')) return 'font/woff';
  // Raw SVG/XML and HTML are refused. No parser, script, or remote references run on the server.
  if (/<(?:svg|html|script|!doctype|\?xml)\b/i.test(new TextDecoder().decode(bytes.slice(0, 4096))))
    throw new Error('blocked-by-policy');
  if (verifiedBinary && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(ascii))
    return 'application/octet-stream';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    if (verifiedBinary) return 'application/octet-stream';
    throw new Error('blocked-by-policy');
  }
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    if (verifiedBinary) return 'application/octet-stream';
    throw new Error('blocked-by-policy');
  }
  try {
    JSON.parse(text);
    return 'application/json';
  } catch {}
  return 'text/plain';
}

export async function resolveResource(
  input: { url: string; servers?: string[] },
  defaults: string[],
  signal: AbortSignal,
) {
  let bytes: Uint8Array;
  const digest = /^blossom:sha256:([a-f0-9]{64})$/.exec(input.url)?.[1];
  if (digest) {
    let found: Uint8Array | undefined;
    for (const server of [...new Set([...(input.servers ?? []), ...defaults])].slice(0, 8)) {
      try {
        const data = await fetchPublicBlob(
          server,
          digest,
          AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        );
        if ((await sha256(data)) === digest) {
          found = data;
          break;
        }
      } catch {}
      if (signal.aborted) throw new Error('timeout');
    }
    if (!found) throw new Error('network-error');
    bytes = found;
  } else if (input.url.startsWith('https:')) {
    bytes = await fetchPublicBytes(publicResourceUrl(input.url), signal);
  } else if (input.url.startsWith('data:')) {
    // Normally decoded by the upstream shim. Keep raw envelope clients within the same policy.
    const response = await fetch(input.url, { signal });
    bytes = new Uint8Array(await response.arrayBuffer());
  } else throw new Error('unsupported-scheme');
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('too-large');
  return { bytes, mime: resourceMime(bytes, !!digest) };
}

let active = 0;
const budgets = new Map<string, { start: number; count: number; active: number }>();
export async function resourceResponse(request: Request) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  // Only the first-party host can fetch on behalf of its opaque frame. No cookie credentials are forwarded.
  if (
    request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('X-Space-Host') !== '1'
  )
    return fail('blocked-by-policy', 403);
  let input: z.infer<typeof resourceInput>;
  try {
    if (!request.body) return fail('invalid-request', 400);
    const reader = request.body.getReader();
    let text = '',
      size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 24000) return fail('too-large', 413);
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    input = resourceInput.parse(JSON.parse(text));
  } catch {
    return fail('invalid-request', 400);
  }
  const entry = await playableManifest(input.manifest);
  if (!entry) return fail('not-found', 404);
  const now = Date.now();
  for (const [key, budget] of budgets)
    if (!budget.active && now - budget.start > 60000) budgets.delete(key);
  let budget = budgets.get(entry.manifest.id);
  if (!budget) {
    budget = { start: now, count: 0, active: 0 };
    budgets.set(entry.manifest.id, budget);
  }
  if (now - budget.start > 60000) {
    budget.start = now;
    budget.count = 0;
  }
  if (active >= 8 || budget.active >= 4 || budget.count >= 60) return fail('quota-exceeded', 429);
  active++;
  budget.active++;
  budget.count++;
  try {
    const { bytes, mime } = await resolveResource(
      input,
      entry.servers,
      AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    );
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        ...headers,
        'Content-Type': mime,
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return fail(
      ['blocked-by-policy', 'too-large', 'timeout', 'unsupported-scheme'].includes(message)
        ? message
        : 'network-error',
      422,
    );
  } finally {
    active--;
    budget.active--;
  }
}
