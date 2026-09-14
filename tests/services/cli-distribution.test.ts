import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import release from '../../apps/cli/distribution/version.json';
import { cliDownload } from '../../packages/backend/src/cli-download';

const enabled = process.env.SPACE_TEST_CLI === undefined ? test.skip : test;
const root = await mkdtemp(join(tmpdir(), 'napplet-distribution-test-'));
afterAll(() => rm(root, { recursive: true, force: true }));
const source = resolve(import.meta.dir, '../../apps/web/public/install.sh');
const binary = process.env.SPACE_TEST_CLI!;
const env = {
  ...process.env,
  PATH: '/usr/bin:/bin',
  SPACE_ACCOUNT_HOME: join(root, 'accounts'),
  NAPPLET_INSTALL_DIR: join(root, 'install'),
  NAPPLET_BIN_DIR: join(root, 'bin'),
};
async function run(args: string[], cwd = root, extra: Record<string, string | undefined> = {}) {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...env, ...extra },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}
enabled(
  'packaged CLI ignores project runtime configuration and executes its own frozen sandbox',
  async () => {
    await writeFile(join(root, '.env'), 'SPACE_ACCOUNT_HOME=/this-env-file-must-not-load\n');
    await writeFile(join(root, 'bunfig.toml'), 'preload = ["./hijack.js"]\n');
    await writeFile(join(root, 'hijack.js'), 'throw new Error("PROJECT PRELOAD RAN");');
    expect((await run([binary, 'account', 'show', '--json'])).code).toBe(0);
    expect(
      (
        await run([
          binary,
          'new',
          'creation',
          '--template',
          'soft-orbit',
          '--identity',
          'later',
          '--json',
        ])
      ).code,
    ).toBe(0);
    const project = join(root, 'creation');
    await writeFile(join(root, '.env'), `SPACE_ACCOUNT_HOME=${project}\n`);
    expect(
      (await run([binary, 'account', 'show', '--json'], root, { SPACE_ACCOUNT_HOME: undefined }))
        .code,
    ).toBe(0);
    expect((await run([binary, 'check', '--json'], project)).stdout).toContain(
      '"status":"checked"',
    );
    await writeFile(
      join(project, 'index.html'),
      '<!doctype html><script>throw new Error("broken creation")</script>',
    );
    const broken = await run([binary, 'check', '--json'], project);
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain('BROWSER_CHECK');
  },
  90000,
);
enabled(
  'real installer verifies artifacts, preserves foreign commands and rejects a corrupt download without replacing a working installation',
  async () => {
    process.env.SPACE_CLI_DOWNLOAD_DIR = resolve(import.meta.dir, '../../.local/cli');
    let corrupt = false;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const [version, name] = new URL(request.url).pathname.split('/').slice(-2);
        return corrupt && name?.endsWith('.tar.gz')
          ? new Response('corrupted')
          : cliDownload(request, version, name);
      },
    });
    const local = { NAPPLET_DOWNLOAD_BASE: server.url.href.replace(/\/$/, '') };
    try {
      const installed = await run(
        [
          '/bin/sh',
          source,
          'new',
          'installed-project',
          '--template',
          'soft-orbit',
          '--identity',
          'later',
          '--json',
        ],
        root,
        local,
      );
      expect(installed.code, installed.stderr + installed.stdout).toBe(0);
      const command = join(env.NAPPLET_BIN_DIR, 'napplet-space');
      const destination = await readlink(command);
      expect((await run([command, '--version'])).stdout).toContain(release.version);
      corrupt = true;
      const bad = await run(['/bin/sh', source], root, local);
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain('checksum mismatch');
      expect(await readlink(command)).toBe(destination);
      expect((await run([command, '--version'])).code).toBe(0);
      await rm(command);
      await writeFile(command, 'another program');
      expect((await run(['/bin/sh', source], root, local)).stderr).toContain('not managed');
      expect(await Bun.file(command).text()).toBe('another program');
      expect((await fetch(new URL(`/${release.version}/embedded.json`, server.url))).status).toBe(
        404,
      );
      expect(
        (
          await fetch(
            new URL(`/${release.version}/napplet-space-linux-x64.tar.gz.sha256`, server.url),
            {
              method: 'HEAD',
            },
          )
        ).headers.get('content-length'),
      ).not.toBeNull();
    } finally {
      server.stop(true);
      delete process.env.SPACE_CLI_DOWNLOAD_DIR;
    }
  },
  90000,
);
