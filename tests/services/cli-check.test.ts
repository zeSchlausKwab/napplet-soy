import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserCache } from '../../apps/cli/src/browser';

test('signer-free CLI check uses the effective creator binding and still rejects a wrong network', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-check-binding-'));
  const creator = { pubkey: '1'.repeat(64), network: 'local' };
  const legacy = { pubkey: '2'.repeat(64), network: 'public' };
  const command = process.env.SPACE_TEST_CLI
    ? [process.env.SPACE_TEST_CLI]
    : [process.execPath, new URL('../../apps/cli/src/index.ts', import.meta.url).pathname];
  try {
    await Bun.write(join(root, 'index.html'), '<!doctype html><p>A working creation</p>');
    await Bun.write(join(root, 'LICENSE'), 'MIT license');
    for (const scenario of [
      { name: 'binding only', binding: creator },
      { name: 'legacy portable', portable: creator },
      { name: 'unbound' },
      { name: 'binding takes precedence', portable: legacy, binding: creator },
      { name: 'wrong network', binding: legacy, error: true },
    ]) {
      await Bun.write(
        join(root, 'napplet.json'),
        JSON.stringify({
          schema: 'space-local-project/v1',
          name: 'Check fixture',
          previewId: crypto.randomUUID(),
          entry: 'index.html',
          license: 'MIT',
          preview: { delayMs: 250 },
          creator: scenario.portable,
        }),
      );
      const binding = join(root, '.napplet-space/project.json');
      await rm(binding, { force: true });
      if (scenario.binding)
        await Bun.write(
          binding,
          JSON.stringify({ version: 1, project: { creator: scenario.binding } }),
        );
      const child = Bun.spawn(
        [...command, 'check', '--project', root, '--network', 'local', '--json'],
        {
          cwd: root,
          env: {
            ...process.env,
            SPACE_ACCOUNT_HOME: join(root, 'empty-accounts'),
            PLAYWRIGHT_BROWSERS_PATH: browserCache(),
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      clearTimeout(timer);
      const result = JSON.parse(out);
      expect(code, scenario.name + ': ' + out + err).toBe(scenario.error ? 1 : 0);
      if (scenario.error) expect(result.error.code).toBe('CREATOR_MISMATCH');
      else {
        expect(result.status).toBe('checked');
        expect(result.previewBytes).toBeGreaterThan(0);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
