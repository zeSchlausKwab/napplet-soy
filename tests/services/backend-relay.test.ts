import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from '@contextvm/sdk/signer';
import { buildRelay } from '../../scripts/relay';
import { startBackend } from '../../packages/multiplayer/src/service';
import { CvmConnection } from '../../packages/multiplayer/src/client';

test('public CVM client reaches the same Khatru relay through its private service ingress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-cvm-relay-'));
  let relay: Bun.Subprocess | undefined;
  let service: Awaited<ReturnType<typeof startBackend>> | undefined;
  let client: CvmConnection | undefined;
  try {
    const binary = join(root, 'relay');
    await buildRelay(binary);
    const reserve = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const servicePort = reserve.port!;
    reserve.stop(true);
    relay = Bun.spawn([binary], {
      env: {
        PATH: process.env.PATH,
        SPACE_SERVICE_BIND: '127.0.0.1:0',
        SPACE_SERVICE_CVM_BIND: `127.0.0.1:${servicePort}`,
        SPACE_SERVICE_DATA: join(root, 'data'),
        SPACE_SERVICE_URL: 'http://127.0.0.1/relay',
        SPACE_SERVICE_INSTANCE: 'cvm-test',
      },
      stdout: 'pipe',
      stderr: Bun.file(join(root, 'relay.log')),
    });
    const reader = (relay.stdout as ReadableStream<Uint8Array>).getReader();
    let output = '',
      port: string | undefined;
    const deadline = setTimeout(() => relay!.kill(), 15000);
    try {
      while (!port) {
        const next = await reader.read();
        if (next.done) throw new Error(`Relay failed: ${output}`);
        output += new TextDecoder().decode(next.value);
        port = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      }
    } finally {
      clearTimeout(deadline);
      reader.releaseLock();
    }
    const publicRelay = `ws://127.0.0.1:${port}`;
    service = await startBackend({
      relays: [`ws://127.0.0.1:${servicePort}`],
      publicRelays: [publicRelay],
      keyPath: join(root, 'identity'),
      dataPath: join(root, 'boards.sqlite'),
      announce: true,
    });
    client = new CvmConnection(
      { ...service.provider, relays: [publicRelay] },
      new PrivateKeySigner(),
    );
    const result = await client.tool('soy_session');
    expect(result.version).toBe(1);
    expect(result.families).toContain('soy.matchmaking.v1');
    const catalog = await client.request('tools/list');
    expect(
      (catalog.tools as any[]).find((tool) => tool.name === 'soy_match_join')._meta[
        'io.contextvm/common-schema'
      ].schemaHash,
    ).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await client?.close();
    await service?.close();
    relay?.kill();
    if (relay) await relay.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
