import { resolve, join, extname } from 'node:path';
const root = resolve(import.meta.dir, '../../output/presentation-proof');
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
};
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PRESENTATION_PORT ?? 4190),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const target = resolve(
      join(root, decodeURIComponent(path === '/' ? 'index.html' : path.slice(1))),
    );
    if (!target.startsWith(root + '/')) return new Response('Not found', { status: 404 });
    const file = Bun.file(target);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    const headers = {
      'Content-Type': types[extname(target)] ?? 'application/octet-stream',
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
console.log(`Presentation proof: ${server.url}`);
