import { resolve } from 'node:path';
import { spriteLibrary } from './library';

export function startAlignmentServer(port = 4318) {
  const root = import.meta.dir;
  const routes = new Map([
    ['/', resolve(root, 'index.html')],
    ['/app.js', resolve(root, 'app.js')],
    ['/core.js', resolve(root, 'core.js')],
    ['/style.css', resolve(root, 'style.css')],
    ['/soybert-laptop.png', resolve(root, '../../apps/web/public/brand/soybert-laptop.png')],
  ]);
  for (const sheet of spriteLibrary)
    routes.set(`/sprites/${sheet.id}.png`, resolve(root, '../..', sheet.file));
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405 });
      const url = new URL(request.url);
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
        return new Response('Invalid host', { status: 403 });
      if (url.pathname === '/library.json') {
        const available = await Promise.all(
          spriteLibrary.map(async ({ file, ...sheet }) =>
            (await Bun.file(resolve(root, '../..', file)).exists())
              ? { ...sheet, url: `/sprites/${sheet.id}.png`, name: file.split('/').at(-1)! }
              : null,
          ),
        );
        return Response.json(available.filter(Boolean), {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      const path = routes.get(url.pathname);
      if (!path) return new Response('Not found', { status: 404 });
      if (!(await Bun.file(path).exists())) return new Response('Not found', { status: 404 });
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
