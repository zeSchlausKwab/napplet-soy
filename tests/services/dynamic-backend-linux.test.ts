import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { productionSandbox } from '../../packages/dynamic-backends/src/sandbox';
import { compileHandler, executeHandler } from '../../packages/dynamic-backends/src/runtime';
import { DynamicBackends } from '../../packages/dynamic-backends/src/service';
import { encodeAddress } from '../../packages/protocol/src';
import { workerExchange } from '../../packages/dynamic-backends/src/worker-process';
import { sourceGit } from '../../packages/grasp/src/client';
import { downloadPack } from '../../packages/dynamic-backends/src/source-http';
import { startLocalBackendRelay } from '../../packages/multiplayer/src/local-relay';
import { startBackend } from '../../packages/multiplayer/src/service';
import { CvmConnection } from '../../packages/multiplayer/src/client';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { authorizationTemplate, PROFILE } from '../../packages/dynamic-backends/src/contracts';

const enabled = process.env.SPACE_TEST_BACKEND_SANDBOX === '1';
const check = enabled ? test : test.skip;
check(
  'Linux production sandbox bounds hostile workers and reads a real offline Git pack',
  async () => {
    const sandbox = await productionSandbox(process.env.SPACE_DYNAMIC_BUNDLE_DIR!);
    const ctx = {
      actor: '',
      account: null,
      principal: '',
      owner: '',
      instance: 'x',
      release: '',
      operation: 'probe',
      requestId: '',
      now: 0,
    };
    console.log('sandbox: compiler');
    const code = await compileHandler(
      'export function handle(){return {fetch:typeof fetch, process:typeof process, host:typeof Bun}}',
      sandbox.workerCommand,
    );
    expect(
      await executeHandler(code, ctx, {}, () => null, { command: sandbox.workerCommand }),
    ).toEqual({ fetch: 'undefined', process: 'undefined', host: 'undefined' });
    console.log('sandbox: CPU interruption');
    await expect(
      executeHandler('export function handle(){while(true){}}', ctx, {}, () => null, {
        command: sandbox.workerCommand,
      }),
    ).rejects.toThrow();
    console.log('sandbox: memory exhaustion');
    await expect(
      executeHandler(
        'export function handle(){let x=[]; while(true){x.push(new Array(100000).fill(1));}}',
        ctx,
        {},
        () => null,
        { command: sandbox.workerCommand },
      ),
    ).rejects.toThrow();
    console.log('sandbox: recovery');
    expect(
      await executeHandler(code, ctx, {}, () => null, { command: sandbox.workerCommand }),
    ).toHaveProperty('host', 'undefined');
    const root = await mkdtemp(join(tmpdir(), 'soy-linux-source-'));
    try {
      await sourceGit(root, ['init']);
      const fixture =
        process.env.SPACE_BACKEND_FIXTURES ||
        resolve('packages/dynamic-backends/fixtures/minicraft');
      for (const name of ['backend.json', 'handler.ts', 'schemas.json'])
        await Bun.write(join(root, 'backend', name), Bun.file(join(fixture, name)));
      await sourceGit(root, ['add', '.']);
      await sourceGit(root, ['commit', '-m', 'Sandbox fixture']);
      const commit = await sourceGit(root, ['rev-parse', 'HEAD']);
      const child = Bun.spawn(['git', 'pack-objects', '--stdout', '--revs'], {
        cwd: root,
        stdin: new Blob([commit + '\n']),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const pack = Buffer.from(await new Response(child.stdout).arrayBuffer());
      expect(await child.exited).toBe(0);
      const source = {
        repository: `30617:${'a'.repeat(64)}:fixture`,
        cloneUrl: 'https://git.example/fixture.git',
        commit,
        manifest: 'backend/backend.json',
      };
      const files = (await workerExchange(
        sandbox.sourceCommand,
        { type: 'source', source, pack: pack.toString('base64') },
        { maximum: 1048576, timeoutMs: 30000 },
      )) as any;
      expect(files['backend/handler.ts']).toBe(await Bun.file(join(fixture, 'handler.ts')).text());
      await expect(
        workerExchange(
          sandbox.sourceCommand,
          { type: 'source', source, pack: Buffer.from('PACKbad').toString('base64') },
          { maximum: 1048576, timeoutMs: 30000 },
        ),
      ).rejects.toThrow();
      // Probe the guarded Node HTTPS path on the actual baseline runtime without downloading large source.
      if (Bun.version === '1.3.8')
        await expect(
          downloadPack(new URL('https://127.0.0.1/forbidden.git'), commit, false),
        ).rejects.toThrow('public HTTPS');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

check(
  'production worker worlds and signed release pins survive the operator backup/restore path',
  async () => {
    const sandbox = await productionSandbox(process.env.SPACE_DYNAMIC_BUNDLE_DIR!);
    const root = await mkdtemp(join(tmpdir(), 'soy-linux-restore-'));
    const key = generateSecretKey(),
      account = generateSecretKey(),
      provider = getPublicKey(key),
      actor = getPublicKey(generateSecretKey());
    const module = {
      napplet: encodeAddress({
        kind: 35129,
        pubkey: getPublicKey(account),
        identifier: 'restore-test',
      }),
      name: 'worlds',
    };
    const file = join(root, 'state/cvm/boards.sqlite.dynamic.sqlite');
    const options = {
      provider,
      sign: async (event: any) => finalizeEvent(event, key),
      source: async () => {
        throw new Error('Not used');
      },
      workerCommand: sandbox.workerCommand,
      isolation: sandbox.isolation,
    };
    let service: DynamicBackends | undefined;
    try {
      for (const name of ['relay', 'blossom', 'grasp', 'index', 'moderation', 'community', 'cvm'])
        await mkdir(join(root, 'state', name), { recursive: true });
      await mkdir(join(root, 'shared'));
      await Bun.write(join(root, 'shared/server.env'), '# test configuration\n');
      service = new DynamicBackends({ ...options, path: file });
      const files: Record<string, string> = {};
      for (const name of ['backend.json', 'handler.ts', 'schemas.json'])
        files['backend/' + name] = await readFile(
          join(
            process.env.SPACE_BACKEND_FIXTURES ||
              resolve('packages/dynamic-backends/fixtures/minicraft'),
            name,
          ),
          'utf8',
        );
      const { release } = await service.provisionPreview(module, {
        source: {
          mode: 'local-preview',
          manifest: 'backend/backend.json',
          workspaceDigest: 'test',
        },
        files,
      });
      const challenge = service.sessionChallenge(actor, { module, account: getPublicKey(account) });
      const session = service.sessionBind(actor, {
        challenge: challenge.challenge,
        authorization: finalizeEvent(challenge.proof, account),
      }).session;
      const base = {
        operation: 'createWorld',
        requestId: crypto.randomUUID(),
        expiresAt: Math.floor(Date.now() / 1000) + 240,
        session,
      };
      const created = await service.invoke(actor, {
        ...base,
        target: { module, release },
        input: {
          name: 'Saved world',
          seed: 123,
          mode: 'creative',
          visibility: 'public',
          building: 'everyone',
          guestsMayBuild: false,
        },
      });
      await service.close();
      service = undefined;
      const script = process.env.SPACE_TEST_BACKUP_SCRIPT || resolve('scripts/backup-data.py');
      const run = async (...args: string[]) => {
        const p = Bun.spawn(['python3', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
        const err = await new Response(p.stderr).text();
        expect(await p.exited, err).toBe(0);
      };
      await run(
        'snapshot',
        '--state',
        join(root, 'state'),
        '--shared',
        join(root, 'shared'),
        '--destination',
        join(root, 'snapshot'),
        '--release',
        'sandbox-test',
      );
      await run(
        'pack',
        '--snapshot',
        join(root, 'snapshot'),
        '--archive',
        join(root, 'backup.tar.gz'),
      );
      await run(
        'restore',
        '--archive',
        join(root, 'backup.tar.gz'),
        '--destination',
        join(root, 'restored'),
      );
      service = new DynamicBackends({
        ...options,
        path: join(root, 'restored/state/cvm/boards.sqlite.dynamic.sqlite'),
      });
      expect(service.describe(actor, { module }).release).toBe(release);
      const reopened = await service.invoke(actor, {
        ...base,
        operation: 'readWorld',
        requestId: crypto.randomUUID(),
        target: { module, release, instance: created.instance },
        input: {},
      });
      expect((reopened.result as any).name).toBe('Saved world');
      // The same committed create intent remains idempotent across a restore.
      expect(
        (
          await service.invoke(actor, {
            ...base,
            target: { module, release },
            input: {
              name: 'Saved world',
              seed: 123,
              mode: 'creative',
              visibility: 'public',
              building: 'everyone',
              guestsMayBuild: false,
            },
          })
        ).instance,
      ).toBe(created.instance);
    } finally {
      await service?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

check(
  'production CVM advertises its isolated profile and rejects unadmitted signed builds over encrypted transport',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'soy-linux-provider-'));
    const relay = startLocalBackendRelay();
    const author = generateSecretKey(),
      transport = new PrivateKeySigner();
    let service: Awaited<ReturnType<typeof startBackend>> | undefined;
    let client: CvmConnection | undefined;
    try {
      service = await startBackend({
        relays: [relay.url],
        keyPath: join(root, 'identity'),
        dataPath: join(root, 'boards.sqlite'),
        dynamic: {
          local: false,
          bundleDirectory: process.env.SPACE_DYNAMIC_BUNDLE_DIR!,
          creators: [getPublicKey(generateSecretKey())],
          sourceOrigins: ['https://git.example'],
        },
      });
      client = new CvmConnection(service.provider, transport);
      const health = await client.tool('soy_session');
      expect(health.families).toContain('soy.backends.v1');
      expect(health.dynamic).toMatchObject({
        isolation: { profile: 'soy-linux-bwrap-v1' },
        admission: 'allowlist',
      });
      const module = {
        napplet: encodeAddress({
          kind: 35129,
          pubkey: getPublicKey(author),
          identifier: 'not-admitted',
        }),
        name: 'worlds',
      };
      const args = {
        module,
        source: {
          repository: `30617:${getPublicKey(author)}:fixture`,
          cloneUrl: `https://git.example/${getPublicKey(author)}/fixture.git`,
          commit: 'a'.repeat(40),
          manifest: 'backend/backend.json',
        },
        buildProfile: PROFILE,
        requestId: crypto.randomUUID(),
      };
      const result = await client.request('tools/call', {
        name: 'soy_backend_build',
        arguments: {
          ...args,
          authorization: finalizeEvent(
            authorizationTemplate(
              service.provider.pubkey,
              await transport.getPublicKey(),
              'build',
              args,
            ),
            author,
          ),
        },
      });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as any).error).toMatchObject({ code: 'FORBIDDEN' });
      expect((result.structuredContent as any).error.message).toContain('admitted');
      expect((await client.tool('soy_session')).dynamic).toMatchObject({ executions: 0 });
    } finally {
      await client?.close();
      await service?.close();
      relay.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
