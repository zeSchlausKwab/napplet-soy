import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('relay test runner reports the Go failure and exit status without leaking tool output secrets', async () => {
  // An invalid test filter deterministically fails inside the real Go process.
  // Its error echoes the filter, exercising redaction at the script boundary.
  const secret = 'a'.repeat(64);
  const child = Bun.spawn(
    [process.execPath, 'scripts/relay-go.ts', 'test', '-run', `[${secret}`, './...'],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = stdout + stderr;
  expect(code).toBe(1);
  expect(output).toContain('error parsing regexp');
  expect(output).toContain('missing closing ]');
  expect(output).toContain('Operation: relay test');
  expect(output).toContain('Tool: go');
  expect(output).toContain('Exit status: 1');
  expect(output).toContain('services/relay');
  expect(output).toContain('bun run test:relay');
  expect(output).toContain('[64-character key/hash redacted]');
  expect(output).not.toContain(secret);
  expect(output).not.toContain('Build prerequisites');
}, 120_000);
