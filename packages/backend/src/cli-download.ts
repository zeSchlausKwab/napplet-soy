import { lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Only explicit release archives/checksums can be downloaded; never serve build trees. */
export async function cliDownload(request: Request, version: string, name: string) {
  const headers = { 'X-Content-Type-Options': 'nosniff' };
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...headers, Allow: 'GET, HEAD' },
    });
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !/^napplet-space-(darwin|linux)-(arm64|x64)\.tar\.gz(\.sha256)?$/.test(name)
  )
    return new Response('Not found', { status: 404, headers });
  const root = process.env.SPACE_CLI_DOWNLOAD_DIR || resolve(process.cwd(), '../../.local/cli');
  const path = join(root, version, name);
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile() || !(await realpath(path)).startsWith((await realpath(root)) + sep))
    return new Response('Not found', { status: 404, headers });
  return new Response(request.method === 'HEAD' ? null : Bun.file(path), {
    headers: {
      ...headers,
      'Content-Type': name.endsWith('.sha256') ? 'text/plain; charset=utf-8' : 'application/gzip',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
