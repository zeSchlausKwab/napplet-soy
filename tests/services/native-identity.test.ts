import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, NativeVault } from '../../packages/identity/src/accounts';

// Opt-in: writes only random credential IDs referenced by this temporary account
// directory, then removes every one. It never opens the user's default account.
test.skipIf(process.env.SPACE_TEST_NATIVE_KEYSTORE !== '1')(
  'native keychain survives CLI processes, two projects reuse one creator, and encrypted recovery restores it',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'napplet-native-key-'));
    const vault = new NativeVault('space.napplet.creator.local');
    const accounts = new Accounts('local', join(directory, 'accounts/local'), vault);
    const cli = new URL('../../apps/cli/src/index.ts', import.meta.url).pathname;
    async function run(args: string[], input?: string) {
      const child = Bun.spawn([process.execPath, cli, ...args, '--network', 'local', '--json'], {
        cwd: directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: directory },
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: input === undefined ? 'ignore' : new Blob([input]),
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(0);
        expect(stderr).toBe('');
        expect(stdout).not.toContain('nsec1');
        expect(stdout).not.toContain('temporary recovery passphrase');
        return JSON.parse(stdout);
      } finally {
        clearTimeout(timeout);
      }
    }
    try {
      const { account } = await run(['account', 'create']);
      expect((await run(['account', 'check'])).account.pubkey).toBe(account.pubkey);
      for (const folder of ['first-project', 'second-project']) {
        const project = await run(['new', folder]);
        expect(project.account.pubkey).toBe(account.pubkey);
        expect((await Bun.file(join(directory, folder, 'napplet.json')).json()).creator).toEqual({
          pubkey: account.pubkey,
          network: 'local',
        });
        for (const file of ['napplet.json', '.napplet/client.js', '.napplet/server.js'])
          expect(await Bun.file(join(directory, folder, file)).text()).not.toContain(
            JSON.parse((await vault.get(account.id))!).key,
          );
      }
      const recovery = join(directory, 'recovery.ncryptsec');
      const password = 'temporary recovery passphrase';
      await run(['account', 'export', recovery, '--passphrase-stdin'], password + '\n');
      const imported = await run(
        ['account', 'import', '--stdin'],
        (await Bun.file(recovery).text()).trim() + '\n' + password + '\n',
      );
      expect(imported.account.pubkey).toBe(account.pubkey);
      expect((await run(['account', 'list'])).accounts).toHaveLength(2);
    } finally {
      for (const account of await accounts.list()) {
        await vault.delete(account.id);
        expect(await vault.get(account.id)).toBeNull();
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
