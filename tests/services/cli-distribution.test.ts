import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import release from '../../apps/cli/distribution/version.json';
import { cliDownload } from '../../packages/backend/src/cli-download';
import { finalizeEvent, generateSecretKey, matchFilters, nip19 } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';

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
    const selected = await Bun.file(join(project, 'napplet.json')).json();
    selected.preview = { delayMs: 250, recording: { durationMs: 2000, startMs: 0, actions: [] } };
    await writeFile(join(project, 'napplet.json'), JSON.stringify(selected));
    const recording = await run([binary, 'record', '--json'], project);
    expect(recording.code).toBe(0);
    expect(JSON.parse(recording.stdout)).toMatchObject({
      width: 960,
      height: 600,
      selected: 'preview.video in napplet.json',
    });
    expect((await Bun.file(join(project, 'napplet.json')).json()).preview.video.file).toBe(
      'preview.webm',
    );
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
    expect(broken.stdout).toContain('PREVIEW_VIDEO_STALE');
    await writeFile(join(project, 'napplet.json'), JSON.stringify(selected)); // Remove the clip to exercise the separate sandbox check.
    expect((await run([binary, 'check', '--json'], project)).stdout).toContain('BROWSER_CHECK');
  },
  90000,
);
enabled(
  'real installer verifies artifacts, preserves foreign commands and rejects a corrupt download without replacing a working installation',
  async () => {
    process.env.SPACE_CLI_DOWNLOAD_DIR = resolve(import.meta.dir, '../../.local/cli');
    let corrupt = false;
    const html = '<!doctype html><p>Exact remix starting point</p>';
    const hash = await sha256(html);
    let manifest: ReturnType<typeof finalizeEvent>;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return;
        const path = new URL(request.url).pathname;
        if (path === `/${hash}`) return new Response(html);
        const [version, name] = new URL(request.url).pathname.split('/').slice(-2);
        return corrupt && name?.endsWith('.tar.gz')
          ? new Response('corrupted')
          : cliDownload(request, version, name);
      },
      websocket: {
        message(socket, raw) {
          const m = JSON.parse(String(raw));
          if (m[0] === 'REQ') {
            if (matchFilters(m.slice(2), manifest))
              socket.send(JSON.stringify(['EVENT', m[1], manifest]));
            socket.send(JSON.stringify(['EOSE', m[1]]));
          }
        },
      },
    });
    manifest = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [
          ['d', 'original'],
          ['path', '/index.html', hash],
          ['title', 'Original'],
          ['server', String(server.url).replace(/\/$/, '')],
        ],
      },
      generateSecretKey(),
    );
    const local = { NAPPLET_DOWNLOAD_BASE: server.url.href.replace(/\/$/, '') };
    try {
      // Simulate an existing managed installation. Upgrading must keep state in place.
      const legacy = join(env.NAPPLET_BIN_DIR, 'napplet-space');
      const oldRelease = join(env.NAPPLET_INSTALL_DIR, 'releases/0.5.0-test');
      await mkdir(oldRelease, { recursive: true });
      await mkdir(env.NAPPLET_BIN_DIR, { recursive: true });
      await writeFile(join(oldRelease, 'napplet-space'), 'old release');
      await symlink(join(oldRelease, 'napplet-space'), legacy);
      const accountId = crypto.randomUUID();
      const configRoot = join(root, 'config');
      const accountDirectory = join(configRoot, 'napplet-space/accounts/public');
      await mkdir(accountDirectory, { recursive: true });
      const accountState = JSON.stringify({
        version: 1,
        network: 'public',
        active: accountId,
        accounts: [{ id: accountId, pubkey: manifest.pubkey, type: 'local', status: 'ready' }],
      });
      await writeFile(join(accountDirectory, 'accounts.json'), accountState, { mode: 0o600 });
      const accountEnv = { XDG_CONFIG_HOME: configRoot, SPACE_ACCOUNT_HOME: undefined };
      const beforeAccount = await run([binary, 'account', 'show', '--json'], root, accountEnv);
      expect(beforeAccount.stdout).toContain(manifest.pubkey);
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
      const command = join(env.NAPPLET_BIN_DIR, 'soyli');
      const destination = await readlink(command);
      expect(await readlink(legacy)).toBe(destination);
      expect(await Bun.file(join(oldRelease, 'napplet-space')).text()).toBe('old release');
      expect((await run([legacy, '--version'])).stdout).toBe(`soyli ${release.version}\n`);
      expect((await run([command, '--help'])).stdout).toStartWith('napplet soyLI');
      expect(await run([command, 'account', 'show', '--json'], root, accountEnv)).toEqual(
        beforeAccount,
      );
      expect(await Bun.file(join(accountDirectory, 'accounts.json')).text()).toBe(accountState);
      expect(
        (await Bun.file(join(root, 'installed-project/package.json')).json()).scripts.dev,
      ).toBe('soyli dev');
      expect(
        await Bun.file(join(root, 'installed-project/docs/napplet-space.md')).text(),
      ).toContain('napplet soyLI integration');
      // A foreign legacy executable must be left alone while soyli can still update.
      await rm(legacy);
      await writeFile(legacy, 'foreign legacy command');
      const upgraded = await run(['/bin/sh', source], root, local);
      expect(upgraded.code, upgraded.stderr).toBe(0);
      expect(upgraded.stdout).toContain('belongs to another installation. Use soyli.');
      expect(await Bun.file(legacy).text()).toBe('foreign legacy command');
      expect((await run([command, '--version'])).stdout).toContain(release.version);
      const remixed = await run(
        [
          '/bin/sh',
          source,
          'remix',
          nip19.neventEncode({ id: manifest.id, relays: [`ws://127.0.0.1:${server.port}`] }),
          'installed-remix',
          '--network',
          'local',
          '--identity',
          'later',
          '--json',
        ],
        root,
        {
          ...local,
          NAPPLET_INSTALL_DIR: join(root, 'fresh-remix-install'),
          NAPPLET_BIN_DIR: join(root, 'fresh-remix-bin'),
        },
      );
      expect(remixed.code, remixed.stdout + remixed.stderr).toBe(0);
      expect(
        (await Bun.file(join(root, 'installed-remix/napplet.json')).json()).remix.revision,
      ).toBe(manifest.id);
      expect(await Bun.file(join(root, 'installed-remix/index.html')).text()).toBe(html);
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
          await fetch(new URL(`/${release.version}/soyli-linux-x64.tar.gz.sha256`, server.url), {
            method: 'HEAD',
          })
        ).headers.get('content-length'),
      ).not.toBeNull();
    } finally {
      server.stop(true);
      delete process.env.SPACE_CLI_DOWNLOAD_DIR;
    }
  },
  90000,
);
