import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import release from '../../apps/cli/distribution/version.json';

const enabled = process.env.SPACE_TEST_CLI ? test : test.skip;
enabled(
  'packaged update verifies bytes, preserves custom installs and identities, and switches only after success',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soyli-update-'));
    const install = join(root, 'custom install'),
      bin = join(root, 'custom bin');
    const old = join(install, 'releases', 'old');
    const binary = resolve(process.env.SPACE_TEST_CLI!);
    const next = release.version.split('.').map(Number);
    next[2]++;
    const latest = next.join('.');
    const name = `soyli-${process.platform}-${process.arch}`;
    const archive = join(root, `${name}.tar.gz`);
    let broken = '',
      tagVersion = latest;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/latest')
          return Response.json({
            tag_name: `soyli-v${tagVersion}`,
            draft: false,
            prerelease: false,
            assets: ['', '.sha256'].map((suffix) => ({
              name: `${name}.tar.gz${suffix}`,
              state: 'uploaded',
              size: 100,
            })),
          });
        if (path.endsWith('.sha256'))
          return new Response(
            `${new Bun.CryptoHasher('sha256').update(await Bun.file(archive).bytes()).digest('hex')}  ${name}.tar.gz\n`,
          );
        return broken === 'checksum'
          ? new Response('corrupt download')
          : new Response(Bun.file(archive));
      },
    });
    const run = async (args: string[], extra: Record<string, string | undefined> = {}) => {
      const child = Bun.spawn(args, {
        cwd: root,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          SPACE_ACCOUNT_HOME: join(root, 'accounts'),
          SOYLI_RELEASE_API: new URL('latest', server.url).href,
          NAPPLET_DOWNLOAD_BASE: server.url.href.replace(/\/$/, ''),
          NAPPLET_INSTALL_DIR: install,
          NAPPLET_BIN_DIR: bin,
          ...extra,
        },
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const pack = async (executableVersion = latest, unsafe = false) => {
      const folder = join(root, name);
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, 'soyli'),
        `#!/bin/sh\nprintf 'soyli ${executableVersion}\\n'\n`,
        { mode: 0o755 },
      );
      await mkdir(join(folder, 'lib'), { recursive: true });
      await writeFile(join(folder, 'lib/marker'), 'new support files');
      await writeFile(join(root, 'outside'), 'must not extract');
      const packed = await run(['tar', '-czf', archive, '-C', root, unsafe ? 'outside' : name]);
      expect(packed.code).toBe(0);
    };
    try {
      await mkdir(old, { recursive: true });
      await mkdir(bin);
      await cp(binary, join(old, 'soyli'));
      await symlink(join(dirname(binary), 'lib'), join(old, 'lib'));
      await symlink(join(old, 'soyli'), join(bin, 'soyli'));
      await writeFile(join(bin, 'napplet-space'), 'foreign legacy command');
      await writeFile(join(install, 'bin-dir'), bin);
      await Bun.write(join(root, 'accounts/marker'), 'private account data untouched');
      await Bun.write(join(root, 'project/napplet.json'), '{"name":"Unpublished edits"}');
      await pack();
      await mkdir(join(install, '.install-lock'));
      const locked = await run([join(bin, 'soyli'), 'update', '--json']);
      expect(locked.code).toBe(1);
      expect(locked.stdout).toContain('Another installation is active');
      expect(await readlink(join(bin, 'soyli'))).toBe(join(old, 'soyli'));
      await rm(join(install, '.install-lock'), { recursive: true });
      for (const failure of ['checksum', 'wrong-version', 'unsafe-path']) {
        broken = failure;
        await pack(failure === 'wrong-version' ? '0.0.0' : latest, failure === 'unsafe-path');
        const result = await run([join(bin, 'soyli'), 'update', '--json']);
        expect(result.code, result.stdout + result.stderr).toBe(1);
        expect(JSON.parse(result.stdout).error.code, result.stdout + result.stderr).toBe(
          'UPDATE_INSTALL',
        );
        expect(result.stdout).toContain(
          failure === 'checksum'
            ? 'checksum mismatch'
            : failure === 'wrong-version'
              ? 'version does not match'
              : 'Unexpected archive path',
        );
        expect(await readlink(join(bin, 'soyli'))).toBe(join(old, 'soyli'));
      }
      broken = '';
      await pack();
      tagVersion = release.version;
      const current = await run([join(bin, 'soyli'), 'update', '--json']);
      expect(JSON.parse(current.stdout).status).toBe('current');
      tagVersion = '0.0.1';
      expect(JSON.parse((await run([join(bin, 'soyli'), 'update', '--json'])).stdout).status).toBe(
        'ahead',
      );
      tagVersion = latest;
      // No environment override needed for a custom bin directory once the installer records it.
      const result = await run([join(bin, 'soyli'), 'update', '--json'], {
        NAPPLET_BIN_DIR: undefined,
        NAPPLET_INSTALL_DIR: undefined,
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'updated',
        previous: release.version,
        version: latest,
      });
      const destination = await readlink(join(bin, 'soyli'));
      expect(destination).not.toBe(join(old, 'soyli'));
      expect(await Bun.file(join(dirname(destination), 'lib/marker')).text()).toBe(
        'new support files',
      );
      expect((await run([join(bin, 'soyli'), '--version'])).stdout.trim()).toBe(`soyli ${latest}`);
      expect(await Bun.file(join(bin, 'napplet-space')).text()).toBe('foreign legacy command');
      expect(await Bun.file(join(root, 'accounts/marker')).text()).toBe(
        'private account data untouched',
      );
      expect(await Bun.file(join(root, 'project/napplet.json')).text()).toContain(
        'Unpublished edits',
      );
      expect(await Bun.file(join(old, 'soyli')).exists()).toBe(true);
      const stale = await run([join(old, 'soyli'), 'update', '--json']);
      expect(stale.code).toBe(1);
      expect(stale.stdout).toContain('no longer points');
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  90000,
);
