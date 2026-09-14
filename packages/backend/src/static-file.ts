import type { BunFile } from 'bun';

/** Serve a resolved public file, including the single-byte ranges browsers use for video. */
export function staticFileResponse(request: Request, file: BunFile, cacheControl: string) {
  const size = file.size;
  const headers = new Headers({
    'Content-Type': file.type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  });
  // No representation validator is advertised. An If-Range precondition therefore
  // cannot be satisfied: return the full file, never resume bytes from an older version.
  const range =
    request.method === 'GET' && !request.headers.has('if-range')
      ? request.headers.get('range')
      : null;
  if (!range) return new Response(request.method === 'HEAD' ? null : file, { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = NaN,
    end = NaN;
  if (match && (match[1] || match[2])) {
    const first = Number(match[1]),
      last = Number(match[2]);
    if (Number.isSafeInteger(first) && Number.isSafeInteger(last)) {
      if (!match[1] && last > 0) {
        start = Math.max(0, size - last);
        end = size - 1;
      } else if (match[1]) {
        start = first;
        end = match[2] ? Math.min(last, size - 1) : size - 1;
      }
    }
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  ) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(file.slice(start, end + 1), { status: 206, headers });
}
