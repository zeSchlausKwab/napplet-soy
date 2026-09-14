import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cliDownload } from '../../packages/backend/src/cli-download';

// Run against built release archives: SPACE_TEST_CLI=1 bun test tests/services/cli-terminal.test.ts
const enabled = process.env.SPACE_TEST_CLI === undefined ? test.skip : test;
const installer = resolve(import.meta.dir, '../../apps/web/public/install.sh');

async function interactiveInstall(cancel = false, redirectErrors = false) {
  const root = await mkdtemp(join(tmpdir(), 'napplet-terminal-test-'));
  const previousDownloads = process.env.SPACE_CLI_DOWNLOAD_DIR;
  process.env.SPACE_CLI_DOWNLOAD_DIR = resolve(import.meta.dir, '../../.local/cli');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/install.sh') return new Response(Bun.file(installer));
      const [version, name] = path.split('/').slice(-2);
      return cliDownload(request, version, name);
    },
  });
  let output = '';
  const child = Bun.spawn(
    [
      '/bin/sh',
      '-c',
      `
      before=$(stty -g)
      curl -fsSL "$TEST_INSTALL_URL" | sh -s -- new creation --no-install ${redirectErrors ? '2>errors.log' : ''}
      result=$?
      [ "$before" = "$(stty -g)" ] || exit 80
      exit "$result"
    `,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        SPACE_ACCOUNT_HOME: join(root, 'accounts'),
        NAPPLET_INSTALL_DIR: join(root, 'install'),
        NAPPLET_BIN_DIR: join(root, 'bin'),
        NAPPLET_DOWNLOAD_BASE: server.url.href.replace(/\/$/, ''),
        TEST_INSTALL_URL: new URL('/install.sh', server.url).href,
      },
      terminal: {
        cols: 160,
        data(_terminal, bytes) {
          output += Buffer.from(bytes).toString();
        },
      },
    },
  );
  const timeout = setTimeout(() => child.kill('SIGKILL'), 12000);
  try {
    const transcript = async () =>
      output +
      (redirectErrors
        ? await Bun.file(join(root, 'errors.log'))
            .text()
            .catch(() => '')
        : '');
    const waitFor = async (text: string) => {
      const deadline = Date.now() + 8000;
      while (
        !(await transcript()).includes(text) &&
        Date.now() < deadline &&
        child.exitCode === null
      )
        await Bun.sleep(20);
      expect(await transcript()).toContain(text);
    };
    if (!redirectErrors) {
      await waitFor('Set up later (1):');
      // Immediate input can be buffered before Bun's /dev/tty poll stalls on macOS.
      await Bun.sleep(1000);
      child.terminal!.write(cancel ? '2\r' : '3\r');
    }
    if (cancel) {
      await waitFor('Paste bunker connection link (hidden):');
      await Bun.sleep(1000);
      child.terminal!.write('private-input-canary');
      await Bun.sleep(100);
      child.terminal!.write('\u0003');
    }
    const code = await child.exited;
    const result = await transcript();
    expect(code, result).toBe(cancel ? 1 : 0);
    if (redirectErrors) expect(result).not.toContain('Set up later (1):');
    if (cancel) {
      expect(result).toContain('INPUT_CANCELLED');
      expect(result).not.toContain('private-input-canary');
      expect(result).toContain('Preview project retained');
    } else {
      expect(result).toContain('Your napplet is ready');
      expect(result).toContain('napplet-space dev');
    }
    expect(await Bun.file(join(root, 'creation/napplet.json')).exists()).toBe(true);
    expect(await Bun.file(join(root, 'accounts/accounts.json')).exists()).toBe(false);
  } finally {
    clearTimeout(timeout);
    child.kill('SIGKILL');
    child.terminal?.close();
    await child.exited;
    server.stop(true);
    if (previousDownloads === undefined) delete process.env.SPACE_CLI_DOWNLOAD_DIR;
    else process.env.SPACE_CLI_DOWNLOAD_DIR = previousDownloads;
    await rm(root, { recursive: true, force: true });
  }
}

enabled(
  'curl-piped installer accepts a creator choice after the user pauses to read it',
  () => interactiveInstall(),
  15000,
);
enabled(
  'installer preserves hidden input and restores the terminal after cancellation',
  () => interactiveInstall(true),
  15000,
);
enabled(
  'installer skips unseen prompts when stderr is redirected',
  () => interactiveInstall(false, true),
  15000,
);
