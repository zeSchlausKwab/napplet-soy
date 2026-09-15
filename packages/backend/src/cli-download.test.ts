import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliDownload } from './cli-download';

test('download route serves only versioned release files, supports HEAD and blocks traversal/symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-download-route-'));
  const previous = process.env.SPACE_CLI_DOWNLOAD_DIR;
  process.env.SPACE_CLI_DOWNLOAD_DIR = root;
  const request = new Request('http://localhost/cli/download/0.1.0/napplet-space-linux-x64.tar.gz');
  const name = 'napplet-space-linux-x64.tar.gz';
  try {
    await mkdir(join(root, '0.1.0'));
    await writeFile(join(root, '0.1.0', name), 'release bytes');
    const get = await cliDownload(request, '0.1.0', name);
    expect(await get.text()).toBe('release bytes');
    expect(get.headers.get('cache-control')).toContain('immutable');
    expect(get.headers.get('content-type')).toBe('application/gzip');
    const head = await cliDownload(new Request(request, { method: 'HEAD' }), '0.1.0', name);
    expect(head.headers.get('content-length')).toBe('13');
    expect(await head.text()).toBe('');
    // Old immutable download URLs remain valid alongside the new executable name.
    await writeFile(join(root, '0.1.0', 'soyli-linux-x64.tar.gz'), 'renamed bytes');
    expect(await (await cliDownload(request, '0.1.0', 'soyli-linux-x64.tar.gz')).text()).toBe(
      'renamed bytes',
    );
    for (const [version, path] of [
      ['..', name],
      ['0.1.0', '../secret'],
      ['0.1.0', 'embedded.json'],
    ])
      expect((await cliDownload(request, version, path)).status).toBe(404);
    await rm(join(root, '0.1.0', name));
    await symlink('/etc/hosts', join(root, '0.1.0', name));
    expect((await cliDownload(request, '0.1.0', name)).status).toBe(404);
    expect(
      (await cliDownload(new Request(request, { method: 'POST' }), '0.1.0', name)).status,
    ).toBe(405);
  } finally {
    if (previous === undefined) delete process.env.SPACE_CLI_DOWNLOAD_DIR;
    else process.env.SPACE_CLI_DOWNLOAD_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
