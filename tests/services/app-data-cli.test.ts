import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(!process.env.SPACE_TEST_CLI)(
  'standalone soyLI ships usable shared-data helpers and preserves creator edits during skills update',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-app-data-cli-'));
    const repository = resolve(import.meta.dir, '../..');
    const run = async (args: string[], cwd = root, expectedCode = 0) => {
      const child = Bun.spawn([process.env.SPACE_TEST_CLI!, ...args, '--json'], {
        cwd,
        env: { PATH: '/usr/bin:/bin', SPACE_ACCOUNT_HOME: join(root, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => child.kill(), 15000);
      try {
        const [code, output, error] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, output + error).toBe(expectedCode);
        return JSON.parse(output);
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      await run(['new', 'shared-creations', '--identity', 'later', '--no-install']);
      const project = join(root, 'shared-creations');
      for (const [target, source] of [
        ['docs/napplet-data.md', 'docs/SHARED-DATA.md'],
        ['docs/examples/app-data.ts', 'packages/app-data/src/app-data.ts'],
        ['docs/examples/app-data-contract.ts', 'packages/app-data/src/app-data-contract.ts'],
      ])
        expect(await Bun.file(join(project, target)).text()).toBe(
          await Bun.file(join(repository, source)).text(),
        );
      expect(await Bun.file(join(project, 'docs/napplet-space.md')).text()).toContain(
        'For player-created tracks',
      );
      // Build the delivered pair, not repository imports: catches raw-loader and relative-path omissions.
      const build = await Bun.build({
        entrypoints: [join(project, 'docs/examples/app-data.ts')],
        target: 'browser',
        format: 'esm',
      });
      expect(build.success, build.logs.join('\n')).toBe(true);
      expect(await build.outputs[0].text()).toContain('soy.app-data/1');
      const helper = join(project, 'docs/examples/app-data.ts');
      await Bun.write(helper, '// Creator-owned adaptation\n');
      const updated = await run(['skills', 'update'], project, 1);
      expect(updated.conflicts).toEqual(['docs/examples/app-data.ts']);
      expect(await Bun.file(helper).text()).toBe('// Creator-owned adaptation\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
