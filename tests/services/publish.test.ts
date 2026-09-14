import { cliTestVault } from './cli-test-vault';
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, NativeVault, type Vault } from '../../packages/identity/src/accounts';
import { publishProject } from '../../packages/publish/src';
import { Journal } from '../../packages/publish/src/journal';
import { checkPublication } from '../../apps/cli/src/publish-check';
import { sourceGit, sourceUrls } from '../../packages/grasp/src/client';
import { sha256, validateRelease } from '../../packages/protocol/src';
import { createBlossom } from '../../services/blossom/server';
import { buildRelay } from '../../scripts/relay';
import { buildGrasp, graspBinary } from '../../scripts/grasp-build';
import { graspEnvironment } from '../../scripts/grasp';
import { verifyEvent, type Filter, type NostrEvent } from 'nostr-tools';

// This independent reader uses the wire protocol directly, without our publishing or catalog adapters.
async function readRelay(url: string, filter: Filter): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url),
      events: NostrEvent[] = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Independent relay query timed out'));
    }, 8000);
    socket.onopen = () => socket.send(JSON.stringify(['REQ', 'independent', filter]));
    socket.onmessage = ({ data }) => {
      const [type, id, event] = JSON.parse(String(data));
      if (id !== 'independent') return;
      if (type === 'EVENT') {
        if (verifyEvent(event)) events.push(event);
      }
      if (type === 'EOSE') {
        clearTimeout(timer);
        socket.close();
        resolve(events);
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error('Independent relay query failed'));
    };
  });
}
async function stack() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-publish-services-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let blossom: Awaited<ReturnType<typeof createBlossom>> | undefined;
  async function start(binary: string, data: string, env: Record<string, string>, pattern: RegExp) {
    await mkdir(data, { recursive: true });
    const child = Bun.spawn([binary], {
      cwd: data,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const reader = child.stdout.getReader();
    let output = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) throw new Error(`Service did not start: ${output}`);
        output += new TextDecoder().decode(part.value);
        const port = output.match(pattern)?.[1];
        if (port) return `http://127.0.0.1:${port}`;
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
      void (async () => {
        for await (const _ of child.stdout) {
          /* drain */
        }
      })();
    }
  }
  async function close() {
    await blossom?.close(true);
    for (const child of children) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      await child.exited;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await buildGrasp();
    const relayBinary = join(directory, 'relay');
    await buildRelay(relayBinary);
    const data = join(directory, 'grasp');
    const grasp = await start(
      graspBinary,
      data,
      {
        ...graspEnvironment({
          directory: data,
          origin: 'http://127.0.0.1:1',
          local: true,
          instance: 'publish-test',
          bind: '127.0.0.1:0',
        }),
        NGIT_DOMAIN: '',
      },
      /Starting HTTP server on 127\.0\.0\.1:(\d+)/,
    );
    const relay = await start(
      relayBinary,
      join(directory, 'relay-state'),
      {
        SPACE_SERVICE_BIND: '127.0.0.1:0',
        SPACE_SERVICE_DATA: join(directory, 'relay-state'),
        SPACE_SERVICE_URL: 'http://127.0.0.1/relay',
        SPACE_SERVICE_INSTANCE: 'publish-test',
      },
      /listening on http:\/\/127\.0\.0\.1:(\d+)/,
    );
    blossom = await createBlossom({
      directory: join(directory, 'blobs'),
      origin: 'http://127.0.0.1:19348',
      local: true,
      port: 0,
      instance: 'publish-test',
      build: 'test',
    });
    return {
      directory,
      targets: {
        relay: `${relay.replace('http:', 'ws:')}/relay`,
        grasp,
        blossom: `http://127.0.0.1:${blossom.server.port}`,
        // No ambient dev website may affect this storage/publication-only test.
        site: 'http://127.0.0.1:1',
        mirrors: [],
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
test('publisher runs its sandbox check, survives interruption, retains Git release refs and exposes standard relay/Blossom bytes', async () => {
  const services = await stack();
  const values = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => values.get(id) ?? null,
    set: async (id, value) => {
      values.set(id, value);
    },
    delete: async (id) => {
      values.delete(id);
    },
  };
  try {
    const accounts = new Accounts('local', join(services.directory, 'accounts'), vault);
    const creator = await accounts.create();
    const create = Bun.spawn(
      [
        process.execPath,
        new URL('../../apps/cli/src/index.ts', import.meta.url).pathname,
        'new',
        'creation',
        '--template',
        'soft-orbit',
        '--identity',
        'later',
      ],
      { cwd: services.directory, stdout: 'pipe', stderr: 'pipe' },
    );
    const [created, output] = await Promise.all([
      create.exited,
      new Response(create.stderr).text(),
    ]);
    expect(created, output).toBe(0);
    const project = join(services.directory, 'creation');
    const options = {
      directory: project,
      network: 'local' as const,
      accounts,
      targets: services.targets,
      check: checkPublication,
    };
    let interrupted = false;
    await expect(
      publishProject({
        ...options,
        dependencies: {
          checkpoint: async (job) => {
            if (!interrupted && job.receipts.snapshot) {
              interrupted = true;
              throw new Error('Process interrupted after snapshot');
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    const journal = new Journal(project, 'local');
    const first = await journal.load((await journal.index()).active!);
    expect(first.check.browser).not.toBe('test');
    const resumed = await publishProject({ ...options, resume: true });
    expect(resumed).toMatchObject({
      status: 'announced_pending_index',
      snapshotId: first.snapshot!.id,
      currentId: first.current!.id,
    });
    const events = await readRelay(services.targets.relay, {
      kinds: [35129, 5129],
      authors: [creator.pubkey],
    });
    expect(events).toHaveLength(2);
    const release = await validateRelease(
      events.find((e) => e.kind === 35129),
      events.find((e) => e.kind === 5129),
    );
    const bytes = await (
      await fetch(`${services.targets.blossom}/${release.artifactHash}`)
    ).bytes();
    expect(await sha256(bytes)).toBe(release.artifactHash);
    const archive = await (await fetch(`${services.targets.blossom}/${first.archiveHash}`)).bytes();
    expect(await sha256(archive)).toBe(first.archiveHash);
    await Bun.write(join(services.directory, 'independent.tar'), archive);
    const unpack = join(services.directory, 'unpacked');
    await mkdir(unpack);
    const tar = Bun.spawn(
      ['tar', '-xf', join(services.directory, 'independent.tar'), '-C', unpack],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await tar.exited).toBe(0);
    expect(await Bun.file(join(unpack, 'index.html')).bytes()).toEqual(bytes);
    const source = sourceUrls(services.targets.grasp, creator.pubkey, first.plan.identifier, true);
    await sourceGit(services.directory, ['clone', source.clone, 'independent-clone']);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `refs/tags/release-${first.id.slice(0, 16)}`,
      ]),
    ).toBe(first.commit);
    const config = await Bun.file(join(project, 'napplet.json')).json();
    await Bun.write(
      join(project, 'napplet.json'),
      JSON.stringify({ ...config, title: 'Second release' }),
    );
    await publishProject(options);
    const second = await journal.load((await journal.index()).latest!);
    await sourceGit(join(services.directory, 'independent-clone'), ['fetch', '--tags', 'origin']);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), ['rev-parse', 'origin/main']),
    ).toBe(second.commit);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `${second.commit}^`,
      ]),
    ).toBe(first.commit);
    expect(
      await sourceGit(join(services.directory, 'independent-clone'), [
        'rev-parse',
        `refs/tags/release-${first.id.slice(0, 16)}`,
      ]),
    ).toBe(first.commit);
    expect(
      await readRelay(services.targets.relay, { kinds: [5129], authors: [creator.pubkey] }),
    ).toHaveLength(2);
    expect(await publishProject(options)).toMatchObject({
      unchanged: true,
      currentId: second.current!.id,
    });
  } finally {
    await services.close();
  }
}, 120000);

