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
      // The compiled workshop pauses Vite for writes and resumes watching afterwards.
      const dev = Bun.spawn([binary, 'dev', '--no-open', '--port', '0', '--json'], {
        cwd: fresh,
        env: { ...process.env, PATH: '/usr/bin:/bin', SPACE_ACCOUNT_HOME: join(root, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const devTimer = setTimeout(() => dev.kill('SIGKILL'), 60000);
      const errors = new Response(dev.stderr).text();
      try {
        const reader = dev.stdout.getReader();
        let output = '';
        while (!output.includes('\n')) {
          const next = await reader.read();
          if (next.done) throw new Error('Watcher exited: ' + (await errors));
          output += new TextDecoder().decode(next.value);
        }
        reader.releaseLock();
        const { url } = JSON.parse(output.split('\n')[0]);
        const html = await (await fetch(url)).text();
        const token = html.match(/name="soyli-token" content="([^"]+)"/)![1];
        const headers = {
          'X-Soyli-Token': token,
          Origin: new URL(url).origin,
          'Content-Type': 'application/json',
        };
        const manager = await (await fetch(new URL('manager', url), { headers })).json();
        const saved = await fetch(new URL('manager', url), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'project',
            revision: manager.revision,
            changes: { ...manager.project, title: 'Watched workshop' },
          }),
        });
        expect(saved.status, await saved.text()).toBe(200);
        expect(dev.exitCode).toBeNull();
        const before = await (await fetch(new URL('revision', url))).json();
        await Bun.write(
          join(fresh, 'src/main.ts'),
          'document.body.textContent = "The watcher restarted";',
        );
        let after = before;
        for (let i = 0; i < 100 && after.artifactHash === before.artifactHash; i++) {
          await Bun.sleep(100);
          after = await (await fetch(new URL('revision', url))).json();
        }
        expect(after.artifactHash).not.toBe(before.artifactHash);
        expect(dev.exitCode).toBeNull();
      } finally {
        clearTimeout(devTimer);
        dev.kill();
        await dev.exited;
        await errors;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  240000,
);
