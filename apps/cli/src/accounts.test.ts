import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function run(args: string[], input = '') {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-account-command-'));
  try {
    const child = Bun.spawn(
      [process.execPath, new URL('./index.ts', import.meta.url).pathname, ...args, '--json'],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: directory },
        stdin: new Blob([input]),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      code,
      stdout,
      stderr,
      saved: await Bun.file(join(directory, 'accounts/public/accounts.json')).exists(),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('account show reports absence without provisioning a key or account files', async () => {
  const result = await run(['account', 'show']);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ account: null });
  expect(result.saved).toBe(false);
});
test('CLI rejects sensitive arguments and invalid stdin with structured errors that do not echo secrets', async () => {
  const secret = 'nsec1sensitive-input-must-not-appear';
  for (const [args, stdin, code] of [
    [['account', 'import', secret], '', 'USAGE'],
    [['account', 'import', '--nsec', secret], '', 'USAGE'],
    [['account', 'import', '--stdin'], secret, 'INVALID_RECOVERY'],
    [['account', 'connect', '--stdin'], secret, 'INVALID_BUNKER'],
  ] as [string[], string, string][]) {
    const result = await run(args, stdin);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe(code);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.saved).toBe(false);
  }
});
