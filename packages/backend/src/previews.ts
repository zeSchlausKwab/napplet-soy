import { cachedVideoBytes, videoBytesResponse } from './preview-videos';
import { blocked, manifestBlocked } from '../../moderation/src/policy';
import type { CachedPreview } from '../../protocol/src/preview';
import { readPublicCatalog, publicDirectory } from './public-catalog';
import { cachedPreviewBytes } from './preview-images';
import { indexedRevision, indexStore } from './indexed-catalog';

function allowedPreview(preview: Pick<CachedPreview, 'descriptor' | 'url' | 'hash'>) {
  const sourceHash = /(?:sha256:|\/)([a-f0-9]{64})(?:[.?#/]|$)/.exec(preview.url)?.[1];
  return (
    !manifestBlocked(preview.descriptor) &&
    !blocked('hash', preview.hash) &&
    (!sourceHash || !blocked('hash', sourceHash))
  );
}
/** Only normalized images attached to an indexed manifest can be served. No request-time fetch. */
export async function previewImage(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const indexed = await indexedRevision(id);
  const store = indexStore();
  if (indexed?.preview && store && allowedPreview(indexed.preview)) {
    const bytes = await cachedPreviewBytes(store.directory, indexed.preview);
    if (bytes) return bytes;
  }
  const directory = publicDirectory();
  if (!directory) return null;
  const entry = (await readPublicCatalog())?.entries.find((n) => n.revisionId === id);
  if (!entry?.preview || !allowedPreview(entry.preview)) return null;
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
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    const { 'Content-Length': _, ...rest } = headers;
    return new Response(null, { status: 304, headers: rest });
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
}

export async function previewVideoResponse(id: string, request: Request) {
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response(null, { status: 404 });
  const indexed = await indexedRevision(id),
    store = indexStore();
  let bytes: Uint8Array | null = null;
  if (indexed?.video && store && allowedPreview(indexed.video))
    bytes = await cachedVideoBytes(store.directory, indexed.video);
  if (!bytes) {
    const directory = publicDirectory();
    const entry = directory
      ? (await readPublicCatalog())?.entries.find((e) => e.revisionId === id)
      : null;
    if (
      directory &&
      entry?.video &&
      !manifestBlocked(entry.manifest) &&
      allowedPreview(entry.video)
    )
      bytes = await cachedVideoBytes(directory, entry.video);
  }
  return bytes
    ? videoBytesResponse(bytes, request)
    : new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
