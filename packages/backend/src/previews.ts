import { readPublicCatalog, publicDirectory } from './public-catalog';
import { cachedPreviewBytes } from './preview-images';

/** Only normalized images attached to an indexed manifest can be served. No request-time fetch. */
export async function previewImage(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const directory = publicDirectory();
  if (!directory) return null;
  const entry = (await readPublicCatalog())?.entries.find((n) => n.revisionId === id);
  if (!entry?.preview) return null;
  return cachedPreviewBytes(directory, entry.preview);
}

export async function previewResponse(id: string, request: Request) {
  const bytes = await previewImage(id);
  // Reuse the existing generated card for deleted/corrupt cached images as well as absent ones.
  if (!bytes) return (await import('./og')).ogResponse(id, request);
  const { sha256 } = await import('../../protocol/src/artifact');
  const etag = `"preview-${await sha256(bytes)}"`;
  const headers = {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    const { 'Content-Length': _, ...rest } = headers;
    return new Response(null, { status: 304, headers: rest });
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
}
