import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('./cli-release.ts', import.meta.url).pathname;
test('legacy VPS upload explains missing local packages before SSH, preserving a redacted cause', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-mirror-error-'));
  try {
    const preload = join(root, 'missing-artifacts.ts');
    await writeFile(
      preload,
      `
      const file = Bun.file;
      Bun.file = function(path, ...args) {
        if (String(path).includes('/.local/cli/')) return {
          text: async () => { throw Object.assign(new Error('missing package; token=fixture-private-token'), { code: 'ENOENT' }); }
        };
        return file(path, ...args);
      };
      Bun.spawn = () => { throw new Error('Must fail before starting SSH or other tools'); };
    `,
    );
    const child = Bun.spawn(
      [process.execPath, '--preload', preload, script, '--host', 'example.invalid'],
      {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('CLI_RELEASE_ARTIFACTS');
    expect(stderr).toContain('GitHub Releases');
    expect(stderr).toContain('bun run deploy');
    expect(stderr).toContain('bun run cli:build');
    expect(stderr).toContain('Cause (ENOENT)');
    expect(stderr).toContain('missing package');
    expect(stderr + stdout).not.toContain('fixture-private-token');
    expect(stderr).not.toContain('Must fail before');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy release help distinguishes website deployment from an optional VPS mirror', async () => {
  const child = Bun.spawn([process.execPath, script, '--help'], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout).toContain('GitHub Releases');
  expect(stdout).toContain('bun run deploy');
  expect(stdout).toContain('bun run cli:build');
});
