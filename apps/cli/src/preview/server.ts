import { z } from 'zod';
import { createResourceResponder } from '../../../../packages/backend/src/resource-response';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../../../packages/protocol/src/artifact';
import { missingDomains } from '../../../../packages/runtime/src/capabilities';
import type { PreviewAssets } from './assets';
import { builtRequirements } from '../../../../packages/publish/src/artifact';
import { regularFile } from '../../../../packages/publish/src/project';
import { fileURLToPath } from 'node:url';
import { listingPreview, listingImage } from './listing';
import type { Network } from '../../../../packages/identity/src/signer';

const relayUrl = z
  .string()
  .max(2048)
  .transform((value) => new URL(value))
  .refine(
    (url) => ['ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && !url.hash,
  )
  .transform((url) => url.href);
const configSchema = z.object({
  previewId: z.uuid(),
  entry: z.enum(['index.html', 'dist/index.html']),
  requires: z
    .array(z.string().regex(/^[a-z]+$/))
    .max(32)
    .default([]),
  relays: z.array(relayUrl).max(8).default([]),
  servers: z.array(z.url().max(2048)).max(8).default([]),
});
export type PreviewRevision = {
  id: string;
  artifactHash: string;
  hostIdentity: string;
  requires: string[];
  relays: string[];
};

/** Local source is the authority here: no publisher keys or fabricated relay events. */
export function startPreviewServer(
  root: URL,
  port = Number(process.env.PORT ?? 4173),
  announce = true,
  assets?: PreviewAssets,
  listing: { network: Network; capture?: () => Promise<unknown> } = { network: 'public' },
) {
  let capturing = false;
  async function revision() {
    // BunFile caches stat/size: create fresh handles after every editor save.
    const configFile = Bun.file(new URL('napplet.json', root));
    if (configFile.size > 16384) throw new Error('Project configuration is too large.');
    const configText = await configFile.text();
    const config = configSchema.parse(JSON.parse(configText));
    const bytes = await regularFile(fileURLToPath(root), config.entry, MAX_ARTIFACT_BYTES);
    if (bytes.length > MAX_ARTIFACT_BYTES || configText.length > 16384)
      throw new Error('Project exceeds preview limits.');
    const artifactHash = await sha256(bytes);
    const info: PreviewRevision = {
      id: await sha256(`${artifactHash}:${configText}`),
      artifactHash,
      hostIdentity: `local-preview:${config.previewId}:${artifactHash}`,
      requires: [
        ...new Set([
          ...config.requires,
          ...(config.entry === 'dist/index.html' ? await builtRequirements(bytes) : []),
        ]),
      ],
      relays: config.relays,
    };
    return { info, bytes, servers: config.servers };
  }
  const resourceResponse = createResourceResponder(async (id) => {
    const current = await revision();
    return current.info.id === id && !missingDomains(current.info.requires).length ? current : null;
  });
  const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const url = new URL(request.url);
      // Loopback binding and Host/Origin checks also apply to the resource proxy.
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)
      )
        return new Response('Forbidden', { status: 403, headers: noStore });
      try {
        if (url.pathname === '/api/resources' && request.method === 'POST')
          return await resourceResponse(request);
        if (url.pathname === '/listing/capture' && request.method === 'POST') {
          // Only an explicit action in this host can write a selected screenshot.
          if (request.headers.get('Origin') !== url.origin)
            return new Response('Forbidden', { status: 403, headers: noStore });
          if (!listing.capture)
            return new Response('Capture unavailable', { status: 404, headers: noStore });
          if (capturing)
            return new Response('Capture already running', { status: 409, headers: noStore });
          capturing = true;
          try {
            return Response.json(await listing.capture(), { headers: noStore });
          } finally {
            capturing = false;
          }
        }
        if (request.method !== 'GET')
          return new Response('Method not allowed', { status: 405, headers: noStore });
        if (url.pathname === '/listing')
          return Response.json(
            await listingPreview(fileURLToPath(root), listing.network, !!listing.capture),
            { headers: noStore },
          );
        if (url.pathname === '/listing/preview.png')
          return new Response((await listingImage(fileURLToPath(root))).bytes, {
            headers: {
              ...noStore,
              'Content-Type': 'image/png',
              'Content-Security-Policy': "default-src 'none'; sandbox",
            },
          });
        if (url.pathname === '/revision')
          return Response.json((await revision()).info, { headers: noStore });
        if (/^\/api\/artifacts\/[a-f0-9]{64}$/.test(url.pathname)) {
          const current = await revision();
          if (url.pathname.endsWith('/' + current.info.artifactHash))
            return new Response(current.bytes, {
              headers: {
                ...noStore,
                'Content-Type': 'application/octet-stream',
                'Content-Security-Policy': "default-src 'none'; sandbox",
              },
            });
        }
        if (url.pathname === '/runtime.js')
          return new Response(assets?.client ?? Bun.file(new URL('.napplet/client.js', root)), {
            headers: { ...noStore, 'Content-Type': 'text/javascript; charset=utf-8' },
          });
        if (url.pathname === '/')
          return new Response(assets?.html ?? Bun.file(new URL('.napplet/preview.html', root)), {
            headers: {
              ...noStore,
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Security-Policy':
                // srcdoc inherits this policy too; its own stricter CSP removes
                // 'self' and all network access while allowing embedded code.
                "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
            },
          });
        return new Response('Not found', { status: 404, headers: noStore });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof z.ZodError
                ? 'Invalid napplet.json preview configuration.'
                : String(error),
          },
          { status: 400, headers: noStore },
        );
      }
    },
  });
  if (announce) console.log(`Local napplet preview: ${server.url}`);
  return server;
}
