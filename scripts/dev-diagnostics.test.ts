import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('dev startup reports the actual PM2 log, useful cause and redacts credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-dev-diagnostics-'));
  try {
    const pm2 = join(root, 'node_modules/pm2/bin/pm2');
    await mkdir(resolve(pm2, '..'), { recursive: true });
    await Bun.write(
      pm2,
      `
      if (process.env.PM2_HOME !== ${JSON.stringify(join(root, '.local/pm2'))} ||
          process.argv.slice(2).join(' ') !== 'logs napplet-local-blossom --lines 30 --nostream')
        process.exit(2);
      console.log('napplet-local-blossom-error-10.log last 30 lines:');
      console.log('Error: Blossom data directory is already in use');
      console.log('secret=do-not-print-me');
      console.error('bunker://private-connection?secret=another-secret');
    `,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
      import { serviceStartupError } from ${JSON.stringify(resolve('scripts/dev-diagnostics.ts'))};
      import { diagnose, formatDiagnostic } from ${JSON.stringify(resolve('packages/diagnostics/src'))};
      console.error(formatDiagnostic(diagnose(await serviceStartupError(${JSON.stringify(root)}, 'blossom'))));
      process.exit(1);
    `,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [status, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(status).toBe(1);
    expect(output).toContain('DEV_SERVICE_NOT_READY');
    expect(output).toContain('napplet-local-blossom-error-10.log');
    expect(output).toContain('Blossom data directory is already in use');
    expect(output).toContain('bun run dev:doctor');
    expect(output).not.toContain('do-not-print-me');
    expect(output).not.toContain('private-connection');
    expect(output).not.toContain('another-secret');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
