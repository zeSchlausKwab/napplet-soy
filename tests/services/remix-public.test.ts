import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Read-only acceptance against a published pinned release. Local ws fixtures do
// not exercise Bun's TLS/WebSocket upgrade, which previously hid available events.
test.skipIf(!process.env.SPACE_TEST_REMIX_REFERENCE)(
  'CLI remixes a public pinned release through the guarded relay transport',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soyli-public-remix-'));
    try {
      const command = process.env.SPACE_TEST_CLI
        ? [resolve(process.env.SPACE_TEST_CLI)]
        : [process.execPath, resolve(import.meta.dir, '../../apps/cli/src/index.ts')];
      const child = Bun.spawn(
        [
          ...command,
          'remix',
          process.env.SPACE_TEST_REMIX_REFERENCE!,
          'remix',
          '--identity',
          'later',
          '--no-install',
          '--json',
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
            SPACE_ACCOUNT_HOME: join(directory, 'accounts'),
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const timeout = setTimeout(() => child.kill(), 85000);
      try {
        const [code, out, error] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, out + error).toBe(0);
        expect(error).toBe('');
        const result = JSON.parse(out);
        expect(result.directory).toEndWith('/remix');
        expect(result.account).toBeNull();
        const pinned = /\/r\/([a-f0-9]{64})\/?$/.exec(process.env.SPACE_TEST_REMIX_REFERENCE!)?.[1];
        if (pinned) expect(result.remix.lineage.revision).toBe(pinned);
        expect(await Bun.file(join(directory, 'remix/napplet.json')).exists()).toBe(true);
        if (result.remix.source === 'git') {
          const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
            cwd: result.directory,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const [code, head] = await Promise.all([git.exited, new Response(git.stdout).text()]);
          expect(code).toBe(0);
          expect(head.trim()).toBe(result.remix.lineage.sourceCommit);
        }
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null) {
          child.kill();
          await child.exited;
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  90000,
);
