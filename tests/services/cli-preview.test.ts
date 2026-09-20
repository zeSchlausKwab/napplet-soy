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
      const dev = Bun.spawn(
        [
          cli,
          'dev',
          '--project',
          project,
          '--network',
          'local',
          '--no-open',
          '--port',
          '0',
          '--json',
        ],
        {
          cwd: root,
          env: { PATH: '/usr/bin:/bin', HOME: homedir() },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const timeout = setTimeout(() => dev.kill('SIGKILL'), 15000);
      try {
        const reader = dev.stdout.getReader();
        let output = '';
        while (!output.includes('\n')) {
          const { value, done } = await reader.read();
          if (done) throw new Error('Preview exited before announcing its URL.');
          output += new TextDecoder().decode(value);
        }
        reader.releaseLock();
        const { url } = JSON.parse(output.split('\n')[0]);
        const listing = await (await fetch(new URL('listing', url))).json();
        expect(listing.title).toBe(saved.title ?? saved.name);
        expect(listing.network).toBe('local');
        expect(listing.image.width).toBe(1200);
        expect(listing.captureAvailable).toBe(true);
        const host = await (await fetch(url)).text();
        expect(host).toContain('id="view-listing"');
        expect(host).toContain('name="soyli-workshop" content="true"');
        const token = host.match(/name="soyli-token" content="([^"]+)"/)![1];
        const headers = {
          'X-Soyli-Token': token,
          Origin: new URL(url).origin,
          'Content-Type': 'application/json',
        };
        const state = await (await fetch(new URL('workshop', url), { headers })).json();
        expect(state.tree.changed).toContain('napplet.json');
        const started = await fetch(new URL('workshop', url), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'checkpoint',
            revision: state.revision,
            message: 'A reviewed capture',
          }),
        });
        expect(started.status).toBe(202);
        let result;
        for (let i = 0; i < 100; i++) {
          result = await (await fetch(new URL('workshop', url), { headers })).json();
          if (!result.busy) break;
          await Bun.sleep(50);
        }
        expect(result.job.error).toBeUndefined();
        expect(result.job.state).toBe('done');
        expect(result.tree.changed).toEqual([]);
      } finally {
        clearTimeout(timeout);
        dev.kill();
        await dev.exited;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
