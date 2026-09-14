import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

test.skipIf(!process.env.SPACE_TEST_CLI)(
  'compiled creator CLI exposes targets and captures a selected screenshot without Bun or Node on PATH',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'napplet-native-preview-'));
    const cli = process.env.SPACE_TEST_CLI!;
    const run = async (...args: string[]) => {
      const child = Bun.spawn([cli, ...args, '--network', 'local', '--json'], {
        cwd: root,
        env: { PATH: '/usr/bin:/bin', HOME: homedir() },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
      try {
        const [code, output, error] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, output + error).toBe(0);
        return JSON.parse(output);
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      await run(
        'new',
        'capture',
        '--template',
        'soft-orbit',
        '--identity',
        'later',
        '--no-install',
      );
      const project = join(root, 'capture');
      const config = await run('config', '--project', project);
      expect(config.targets.relay).toBe('ws://127.0.0.1:19347/relay');
      const saved = await Bun.file(join(project, 'napplet.json')).json();
      expect(saved.publish.networks.public.blossom).toBe('https://blossom.napplet.soy');
      expect(await Bun.file(join(project, 'docs/napplet-space.md')).text()).toContain(
        'Inspect the image',
      );
      const capture = await run('screenshot', '--project', project);
      const metadata = await sharp(await Bun.file(capture.image).bytes()).metadata();
      expect([metadata.width, metadata.height]).toEqual([1200, 750]);
      expect((await run('config', '--project', project)).preview.image).toBe('preview.png');
      expect((await run('check', '--project', project)).previewBytes).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
