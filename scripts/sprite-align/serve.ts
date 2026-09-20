import { resolve } from 'node:path';

export function startAlignmentServer(port = 4318) {
  const root = import.meta.dir;
  const routes = new Map([
    ['/', resolve(root, 'index.html')],
    ['/app.js', resolve(root, 'app.js')],
    ['/core.js', resolve(root, 'core.js')],
    ['/style.css', resolve(root, 'style.css')],
    ['/soybert-laptop.png', resolve(root, '../../apps/web/public/brand/soybert-laptop.png')],
  ]);
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405 });
      const url = new URL(request.url);
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
        return new Response('Invalid host', { status: 403 });
      const path = routes.get(url.pathname);
      if (!path) return new Response('Not found', { status: 404 });
      return new Response(Bun.file(path), {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    },
  });
}
if (import.meta.main) {
  const server = startAlignmentServer(Number(process.env.SPRITE_ALIGN_PORT ?? 4318));
  console.log(`Soybert alignment studio: ${server.url}`);
}
