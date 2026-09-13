import { blocked } from '../../packages/moderation/src/policy';
import { BlobStore, type StoreLimits } from './store';
import {
  authorize,
  blossomOrigin,
  BlossomError,
  BLOSSOM_SPEC,
  HASH,
  MAX_BLOB_BYTES,
  mimeType,
} from '../../packages/blossom/src/protocol';

export type BlossomConfig = {
  directory: string;
  origin: string;
  local: boolean;
  port: number;
  hostname?: string;
  instance: string;
  build: string;
  limits?: Partial<StoreLimits>;
};
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Content-Length, X-SHA-256, X-Content-Type, X-Content-Length, Range, *',
  'Access-Control-Expose-Headers':
    'Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, X-Reason',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
function length(input: string | null, label: string) {
  if (input === null) throw new BlossomError(411, `${label} is required`);
  if (!/^\d{1,12}$/.test(input) || !Number.isSafeInteger(Number(input)))
    throw new BlossomError(400, `Invalid ${label}`);
  return Number(input);
}
export function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size)
    throw new BlossomError(416, 'Unsupported or unsatisfiable byte range');
  if ([match[1], match[2]].some((value) => value && !Number.isSafeInteger(Number(value))))
    throw new BlossomError(416, 'Unsatisfiable byte range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (!match[1] && Number(match[2]) === 0) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new BlossomError(416, 'Unsatisfiable byte range');
  return { start, end: Math.min(end, size - 1) };
}
export async function createBlossom(config: BlossomConfig) {
  const origin = blossomOrigin(config.origin, config.local);
  const limits: StoreLimits = {
    maxBlob: MAX_BLOB_BYTES,
    maxTotal: 2 * 1024 ** 3,
    maxOwner: 256 * 1024 ** 2,
    maxBlobs: 10000,
    maxClaims: 100000,
    ...config.limits,
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error('Blossom limits must be positive integers');
  const store = await BlobStore.open(config.directory, origin, limits);
  let uploads = 0;
  let shuttingDown = false;
  // Bound signed write admission before signature verification. This service-wide
  // budget does not trust client-supplied proxy/IP headers.
  let writeMinute = 0;
  let writes = 0;
  function authorizeWrite(request: Request, action: 'upload' | 'delete' | 'list', hash?: string) {
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== writeMinute) {
      writeMinute = minute;
      writes = 0;
    }
    if (++writes > 600) throw new BlossomError(429, 'Server authorization budget exceeded');
    return authorize(request.headers.get('authorization'), action, new URL(origin).hostname, hash);
  }
  const dispatch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    if (method === 'OPTIONS') return new Response(null, { status: 204 });
    if (shuttingDown) throw new BlossomError(503, 'Storage is shutting down');
    if (path === '/health' && method === 'GET')
      return Response.json({
        ok: true,
        service: 'blossom',
        build: config.build,
        instance: config.instance,
      });
    if (path === '/' && method === 'GET')
      return Response.json({
        name: 'Napplet Space Blossom',
        buds: [1, 2, 6, 11, 12],
        spec: BLOSSOM_SPEC,
        maxBlobBytes: limits.maxBlob,
      });
    if (path === '/upload' && (method === 'PUT' || method === 'HEAD')) {
      const hash = request.headers.get('x-sha-256');
      if (!hash || !HASH.test(hash))
        throw new BlossomError(400, 'X-SHA-256 must contain a lowercase SHA-256 hash');
      const event = authorizeWrite(request, 'upload', hash);
      if (blocked('pubkey', event.pubkey) || blocked('hash', hash))
        throw new BlossomError(403, 'Blocked by operator policy');
      const size = length(
        request.headers.get(method === 'HEAD' ? 'x-content-length' : 'content-length'),
        method === 'HEAD' ? 'X-Content-Length' : 'Content-Length',
      );
      const type = mimeType(
        request.headers.get(method === 'HEAD' ? 'x-content-type' : 'content-type'),
      );
      store.checkQuota(event.pubkey, hash, size);
      if (method === 'HEAD') return new Response(null, { status: 200 });
      if (uploads >= 4) throw new BlossomError(429, 'Too many concurrent uploads');
      uploads++;
      try {
        const result = await store.upload(request, event.pubkey, hash, size, type);
        return Response.json(result.descriptor, { status: result.created ? 201 : 200 });
      } finally {
        uploads--;
      }
    }
    const listing = /^\/list\/([a-f0-9]{64})$/.exec(path);
    if (listing && method === 'GET') {
      const event = authorizeWrite(request, 'list');
      if (event.pubkey !== listing[1])
        throw new BlossomError(403, 'Only the uploader can list their blobs');
      const count = url.searchParams.get('limit') ?? '100';
      const cursor = url.searchParams.get('cursor') ?? undefined;
      if (
        !/^\d{1,3}$/.test(count) ||
        Number(count) < 1 ||
        Number(count) > 100 ||
        (cursor && !HASH.test(cursor))
      )
        throw new BlossomError(400, 'Invalid list pagination');
      return Response.json(store.list(event.pubkey, Number(count), cursor));
    }
    const blob = /^\/([a-f0-9]{64})(?:\.[a-zA-Z0-9]{1,16})?$/.exec(path);
    if (!blob) throw new BlossomError(404, 'Endpoint not found');
    const hash = blob[1];
    if (method === 'DELETE') {
      const event = authorizeWrite(request, 'delete', hash);
      await store.remove(event.pubkey, hash);
      return new Response(null, { status: 204 });
    }
    if (blocked('hash', hash) || store.owners(hash).some((owner) => blocked('pubkey', owner)))
      throw new BlossomError(404, 'Blob not found');
    if (!['GET', 'HEAD'].includes(method)) throw new BlossomError(405, 'Method not allowed');
    const row = store.lookup(hash);
    if (!row || !(await store.available(row))) throw new BlossomError(404, 'Blob not found');
    const headers = new Headers({
      'Content-Type': row.type,
      'Content-Length': String(row.size),
      'Accept-Ranges': 'bytes',
      ETag: `"${hash}"`,
      'Cache-Control': 'no-store',
    });
    if (!/^(image\/(png|jpeg|gif|webp|avif)|audio\/|video\/)/.test(row.type))
      headers.set('Content-Disposition', `attachment; filename="${hash}"`);
    if (request.headers.get('if-none-match') === `"${hash}"`) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    const range = method === 'GET' ? request.headers.get('range') : null;
    let start = 0;
    let end = row.size - 1;
    let status = 200;
    if (
      range &&
      (!request.headers.has('if-range') || request.headers.get('if-range') === `"${hash}"`)
    ) {
      try {
        ({ start, end } = byteRange(range, row.size));
      } catch (error) {
        if (!(error instanceof BlossomError)) throw error;
        headers.set('Content-Range', `bytes */${row.size}`);
        headers.delete('Content-Length');
        headers.set('X-Reason', error.message);
        return new Response(null, { status: error.status, headers });
      }
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${row.size}`);
      headers.set('Content-Length', String(end - start + 1));
    }
    const file = Bun.file(store.path(hash));
    return new Response(
      method === 'HEAD' ? null : status === 206 ? file.slice(start, end + 1) : file,
      { status, headers },
    );
  };
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: config.hostname ?? '127.0.0.1',
      port: config.port,
      // Bun's automatic 413 bypasses fetch and cannot include BUD-01 CORS headers.
      // Enforce the declared limit before opening a file and the actual limit on
      // every streamed chunk in BlobStore; never buffer an entire request body.
      maxRequestBodySize: Number.MAX_SAFE_INTEGER,
      idleTimeout: 30,
      async fetch(request) {
        let response: Response;
        try {
          response = await dispatch(request);
        } catch (error) {
          const known = error instanceof BlossomError;
          if (!known)
            console.error(
              'Blossom storage request failed:',
              error instanceof Error ? error.message : 'unknown error',
            );
          const message = known ? error.message : 'Storage unavailable';
          response = new Response(request.method === 'HEAD' ? null : JSON.stringify({ message }), {
            status: known ? error.status : 503,
            headers: {
              'Content-Type': 'application/json',
              'X-Reason': message,
              'Cache-Control': 'no-store',
            },
          });
        }
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      },
    });
  } catch (error) {
    store.close();
    throw error;
  }
  return {
    server,
    store,
    async close(force = false) {
      shuttingDown = true;
      await server.stop(force);
      await store.drain();
      store.close();
    },
  };
}
