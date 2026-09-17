import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('state backup restores exact bytes into a new directory and rejects corruption and overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-backup-'));
  const script = resolve('scripts/backup-data.py');
  const run = async (...args: string[]) => {
    const process = Bun.spawn(['python3', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
    await new Response(process.stdout).text();
    await new Response(process.stderr).text();
    return process.exited;
  };
  try {
    for (const name of ['relay', 'blossom', 'grasp', 'index', 'moderation', 'community', 'cvm']) {
      await mkdir(join(root, 'state', name), { recursive: true });
      await Bun.write(join(root, 'state', name, 'data'), `state:${name}`);
    }
    await mkdir(join(root, 'shared'));
    await Bun.write(join(root, 'shared', 'server.env'), 'TEST_FIXTURE=true');
    await Bun.write(join(root, 'shared', 'unrelated'), 'not in backup');
    const archive = join(root, 'backup.tar.gz');
    expect(
      await run(
        'snapshot',
        '--state',
        join(root, 'state'),
        '--shared',
        join(root, 'shared'),
        '--destination',
        join(root, 'snapshot'),
        '--release',
        'test',
      ),
    ).toBe(0);
    expect(await run('pack', '--snapshot', join(root, 'snapshot'), '--archive', archive)).toBe(0);
    expect(await run('verify', '--archive', archive)).toBe(0);
    expect(
      await run('restore', '--archive', archive, '--destination', join(root, 'restored')),
    ).toBe(0);
    expect(await Bun.file(join(root, 'restored/state/grasp/data')).text()).toBe('state:grasp');
    expect(await Bun.file(join(root, 'restored/state/cvm/data')).text()).toBe('state:cvm');
    expect(await Bun.file(join(root, 'restored/shared/server.env')).text()).toBe(
      'TEST_FIXTURE=true',
    );
    expect(await Bun.file(join(root, 'restored/shared/unrelated')).exists()).toBe(false);
    expect(
      await run('restore', '--archive', archive, '--destination', join(root, 'restored')),
    ).not.toBe(0);
    await Bun.write(archive, 'corrupt');
    expect(await run('verify', '--archive', archive)).not.toBe(0);
    await symlink('/etc/passwd', join(root, 'state/relay/escape'));
    expect(
      await run(
        'snapshot',
        '--state',
        join(root, 'state'),
        '--shared',
        join(root, 'shared'),
        '--destination',
        join(root, 'linked'),
        '--release',
        'test',
      ),
    ).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
