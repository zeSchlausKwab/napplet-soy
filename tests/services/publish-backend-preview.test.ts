import { expect, test } from 'bun:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initModule, localModule } from '../../apps/cli/src/dynamic-backend';
import { encodeAddress } from '../../packages/protocol/src';
import { developmentAuthor } from '../../apps/cli/src/backend';
import { materializePreview } from '../../apps/cli/src/frozen-preview';

async function cli(directory: string, ...args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      new URL('../../apps/cli/src/index.ts', import.meta.url).pathname,
      ...args,
      '--project',
      directory,
      '--network',
      'local',
      '--json',
    ],
    {
      env: { ...process.env, SPACE_ACCOUNT_HOME: join(directory, '.napplet-space/test-accounts') },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + err).toBe(0);
    return JSON.parse(out);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
    await child.exited;
  }
}

test('frozen checks and multiplayer retain declared backend source in an isolated project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-backend-frozen-test-'));
  try {
    await initModule(root);
    const config = {
      schema: 'space-local-project/v1',
      name: 'Backend fixture',
      license: 'MIT',
      previewId: crypto.randomUUID(),
      identifier: 'test-world',
      entry: 'index.html',
      preview: { delayMs: 250, recording: { durationMs: 2000, startMs: 0, actions: [] } },
      backend: { boards: [], modules: ['backend/backend.json'] },
    };
    const module = {
      napplet: encodeAddress({ kind: 35129, pubkey: developmentAuthor, identifier: 'test-world' }),
      name: 'main',
    };
    const files = {
      LICENSE: 'MIT',
      '.gitignore': '.napplet-space/\n',
      'napplet.json': JSON.stringify(config),
      'index.html': `<!doctype html><button id="create">Create</button><output id="result"></output><script>
        const call = async (tool,args) => window.napplet.cvm.registry.call('soy.backends.v1',tool,args);
        document.querySelector('#create').onclick = async()=>{
          const module = ${JSON.stringify(module)};
          const d = (await call('soy_backend_describe',{module})).structuredContent;
          const r = await call('soy_backend_invoke',{target:{module,release:d.active},operation:'create',requestId:crypto.randomUUID(),expiresAt:Math.floor(Date.now()/1000)+240,input:{}});
          document.querySelector('#result').textContent = r.isError ? r.structuredContent.error.code : String(r.structuredContent.result.value);
        };
      </script>`,
      ...(await localModule(root, 'backend/backend.json')).files,
    };
    for (const [path, text] of Object.entries(files)) await Bun.write(join(root, path), text);
    expect(
      await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'pipe', stderr: 'pipe' }).exited,
    ).toBe(0);
    expect((await cli(root, 'check')).profile).toBe('space-playback-4');
    await cli(root, 'screenshot');
    expect((await Bun.file(join(root, 'preview.png')).bytes()).length).toBeGreaterThan(100);
    await cli(root, 'record');
    expect((await Bun.file(join(root, 'preview.webm')).bytes()).length).toBeGreaterThan(100);
    await Bun.write(
      join(root, 'scenario.mjs'),
      `export default async ({players,check})=>{
      check('two independent players', players.length === 2);
    }`,
    );
    const report = await cli(root, 'multiplayer', 'scenario.mjs');
    expect(report).toMatchObject({ status: 'passed' });
    await Bun.write(
      join(root, 'identity.mjs'),
      `export default async ({players,check,connectIdentity,approveBackendAccount})=>{
      const [owner,guest] = players;
      await guest.frame.locator('#create').click();
      await guest.frame.getByText('ACCOUNT_REQUIRED',{exact:true}).waitFor();
      check('guest cannot create', await guest.frame.locator('#result').textContent() === 'ACCOUNT_REQUIRED');
      const {pubkey} = await connectIdentity(owner);
      check('test identity', /^[a-f0-9]{64}$/.test(pubkey));
      const denied = await owner.frame.evaluate(async()=>{try { await window.__soyliTestIdentity(); return false; } catch { return true; }});
      check('iframe cannot use test signer', denied);
      await owner.frame.locator('#create').click();
      await approveBackendAccount(owner, 'main');
      await owner.frame.getByText('0',{exact:true}).waitFor();
      check('real signed owner creates instance', await owner.frame.locator('#result').textContent() === '0');
    }`,
    );
    const signed = await cli(root, 'multiplayer', 'identity.mjs');
    expect(signed).toMatchObject({ status: 'passed' });
    expect(signed.checks).toHaveLength(4);
    expect(await Bun.file(join(root, '.napplet-space/backend/boards.sqlite')).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test('nested modules use frozen bytes, validate missing/traversing paths and exclude private state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-backend-copy-test-'));
  try {
    await initModule(root);
    const module = await localModule(root, 'backend/backend.json');
    const files = new Map<string, Uint8Array>();
    const put = (path: string, value: string) => files.set(path, new TextEncoder().encode(value));
    const paths = ['one/deep', 'two/deep'];
    put(
      'napplet.json',
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Snapshot',
        license: 'MIT',
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        backend: { boards: [], modules: paths.map((p) => `${p}/backend.json`) },
      }),
    );
    put('index.html', '<!doctype html><p>Snapshot</p>');
    for (const base of paths)
      for (const [path, text] of Object.entries(module.files))
        put(
          path.replace('backend/', base + '/'),
          path.endsWith('backend.json')
            ? JSON.stringify({
                ...JSON.parse(text),
                name: base.split('/')[0],
                entry: `${base}/handler.ts`,
                schemas: `${base}/schemas.json`,
              })
            : text,
        );
    put('.napplet-space/project.json', 'private binding');
    put('.napplet-space/backend/boards.sqlite', 'private state');
    await Bun.write(join(root, 'backend/handler.ts'), 'throw new Error("Changed live source");');
    const copy = join(root, 'frozen');
    await materializePreview(copy, files);
    expect(await Bun.file(join(copy, 'one/deep/handler.ts')).text()).toBe(
      module.files['backend/handler.ts'],
    );
    expect(await readdir(copy)).not.toContain('.napplet-space');
    files.delete('two/deep/schemas.json');
    await expect(materializePreview(join(root, 'missing'), files)).rejects.toThrow(
      'two/deep/schemas.json',
    );
    put(
      'two/deep/backend.json',
      JSON.stringify({
        ...JSON.parse(module.files['backend/backend.json']),
        entry: '../outside.ts',
      }),
    );
    await expect(materializePreview(join(root, 'unsafe'), files)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
