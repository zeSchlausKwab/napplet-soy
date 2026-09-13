import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { RelayPool } from 'applesauce-relay';
import { lastValueFrom, toArray } from 'rxjs';
import { blossomBuildID, seedLocalBlossom } from '../../scripts/blossom';
import { buildRelay } from '../../scripts/relay';
import { uploadBlob } from '../../packages/blossom/src/client';
import { aggregateHash, sha256 } from '../../packages/protocol/src';
import { validateManifest } from '../../packages/protocol/src/manifest';

let directory: string;
let bundle: string;
let relayBinary: string;
let blossom: Awaited<ReturnType<typeof start>> | undefined;
let relay: Awaited<ReturnType<typeof start>> | undefined;
type Child = ReturnType<typeof Bun.spawn>;
async function start(args: string[], env: Record<string, string>) {
  const child = Bun.spawn(args, {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  let output = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error(`Service failed to start: ${output}`);
      output += new TextDecoder().decode(next.value);
      const address = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (address) return { child, origin: address };
    }
  } catch (error) {
    child.kill('SIGKILL');
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
async function stop(child?: Child, force = false) {
  if (!child || child.exitCode !== null) return;
  child.kill(force ? 'SIGKILL' : 'SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 14000);
  try {
    const exit = await child.exited;
    if (!force) expect(exit).toBe(0);
  } finally {
    clearTimeout(timeout);
  }
}
function startBlossom() {
  return start([process.execPath, bundle], {
    SPACE_BLOSSOM_PORT: '0',
    SPACE_BLOSSOM_DATA: join(directory, 'blobs'),
    SPACE_BLOSSOM_ORIGIN: 'http://127.0.0.1:19348',
    SPACE_BLOSSOM_LOCAL: '1',
    SPACE_BLOSSOM_INSTANCE: 'process-test',
  });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-blossom-process-'));
  bundle = join(directory, 'blossom.js');
  relayBinary = join(directory, 'relay');
  // Exercise the actual CLI build and standalone artifact, outside the test runner's module graph.
  const build = Bun.spawn([process.execPath, 'scripts/blossom.ts', 'build', bundle], {
    stdout: 'ignore',
    stderr: 'inherit',
  });
  expect(await build.exited).toBe(0);
  blossom = await startBlossom();
  await buildRelay(relayBinary);
  relay = await start([relayBinary], {
    SPACE_SERVICE_DATA: join(directory, 'relay-data'),
    SPACE_SERVICE_BIND: '127.0.0.1:0',
    SPACE_SERVICE_URL: 'https://relay.example/relay',
    SPACE_SERVICE_INSTANCE: 'process-test',
  });
}, 120000);
afterAll(async () => {
  await stop(blossom?.child);
  await stop(relay?.child);
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('bundled service seeds without rewrites and repairs a missing fixture blob', async () => {
  const health = await fetch(`${blossom!.origin}/health`).then((r) => r.json());
  expect(health).toMatchObject({
    build: await blossomBuildID(),
    instance: 'process-test',
    service: 'blossom',
  });
  expect(await seedLocalBlossom(blossom!.origin)).toMatchObject({ blobs: 6, uploaded: 6 });
  const catalog = await Bun.file('packages/backend/data/catalog.json').json();
  const path = join(directory, 'blobs/blobs', catalog[0].artifactHash);
  const modified = (await stat(path)).mtimeMs;
  expect(await seedLocalBlossom(blossom!.origin)).toMatchObject({ blobs: 6, uploaded: 0 });
  expect((await stat(path)).mtimeMs).toBe(modified);
  await unlink(path);
  expect(await seedLocalBlossom(blossom!.origin)).toMatchObject({ blobs: 6, uploaded: 1 });
});
test('acknowledged blobs and owner claims survive SIGTERM and SIGKILL', async () => {
  for (const force of [false, true]) {
    await stop(blossom!.child, force);
    blossom = await startBlossom();
    expect(await seedLocalBlossom(blossom.origin)).toMatchObject({ blobs: 6, uploaded: 0 });
  }
}, 35000);
test('Applesauce discovers a standard manifest and its server hint resolves verified bytes', async () => {
  const signer = new PrivateKeySigner();
  const bytes = new TextEncoder().encode(
    '<!doctype html><title>Relay to Blossom</title><p>portable bytes</p>',
  );
  const uploaded = await uploadBlob({
    origin: blossom!.origin,
    bytes,
    type: 'text/html',
    signer,
    local: true,
  });
  const hash = uploaded.descriptor.sha256;
  const event = await signer.signEvent({
    kind: 35129,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['d', 'round-trip'],
      ['title', 'Relay to Blossom'],
      ['path', '/index.html', hash],
      ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
      ['server', blossom!.origin],
    ],
  });
  const pool = new RelayPool();
  try {
    const connection = pool.relay(`${relay!.origin.replace('http:', 'ws:')}/relay`);
    expect(
      (await connection.publish(event, { timeout: 5000, retries: false, reconnect: false })).ok,
    ).toBe(true);
    const events = await lastValueFrom(
      connection
        .request(
          { kinds: [35129], authors: [event.pubkey], '#d': ['round-trip'] },
          { timeout: 5000, reconnect: false, waitForAuth: false },
        )
        .pipe(toArray()),
    );
    expect(events).toHaveLength(1);
    const manifest = await validateManifest(events[0]);
    expect(manifest.servers).toEqual([blossom!.origin]);
    // Explicit local test destination. The production public fetcher still rejects private IPs.
    const response = await fetch(`${manifest.servers[0]}/${manifest.artifactHash}`, {
      redirect: 'error',
    });
    expect(response.ok).toBe(true);
    const downloaded = await response.bytes();
    expect(await sha256(downloaded)).toBe(manifest.artifactHash);
    expect(downloaded).toEqual(bytes);
  } finally {
    pool.close();
  }
}, 15000);
