import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Exercise the shipped command in its own process. Besides checking the real
// entrypoint, this avoids Bun 1.3.11 build/read failures observed after unrelated
// filesystem/network tests in the same VM.
async function scaffold(parent: string, name: string, template: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      new URL('./index.ts', import.meta.url).pathname,
      'new',
      name,
      '--template',
      template,
      '--identity',
      'later',
    ],
    {
      cwd: parent,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr || stdout);
  return join(parent, name);
}
const root = await mkdtemp(join(tmpdir(), 'space-cli-test-'));
afterAll(() => rm(root, { recursive: true, force: true }));
test('scaffolds a standalone Git project with shared restricted preview', async () => {
  const path = await scaffold(root, 'little-orbit', 'soft-orbit');
  expect(await Bun.file(join(path, 'index.html')).text()).toContain('<canvas');
  expect((await Bun.file(join(path, 'napplet.json')).json()).topics).toEqual([
    'visual',
    'generative',
    'animation',
  ]);
  expect(await Bun.file(join(path, 'AGENTS.md')).text()).toContain('No CDN');
  expect(await Bun.file(join(path, 'dev.ts')).exists()).toBe(false);
  expect((await Bun.file(join(path, 'package.json')).json()).scripts.dev).toBe('napplet-space dev');
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
  const process = Bun.spawn(
    [
      'bun',
      new URL('./index.ts', import.meta.url).pathname,
      'dev',
      '--no-open',
      '--port',
      String(port),
    ],
    {
      cwd: path,
      env: { PATH: String(Bun.env.PATH ?? ''), PORT: String(port) },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  );
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
    expect(shell).toContain('src="/runtime.js"');
    expect(shell).not.toContain('src="/preview"');
    const info = await (await fetch(`http://127.0.0.1:${port}/revision`)).json();
    const response = await fetch(`http://127.0.0.1:${port}/api/artifacts/${info.artifactHash}`);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(await response.text()).toContain('<canvas');
    const resources = (
      manifest: string,
      origin = `http://127.0.0.1:${port}`,
      url = 'data:text/plain,hello',
    ) =>
      fetch(`http://127.0.0.1:${port}/api/resources`, {
        method: 'POST',
        headers: { Origin: origin, 'X-Space-Host': '1' },
        body: JSON.stringify({ manifest, url }),
      });
    expect(await (await resources(info.id)).text()).toBe('hello');
    expect((await resources('0'.repeat(64))).status).toBe(404);
    expect((await resources(info.id, 'null')).status).toBe(403);
    expect(
      (await resources(info.id, `http://127.0.0.1:${port}`, 'https://127.0.0.1/private')).status,
    ).toBe(422);
    expect((await fetch(`http://127.0.0.1:${port}/napplet.json`)).status).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${port}/revision`, { headers: { Host: 'attacker.example' } }))
        .status,
    ).toBe(403);
  } finally {
    process.kill();
    await process.exited;
  }
});
