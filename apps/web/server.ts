import { resolve, sep } from 'node:path';
import { staticFileResponse } from '../../packages/backend/src/static-file';

process.env.NODE_ENV ??= 'production';
process.env.SPACE_FONT_PATH ??= resolve(
  import.meta.dir,
  '../../packages/backend/assets/DMSans.ttf',
);
process.env.SPACE_OG_FONT_PATH ??= resolve(
  import.meta.dir,
  '../../packages/backend/assets/Fredoka-Bold.ttf',
);
process.env.SPACE_OG_BODY_BOLD_PATH ??= resolve(
  import.meta.dir,
  '../../packages/backend/assets/DMSans-Bold.ttf',
);
process.env.SPACE_OG_MASCOT_PATH ??= resolve(import.meta.dir, 'public/brand/soy-mascot.png');

const staticRoot = resolve(import.meta.dir, 'dist/client');
process.env.SPACE_ARTIFACT_DIR ??= resolve(
  import.meta.dir,
  '../../packages/backend/data/artifacts',
);
const entryPath = resolve(import.meta.dir, 'dist/server/server.js');
const { default: app } = (await import(entryPath)) as {
  default: { fetch(request: Request): Promise<Response> };
};
const server = Bun.serve({
  // Media can spend 15s connecting and 30s awaiting a chunk. Keep the server's
  // idle timeout above those bounded transport deadlines instead of Bun's 10s default.
  idleTimeout: 60,
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Invalid path', { status: 400 });
    }
    const filePath = resolve(staticRoot, `.${path}`);
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      filePath.startsWith(staticRoot + sep)
    ) {
      const file = Bun.file(filePath);
      if (await file.exists())
        return staticFileResponse(
          request,
          file,
          path.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=300',
        );
    }
    const response = await app.fetch(request);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  },
});
console.log(`napplet.soy production build listening on ${server.url}`);
