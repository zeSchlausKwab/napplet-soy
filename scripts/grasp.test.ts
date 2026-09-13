import { expect, test } from 'bun:test';
import { graspEnvironment } from './grasp';

test('PM2 and process tests use the same GRASP configuration and persistent working directory', async () => {
  const input = {
    origin: 'https://git.napplet.example',
    directory: '/var/lib/napplet-space/grasp',
    local: false,
    instance: 'napplet.example',
  };
  const child = Bun.spawn(
    [
      'node',
      '-e',
      'console.log(JSON.stringify(require("./infra/grasp.ecosystem.config.cjs").apps[0]))',
    ],
    {
      env: {
        PATH: process.env.PATH,
        SPACE_GRASP_ORIGIN: input.origin,
        SPACE_GRASP_DATA: input.directory,
        SPACE_GRASP_LOCAL: '0',
        SPACE_GRASP_INSTANCE: input.instance,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const app = await new Response(child.stdout).json();
  expect(await child.exited).toBe(0);
  expect(app.cwd).toBe(input.directory);
  expect(app.instances).toBe(1);
  expect(app.env).toEqual(graspEnvironment(input));
  expect(app.env.NGIT_SYNC_ALLOW_NON_GLOBAL_TARGETS).toBe('false');
  expect(app.env.GIT_CONFIG_VALUE_0).toBe(String(50 * 1024 * 1024));
});
