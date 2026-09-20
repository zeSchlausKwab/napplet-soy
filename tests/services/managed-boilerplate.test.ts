import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProject } from '../../packages/publish/src/project';
import { checkPublication } from '../../apps/cli/src/publish-check';

const enabled = process.env.SPACE_TEST_CLI ? test : test.skip;
enabled(
  'standalone managed assets rebuild in the upstream boilerplate and a fresh Git checkout',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-managed-boilerplate-'));
    const binary = process.env.SPACE_TEST_CLI!;
    async function run(args: string[], cwd: string, cli = true) {
      const child = Bun.spawn(cli ? [binary, ...args] : args, {
        cwd,
        env: { ...process.env, PATH: '/usr/bin:/bin', SPACE_ACCOUNT_HOME: join(root, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
      try {
        const [code, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, out + err).toBe(0);
        return out;
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      await run(['new', 'original', '--identity', 'later', '--json'], root);
      const original = join(root, 'original'),
        fresh = join(root, 'fresh');
      const png = join(root, 'sprite.png');
      await Bun.write(
        png,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
          'base64',
        ),
      );
      for (const storage of ['embedded', 'external'])
        await run(
          ['assets', 'add', png, storage, '--storage', storage, '--license', 'CC0'],
          original,
        );
      await Bun.write(
        join(original, 'src/main.ts'),
        `import { assetUrl } from '../soy-assets.js';
const output = document.createElement('output'); document.body.replaceChildren(output);
Promise.all(['embedded','external'].map(async id => { const image = new Image(); image.src = await assetUrl(id); await image.decode(); return image.naturalWidth; })).then(sizes => { output.textContent = JSON.stringify(sizes); }).catch(error => { throw error; });`,
      );
      await run(['build'], original);
      expect(await run(['check', '--json'], original)).toContain('"status":"checked"');
      await run(['git', 'add', '.'], original, false);
      await run(
        [
          'git',
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@invalid',
          'commit',
          '-m',
          'Managed asset fixture',
        ],
        original,
        false,
      );
      await run(['git', 'clone', '--no-hardlinks', original, fresh], root, false);
      await rm(original, { recursive: true, force: true });
      await run(['setup'], fresh);
      await run(['run', 'type-check'], fresh);
      await run(['build'], fresh);
      expect(await run(['check', '--json'], fresh)).toContain('"status":"checked"');
      const inspected = await inspectProject(fresh, 'public', '0'.repeat(64));
      expect(inspected.plan.requires).toContain('resource');
      expect(inspected.contents.has('soy-assets.d.ts')).toBe(true);
      expect((await checkPublication(inspected.contents)).preview.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);
