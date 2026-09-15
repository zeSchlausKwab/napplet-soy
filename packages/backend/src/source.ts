import { z } from 'zod';
import { sha256, type SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { sourceArchive } from '../../remix/src/archive';
import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { artifact, resolveNapplet } from './catalog';
import { readPublicCatalog, resolvePublicNapplet } from './public-catalog';
import { indexedRevision, indexStore } from './indexed-catalog';
import { fetchPublicBytes } from './blossom';

import { createSourceBrowser as createBrowser, sourceInput } from '../../client/src/source';
export { sourceInput, SOURCE_TEXT_LIMIT } from '../../client/src/source';
export const createSourceBrowser = (deps: Parameters<typeof createBrowser>[0]) =>
  createBrowser({
    blocked: (type, target) => blocked(type as any, target),
    manifestBlocked,
    ...deps,
  });
const ARCHIVE_LIMIT = 50 * 1024 * 1024;

/** Local development may read only its operator-configured Blossom, never arbitrary loopback URLs. */
export async function downloadSourceArchive(url: URL, signal: AbortSignal) {
  if (url.protocol === 'https:') return fetchPublicBytes(url, signal, ARCHIVE_LIMIT);
  const configured = process.env.SPACE_INDEX_LOCAL_BLOSSOM;
  const base = configured ? new URL(configured) : null;
  if (
    !base ||
    base.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    url.origin !== base.origin ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !new RegExp(
      `^${base.pathname.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-f0-9]{64}(?:\\.tar)?$`,
    ).test(url.pathname)
  )
    throw new Error('Source archive requires public HTTPS or the configured development Blossom.');
  const target = new URL(url);
  if (target.hostname === 'localhost') target.hostname = '127.0.0.1';
  const response = await fetch(target, { signal, redirect: 'error' });
  if (
    response.status !== 200 ||
    !response.body ||
    Number(response.headers.get('content-length')) > ARCHIVE_LIMIT
  )
    throw new Error('Source download unavailable.');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > ARCHIVE_LIMIT) throw new Error('Source download too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export const sourceBrowser = createSourceBrowser({
  blocked: (type, target) => blocked(type as any, target),
  manifestBlocked,
  async manifest(revision) {
    const local = await resolveNapplet({ type: 'snapshot', id: revision });
    if (local) return local.snapshot;
    const entry =
      (await resolvePublicNapplet({ type: 'snapshot', id: revision })) ??
      (await readPublicCatalog())?.entries.find((entry) => entry.revisionId === revision) ??
      (await indexedRevision(revision));
    return entry && !indexStore()?.removed(entry.manifest) ? entry.manifest : null;
  },
  async artifact(hash) {
    const file = await artifact(hash);
    return file ? file.bytes() : null;
  },
  download: downloadSourceArchive,
});
export type SourceView = NonNullable<Awaited<ReturnType<typeof sourceBrowser.view>>>;

export async function sourceDownloadResponse(request: Request) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
  try {
    const params = new URL(request.url).searchParams;
    const input = sourceInput.parse(Object.fromEntries(params));
    const file = await sourceBrowser.download(input, params.get('archive') === '1');
    if (!file) return new Response('Source file not available', { status: 404, headers });
    return new Response(new Uint8Array(file.bytes).buffer, {
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="source"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
      },
    });
  } catch {
    return new Response('Source file not available', { status: 400, headers });
  }
}
