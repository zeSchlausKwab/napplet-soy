import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceGit } from '../../grasp/src/client';
import { gitSourceLoader } from './build';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { downloadPackNative } from './source-http';
import { ISOLATION } from './sandbox';

// Exercise real smart HTTP and offline Git decoding, not a mocked source callback.
test('bounded smart HTTP loader retrieves exact regular backend files and rejects redirects, oversized bodies and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-'));
  const author = getPublicKey(generateSecretKey());
  const name = `${nip19.npubEncode(author)}/test.git`;
  await mkdir(join(root, name), { recursive: true });
  const repo = join(root, name);
  let mode = 'git';
  const http = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (mode === 'redirect')
        return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
      if (mode === 'oversize' && request.method === 'POST') {
        let chunks = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (++chunks > 17) controller.close();
              else controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          { headers: { 'content-type': 'application/x-git-upload-pack-result' } },
        );
      }
      const url = new URL(request.url);
      const child = Bun.spawn(['git', 'http-backend'], {
        env: {
          PATH: process.env.PATH,
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: request.method,
          CONTENT_TYPE: request.headers.get('content-type') || '',
        },
        stdin: new Blob([await request.arrayBuffer()]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const bytes = Buffer.from(await new Response(child.stdout).arrayBuffer());
      const status = await child.exited;
      if (status) throw new Error(await new Response(child.stderr).text());
      const end = bytes.indexOf('\r\n\r\n');
      const headers = new Headers();
      for (const line of bytes.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':');
        headers.set(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      return new Response(bytes.subarray(end + 4), { headers });
    },
  });
  try {
    await sourceGit(repo, ['init']);
    await sourceGit(repo, ['config', 'http.receivepack', 'true']);
    for (const file of ['backend.json', 'handler.ts', 'schemas.json'])
      await Bun.write(
        join(repo, 'backend', file),
        Bun.file(new URL('../fixtures/minicraft/' + file, import.meta.url)),
      );
    await sourceGit(repo, ['add', '.']);
    await sourceGit(repo, ['commit', '-m', 'Backend source fixture']);
    const commit = await sourceGit(repo, ['rev-parse', 'HEAD']);
    const source = {
      repository: `30617:${author}:test`,
      cloneUrl: `http://127.0.0.1:${http.port}/${name}`,
      commit,
      manifest: 'backend/backend.json',
    };
    const command = [
      process.execPath,
      '--no-env-file',
      resolve(import.meta.dir, 'source-worker.ts'),
    ];
    const load = gitSourceLoader([`http://127.0.0.1:${http.port}`], true, command);
    const result = await load(source);
    expect(result.source).toEqual(source);
    expect(result.files['backend/handler.ts']).toContain('export async function handle');
    mode = 'redirect';
    await expect(load(source)).rejects.toThrow('302');
    mode = 'oversize';
    await expect(load(source)).rejects.toThrow('downloaded bytes');
    mode = 'git';
    await rm(join(repo, 'backend/handler.ts'));
    await Bun.write(join(repo, 'target.ts'), 'export function handle() {}');
    const { symlink } = await import('node:fs/promises');
    await symlink('../target.ts', join(repo, 'backend/handler.ts'));
    await sourceGit(repo, ['add', '.']);
    await sourceGit(repo, ['commit', '-m', 'Symlink fixture']);
    await expect(
      load({ ...source, commit: await sourceGit(repo, ['rev-parse', 'HEAD']) }),
    ).rejects.toThrow('regular tracked');
    await expect(downloadPackNative(new URL('https://127.0.0.1/repo.git'), commit)).rejects.toThrow(
      'public HTTPS',
    );
  } finally {
    http.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
