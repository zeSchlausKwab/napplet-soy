import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from './scaffold';
const root = await mkdtemp(join(tmpdir(), 'space-cli-test-'));
afterAll(() => rm(root, { recursive: true, force: true }));
test('scaffolds a standalone Git project with shared restricted preview', async () => {
  const path = await scaffold(root, 'little-orbit', 'soft-orbit');
  expect(await Bun.file(join(path, 'index.html')).text()).toContain('<canvas');
  expect(await Bun.file(join(path, 'AGENTS.md')).text()).toContain('No CDN');
  expect(await Bun.file(join(path, '.napplet/runtime.js')).exists()).toBe(true);
  const process = Bun.spawn(['git', '-C', path, 'rev-parse', '--is-inside-work-tree'], {
    stdout: 'pipe',
  });
  expect(await new Response(process.stdout).text()).toBe('true\n');
  await process.exited;
  await writeFile(join(path, 'index.html'), 'precious existing work');
  await expect(scaffold(root, 'little-orbit', 'soft-orbit')).rejects.toThrow();
  expect(await Bun.file(join(path, 'index.html')).text()).toBe('precious existing work');
});
test('rejects path escape and unknown templates before writing', async () => {
  await expect(scaffold(root, '../escape', 'soft-orbit')).rejects.toThrow('folder name');
  await expect(scaffold(root, 'invalid-template', 'https://evil.example')).rejects.toThrow(
    'Unknown template',
  );
});

test('generated preview runs independently and enforces the shared runtime policy', async () => {
  const path = await scaffold(root, 'running-example', 'tiny-tennis');
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = reservation.port;
  reservation.stop(true);
  const process = Bun.spawn(['bun', 'dev.ts'], {
    cwd: path,
    env: { PATH: String(Bun.env.PATH ?? ''), PORT: String(port) },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/revision`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(50);
    }
    expect(ready).toBe(true);
    const shell = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(shell).toContain('sandbox="allow-scripts"');
    const response = await fetch(`http://127.0.0.1:${port}/preview`);
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(await response.text()).toContain('<canvas');
  } finally {
    process.kill();
    await process.exited;
  }
});
