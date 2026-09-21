import { resolve, extname, sep } from 'node:path';
import { buildSpatial, output } from './build';
export function serveSpatial(port = 4191) {
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
    '.vtt': 'text/vtt',
    '.json': 'application/json',
  };
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      let path: string;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response('Invalid path', { status: 400 });
      }
      const target = resolve(output, path === '/' ? 'index.html' : path.slice(1));
      if (!target.startsWith(output + sep)) return new Response('Not found', { status: 404 });
      const file = Bun.file(target);
      if (!(await file.exists())) return new Response('Not found', { status: 404 });
      const headers = {
        'Content-Type': mime[extname(target)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      };
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
        if (start > end) return new Response(null, { status: 416 });
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}` },
        });
      }
      return new Response(file, { headers });
    },
  });
}
if (import.meta.main) {
  await buildSpatial();
  const server = serveSpatial(Number(process.env.PRESENTATION_PORT ?? 4191));
  console.log(`Spatial presentation: ${server.url}`);
}
