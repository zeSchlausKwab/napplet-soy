import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayPool } from 'applesauce-relay';
import { lastValueFrom, toArray } from 'rxjs';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { prepareSource, publishSource, sourceGit } from '../../packages/grasp/src/client';
import { uploadBlob } from '../../packages/blossom/src/client';
import { aggregateHash, sha256 } from '../../packages/protocol/src';
import { validateManifest } from '../../packages/protocol/src/manifest';
import { createBlossom } from '../../services/blossom/server';
import { buildRelay } from '../../scripts/relay';
import { buildGrasp, graspBinary } from '../../scripts/grasp-build';
import { graspEnvironment } from '../../scripts/grasp';

test('one reopened creator identity authorizes Git, Blossom and relay-discoverable NIP-5D bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-creator-services-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const pool = new RelayPool();
  let blossom: Awaited<ReturnType<typeof createBlossom>> | undefined;
  let signer: Awaited<ReturnType<Accounts['signer']>> | undefined;
  async function start(binary: string, data: string, env: Record<string, string>, pattern: RegExp) {
    await mkdir(data, { recursive: true });
    const child = Bun.spawn([binary], {
      cwd: data,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(child);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    const reader = child.stdout.getReader();
    let output = '';
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) throw new Error(`Service did not start: ${output}`);
        output += new TextDecoder().decode(next.value);
        const port = output.match(pattern)?.[1];
        if (port) return `http://127.0.0.1:${port}`;
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
      void (async () => {
        for await (const _ of child.stdout) {
          /* drain service logs */
        }
      })();
    }
  }
  try {
    await buildGrasp();
    const relayBinary = join(directory, 'relay');
    await buildRelay(relayBinary);
    const graspData = join(directory, 'grasp');
    const grasp = await start(
      graspBinary,
      graspData,
      {
        ...graspEnvironment({
          directory: graspData,
          origin: 'http://127.0.0.1:1',
          local: true,
          instance: 'creator-test',
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
        SPACE_SERVICE_INSTANCE: 'creator-test',
      },
      /listening on http:\/\/127\.0\.0\.1:(\d+)/,
    );
    blossom = await createBlossom({
      directory: join(directory, 'blobs'),
      origin: 'http://127.0.0.1:19348',
      local: true,
      port: 0,
      instance: 'creator-test',
      build: 'test',
    });
    const blobOrigin = `http://127.0.0.1:${blossom.server.port}`;
    const credentials = new Map<string, string>();
    const vault: Vault = {
      get: async (id) => credentials.get(id) ?? null,
      set: async (id, value) => {
        credentials.set(id, value);
      },
      delete: async (id) => {
        credentials.delete(id);
      },
    };
    const accounts = new Accounts('local', join(directory, 'accounts'), vault);
    const creator = await accounts.create();
    signer = await new Accounts('local', accounts.directory, vault).signer();
    const repo = join(directory, 'source');
    await mkdir(repo);
    const bytes = new TextEncoder().encode(
      '<!doctype html><title>Creator round trip</title><p>One creator, three services.</p>',
    );
    await Bun.write(join(repo, 'index.html'), bytes);
    await sourceGit(repo, ['init', '--initial-branch=main']);
    await sourceGit(repo, ['add', 'index.html']);
    await sourceGit(repo, ['commit', '-m', 'Creator source']);
    const publication = await prepareSource({
      directory: repo,
      identifier: 'creator-test',
      title: 'Creator round trip',
      origin: grasp,
      local: true,
      signer,
    });
    const source = await publishSource({
      directory: repo,
      origin: grasp,
      local: true,
      publication,
    });
    expect(source.state.pubkey).toBe(creator.pubkey);
    await sourceGit(directory, ['clone', source.clone, 'independent-clone']);
    expect(await Bun.file(join(directory, 'independent-clone/index.html')).bytes()).toEqual(bytes);
    const blob = await uploadBlob({
      origin: blobOrigin,
      bytes,
      type: 'text/html',
      signer,
      local: true,
    });
    const hash = await sha256(bytes);
    expect(blob.descriptor.sha256).toBe(hash);
    const manifest = await signer.signEvent({
      kind: 35129,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['d', 'creator-test'],
        ['title', 'Creator round trip'],
        ['path', '/index.html', hash],
        ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
        ['server', blobOrigin],
        ['source', source.portable],
      ],
    });
    const connection = pool.relay(`${relay.replace('http:', 'ws:')}/relay`);
    expect((await connection.publish(manifest, { timeout: 5000, retries: false })).ok).toBe(true);
    const discovered = await lastValueFrom(
      connection
        .request(
          { kinds: [35129], authors: [creator.pubkey], '#d': ['creator-test'] },
          { timeout: 5000, reconnect: false, waitForAuth: false },
        )
        .pipe(toArray()),
    );
    expect(discovered).toHaveLength(1);
    const playable = await validateManifest(discovered[0]);
    const downloaded = await fetch(`${playable.servers[0]}/${playable.artifactHash}`);
    expect(await sha256(await downloaded.bytes())).toBe(hash);
    expect(playable.identity?.pubkey).toBe(creator.pubkey);
  } finally {
    await signer?.close();
    pool.close();
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
}, 120000);
