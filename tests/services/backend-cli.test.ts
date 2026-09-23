import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

test.skipIf(!process.env.SPACE_TEST_CLI)(
  'packaged soyLI checks a scoreboard creation against an isolated backend without Bun or Node',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-compiled-backend-'));
    const binary = process.env.SPACE_TEST_CLI!;
    const run = async (args: string[], cwd = root) => {
      const child = Bun.spawn([binary, ...args, '--json'], {
        cwd,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: homedir(),
          SPACE_ACCOUNT_HOME: join(root, 'accounts'),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => child.kill(), 30000);
      try {
        const [code, output, errors] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, output + errors).toBe(0);
        return JSON.parse(output);
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      await run([
        'new',
        'score-fixture',
        '--template',
        'soft-orbit',
        '--identity',
        'later',
        '--no-install',
      ]);
      const directory = join(root, 'score-fixture'),
        file = join(directory, 'napplet.json');
      const config = await Bun.file(file).json();
      config.backend = {
        provider: { pubkey: 'f'.repeat(64), relays: ['wss://backend.invalid'] },
        boards: [
          {
            board: 'test',
            title: 'Test',
            order: 'highest',
            minimum: 0,
            maximum: 100,
            dataSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['car'],
              properties: { car: { type: 'string' } },
            },
          },
        ],
      };
      config.requires = ['cvm'];
      config.preview = { delayMs: 3000 };
      await Bun.write(file, JSON.stringify(config));
      await run(['backend', 'init'], directory);
      const context = await Bun.file(join(directory, '.napplet-space/soy-backend.json')).json();
      await Bun.write(
        join(directory, 'index.html'),
        `<!doctype html><body>Connecting<script>
      let done = false;
      setTimeout(() => { if (!done) throw new Error('Isolated board never answered'); }, 2000);
      (async () => {
        const context = ${JSON.stringify(context)};
        const result = await window.napplet.cvm.registry.call('soy.boards.v2', 'soy_board_submit', { napplet: context.napplet, board: 'test', score: 42, data: { car: 'coral' } });
        if (result.isError || result.structuredContent.own.score !== 42) throw new Error('Board failed: ' + JSON.stringify(result));
        const own = result.structuredContent.own;
        const details = await window.napplet.cvm.callTool(context.provider, 'soy_board_entry', { napplet: context.napplet, board: 'test', actor: own.actor, revision: own.revision });
        if (details.isError || details.structuredContent.entry.data.car !== 'coral') throw new Error('Score attachment failed');
        done = true; document.body.dataset.score = '42';
      })();
    </script>`,
      );
      const result = await run(['check'], directory);
      expect(result.status).toBe('checked');
      expect(result.profile).toBe('space-playback-4');
      expect(await Bun.file(join(directory, 'docs/napplet-backend.md')).text()).toContain(
        "import { cvm, webrtc } from '@napplet/sdk'",
      );
      expect(await Bun.file(join(directory, 'docs/napplet-backend.md')).text()).toContain(
        'Score attachments: cars, drawings',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
