import { test, expect } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { backendProject, syncBackend } from './backend';
import { startBackend } from '../../../packages/multiplayer/src/service';
import { startLocalBackendRelay } from '../../../packages/multiplayer/src/local-relay';
import type { Accounts, Account } from '../../../packages/identity/src/accounts';
import { encodeAddress } from '../../../packages/protocol/src';

test('creator sync registers boards over encrypted CVM and generated public context changes for a remix', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-backend-cli-'));
  const relay = startLocalBackendRelay(),
    key = generateSecretKey(),
    pubkey = getPublicKey(key);
  const service = await startBackend({
    relays: [relay.url],
    keyPath: join(directory, 'server-key'),
    dataPath: join(directory, 'boards.sqlite'),
  });
  const project = {
    schema: 'space-local-project/v1',
    name: 'test',
    entry: 'index.html',
    previewId: crypto.randomUUID(),
    identifier: 'original',
    license: 'MIT',
    creator: { pubkey, network: 'local' },
    publish: { relay: relay.url },
    backend: {
      provider: service.provider,
      boards: [{ board: 'main', title: 'Score', order: 'highest', minimum: 0, maximum: 99 }],
    },
  };
  const accounts: Pick<Accounts, 'current' | 'signer'> = {
    current: async () => ({ pubkey }) as Account,
    signer: async () => ({
      getPublicKey: async () => pubkey,
      signEvent: async (event) => finalizeEvent(event, key),
      close: async () => {},
    }),
  };
  try {
    await Bun.write(join(directory, 'napplet.json'), JSON.stringify(project));
    await backendProject(directory);
    const result = await syncBackend(directory, 'local', accounts);
    expect(result.boards).toBe(1);
    const address = encodeAddress({ kind: 35129, pubkey, identifier: 'original' });
    service.boards.submit('guest', { napplet: address, board: 'main', score: 10 });
    await syncBackend(directory, 'local', accounts);
    expect(service.boards.read('guest', { napplet: address, board: 'main' }).own).toMatchObject({
      score: 10,
    });
    project.identifier = 'remix';
    await Bun.write(join(directory, 'napplet.json'), JSON.stringify(project));
    await backendProject(directory);
    await syncBackend(directory, 'local', accounts);
    const context = JSON.parse(await readFile(join(directory, 'soy-backend.json'), 'utf8'));
    expect(context.napplet).not.toBe(address);
    expect(service.boards.read('guest', { napplet: context.napplet, board: 'main' }).rows).toEqual(
      [],
    );
    expect(context.provider).toEqual(service.provider);
  } finally {
    await service.close();
    relay.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