test.skipIf(process.env.SPACE_TEST_NATIVE_KEYSTORE !== '1')(
  'actual CLI creates a temporary native identity, publishes to local services, and repeats without a new release',
  async () => {
    const services = await stack();
    const accountHome = join(services.directory, 'account-home');
    const accounts = new Accounts(
      'local',
      join(accountHome, 'accounts/local'),
      cliTestVault('space.napplet.creator.local'),
    );
    const cli = process.env.SPACE_TEST_CLI
      ? [process.env.SPACE_TEST_CLI]
      : [process.execPath, new URL('../../apps/cli/src/index.ts', import.meta.url).pathname];
    const run = async (args: string[]) => {
      const child = Bun.spawn([...cli, ...args, '--network', 'local', '--json'], {
        cwd: services.directory,
        env: {
          PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
          SPACE_ACCOUNT_HOME: accountHome,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe('');
        expect(code, stdout).toBe(0);
        return JSON.parse(stdout);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await run(['account', 'create']);
      const created = await run(['new', 'cli-creation', '--template', 'soft-orbit']);
      const flags = [
        '--project',
        created.directory,
        '--relay',
        services.targets.relay,
        '--blossom',
        services.targets.blossom,
        '--grasp',
        services.targets.grasp,
        '--site',
        services.targets.site,
      ];
      expect((await run(['publish', ...flags, '--dry-run'])).status).toBe('dry_run');
      const first = await run(['publish', ...flags]);
      expect(first.status).toBe('announced_pending_index');
      expect((await run(['publish', ...flags])).currentId).toBe(first.currentId);
      expect((await run(['status', '--project', created.directory])).currentId).toBe(
        first.currentId,
      );
      expect(
        await readRelay(services.targets.relay, {
          kinds: [5129],
          authors: [created.account.pubkey],
        }),
      ).toHaveLength(1);
      // Kill a real process after Git publication, then resume with the shipped CLI.
      const config = await Bun.file(join(created.directory, 'napplet.json')).json();
      await Bun.write(
        join(created.directory, 'napplet.json'),
        JSON.stringify({ ...config, title: 'After process termination' }),
      );
      const worker = join(services.directory, 'crash-worker.ts');
      await Bun.write(
        worker,
        [
          `import { publishProject } from ${JSON.stringify(new URL('../../packages/publish/src/index.ts', import.meta.url).pathname)};`,
          `import { checkPublication } from ${JSON.stringify(new URL('../../apps/cli/src/publish-check.ts', import.meta.url).pathname)};`,
          `await publishProject({ directory: process.argv[2], network: 'local', targets: JSON.parse(process.argv[3]), check: checkPublication, dependencies: { checkpoint: async (job) => { if (job.receipts.source) { console.log('checkpoint'); await new Promise(() => {}); } } } });`,
        ].join('\n'),
      );
      const crashing = Bun.spawn(
        [
          process.env.SPACE_TEST_CLI || process.execPath,
          worker,
          created.directory,
          JSON.stringify(services.targets),
        ],
        {
          cwd: services.directory,
          env: {
            BUN_BE_BUN: process.env.SPACE_TEST_CLI ? '1' : undefined,
            PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
            SPACE_ACCOUNT_HOME: accountHome,
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const deadline = setTimeout(() => crashing.kill('SIGKILL'), 30000);
      const reader = crashing.stdout.getReader();
      try {
        const output = await reader.read();
        if (output.done) throw new Error(await new Response(crashing.stderr).text());
        expect(new TextDecoder().decode(output.value)).toContain('checkpoint');
        const competing = Bun.spawn(
          [
            ...cli,
            'publish',
            '--project',
            created.directory,
            '--network',
            'local',
            '--resume',
            '--json',
          ],
          {
            cwd: services.directory,
            env: {
              PATH: process.env.SPACE_TEST_CLI ? '/usr/bin:/bin' : process.env.PATH,
              SPACE_ACCOUNT_HOME: accountHome,
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [competingCode, competingOutput] = await Promise.all([
          competing.exited,
          new Response(competing.stdout).text(),
        ]);
        expect(competingCode).toBe(1);
        expect(JSON.parse(competingOutput).error.code).toBe('PUBLISH_BUSY');
        crashing.kill('SIGKILL');
        await crashing.exited;
      } finally {
        clearTimeout(deadline);
        reader.releaseLock();
        if (crashing.exitCode === null) {
          crashing.kill('SIGKILL');
          await crashing.exited;
        }
      }
      const pending = await run(['status', '--project', created.directory]);
      expect(pending.status).toBe('prepared');
      const resumed = await run(['publish', '--project', created.directory, '--resume']);
      expect(resumed).toMatchObject({
        status: 'announced_pending_index',
        jobId: pending.jobId,
        currentId: pending.currentId,
        snapshotId: pending.snapshotId,
      });
    } finally {
      for (const account of await accounts.list()) {
        await accounts.vault.delete(account.id);
        expect(await accounts.vault.get(account.id)).toBeNull();
      }
      await services.close();
    }
  },
  120000,
);
