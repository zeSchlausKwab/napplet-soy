import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, cp, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
test('compiled standalone CLI remixes a pinned manifest through its installed symlink without Bun or account setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-remix-binary-')),
    root = resolve(import.meta.dir, '../..');
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const bundle = join(directory, 'distribution'),
      binary = join(bundle, 'napplet-space');
    await mkdir(join(bundle, 'lib'), { recursive: true });
    const build = await Bun.build({
      entrypoints: [join(root, 'apps/cli/src/index.ts')],
      target: 'bun',
      minify: true,
      define: { NAPPLET_STANDALONE: 'true', NAPPLET_CLI_VERSION: '"test"' },
      compile: { outfile: binary, autoloadDotenv: false, autoloadBunfig: false },
    });
    expect(build.success).toBe(true);
    await cp(dirname(Bun.resolveSync('ws/package.json', root)), join(bundle, 'lib/ws'), {
      recursive: true,
      dereference: true,
    });
    const link = join(directory, 'napplet-space');
    await symlink(binary, link);
    const html = new TextEncoder().encode(
        '<!doctype html><title>Original</title><p>Exact starting point.</p>',
      ),
      hash = await sha256(html);
    const manifest = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [
          ['d', 'original'],
          ['path', '/index.html', hash],
          ['title', 'Original'],
        ],
      },
      generateSecretKey(),
    );
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === '/api/manifest'
          ? Response.json({ manifest })
          : new Response(html),
    });
    const child = Bun.spawn(
      [
        link,
        'remix',
        `${server.url}r/${manifest.id}`,
        'remixed',
        '--network',
        'local',
        '--identity',
        'later',
        '--json',
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: join(directory, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, error }).toEqual({ code: 0, error: '' });
    const config = await Bun.file(join(directory, 'remixed/napplet.json')).json();
    expect(config.remix.revision).toBe(manifest.id);
    expect(config.creator).toBeUndefined();
    expect(await Bun.file(join(directory, 'remixed/index.html')).bytes()).toEqual(html);
    expect(await Bun.file(join(directory, 'remixed/AGENTS.md')).exists()).toBe(true);
    expect(JSON.parse(out).directory).toBe(await realpath(join(directory, 'remixed')));
  } finally {
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
