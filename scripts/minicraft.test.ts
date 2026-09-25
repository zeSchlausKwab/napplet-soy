import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('the demo reports the browser compiler failure with its exit status and redacted cause', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'minicraft-build-'));
  const secret = 'nsec1not-a-real-key-do-not-print';
  const directory = join(scratch, secret);
  try {
    // Force a real child-process output failure without touching any demo data.
    await mkdir(join(directory, 'index.html'), { recursive: true });
    const child = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `import { prepareMinicraft } from ${JSON.stringify(resolve('scripts/minicraft.ts'))};
       import { diagnose, formatDiagnostic } from ${JSON.stringify(resolve('packages/diagnostics/src/index.ts'))};
       try { await prepareMinicraft(process.argv.at(-1)); }
       catch (error) { console.error(formatDiagnostic(diagnose(error, 'start MiniCraft local demo'))); process.exitCode = 1; }`,
        directory,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exit).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain('MINICRAFT_BUILD');
    expect(output).toContain('build MiniCraft browser assets');
    expect(output).toContain('EISDIR');
    expect(output).toContain('Exit status: 1');
    expect(output).toContain('bun run demo:minicraft');
    expect(output).not.toContain(secret);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15000);
