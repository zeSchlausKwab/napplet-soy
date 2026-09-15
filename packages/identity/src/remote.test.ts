import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerWebSocket } from 'bun';
import { matchFilters, type Filter, type NostrEvent } from 'nostr-tools';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { NostrConnectProvider } from 'applesauce-signers/signers/nostr-connect-provider';
import { RelayPool } from 'applesauce-relay';
import { Accounts, type Vault } from './accounts';
import { bunkerCredential, openCredential, pairCredential, websiteKinds } from './signer';
import { BrowserIdentity } from '../../../apps/web/src/lib/browser-identity';

async function environment() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-remote-'));
  const sockets = new Map<ServerWebSocket<unknown>, Map<string, Filter[]>>();
  const events: NostrEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) =>
      server.upgrade(request) ? undefined : new Response('WebSocket required', { status: 400 }),
    websocket: {
      open(socket) {
        sockets.set(socket, new Map());
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(socket, raw) {
        const [method, value, ...filters] = JSON.parse(String(raw));
        if (method === 'REQ') {
          sockets.get(socket)!.set(value, filters);
          for (const event of events)
            if (matchFilters(filters, event)) socket.send(JSON.stringify(['EVENT', value, event]));
          socket.send(JSON.stringify(['EOSE', value]));
        } else if (method === 'CLOSE') sockets.get(socket)!.delete(value);
        else if (method === 'EVENT') {
          events.push(value);
          socket.send(JSON.stringify(['OK', value.id, true, '']));
          for (const [peer, subscriptions] of sockets)
            for (const [id, filters] of subscriptions)
              if (matchFilters(filters, value)) peer.send(JSON.stringify(['EVENT', id, value]));
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${relay.port}`;
  const pool = new RelayPool();
  const creator = new PrivateKeySigner();
  const transport = new PrivateKeySigner();
  const provider = new NostrConnectProvider({
    upstream: creator,
    signer: transport,
    relays: [url],
    bunkerSecret: 'test-pairing-secret',
    pool,
  });
  await provider.start();
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
  return {
    directory,
    relay,
    url,
    creator,
    transport,
    provider,
    events,
    vault,
    values,
    pool,
    sockets,
    async close() {
      await provider.stop();
      pool.close();
      relay.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('NIP-46 pairs over encrypted relay traffic, stores only a client session and verifies the creator again after reopening', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const account = await accounts.connect(await e.provider.getBunkerURI(), { timeoutMs: 3000 });
    expect(account.pubkey).toBe(await e.creator.getPublicKey());
    expect(account.pubkey).not.toBe(await e.transport.getPublicKey());
    await expect(accounts.backup()).rejects.toMatchObject({ code: 'RECOVERY_REMOTE' });
    expect(await accounts.create()).toEqual(account);
    expect(await Bun.file(join(e.directory, `${account.pubkey}.nsec`)).exists()).toBe(false);
    const reopened = new Accounts('local', e.directory, e.vault);
    await expect(reopened.use(account.id, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'SIGNER_CLOSED',
    });
    expect(await reopened.current()).toEqual(account);
    expect(await reopened.use(account.id, { timeoutMs: 3000 })).toEqual(account);
    const signer = await reopened.signer({ timeoutMs: 3000 });
    try {
      const signed = await signer.signEvent({
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [['d', 'creator-test']],
      });
      expect(signed.pubkey).toBe(account.pubkey);
    } finally {
      await signer.close();
    }
    expect(JSON.stringify([...e.values.values()])).not.toContain(
      Buffer.from(e.creator.key).toString('hex'),
    );
    expect(JSON.stringify(e.events)).not.toContain('test-pairing-secret');
    expect(e.events.every((event) => event.kind === 24133)).toBe(true);
    e.provider.upstream = new PrivateKeySigner();
    await expect(reopened.signer({ timeoutMs: 3000 })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
  } finally {
    await e.close();
  }
}, 15000);
test('remote denial, changed events and timeout fail closed without exposing provider errors or retaining sockets', async () => {
  const e = await environment();
  try {
    const credential = bunkerCredential(await e.provider.getBunkerURI(), 'local');
    let signer = await openCredential(credential, 'local', { timeoutMs: 1500 });
    e.provider.onSignEvent = () => false;
    await expect(
      signer.signEvent({ kind: 30617, created_at: 1, content: '', tags: [] }),
    ).rejects.toMatchObject({ code: 'SIGNER_REFUSED' });
    await signer.close();
    e.provider.onSignEvent = () => true;
    const upstream = e.creator.signEvent.bind(e.creator);
    e.creator.signEvent = (template) => upstream({ ...template, content: 'modified by signer' });
    signer = await openCredential(credential, 'local', { timeoutMs: 1500 });
    await expect(
      signer.signEvent({ kind: 30618, created_at: 1, content: '', tags: [] }),
    ).rejects.toMatchObject({ code: 'SIGNER_CHANGED_EVENT' });
    await signer.close();
    await e.provider.stop();
    await expect(openCredential(credential, 'local', { timeoutMs: 100 })).rejects.toMatchObject({
      code: 'SIGNER_TIMEOUT',
    });
    await expect(
      openCredential(credential, 'local', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'SIGNER_CLOSED' });
  } finally {
    await e.close();
  }
}, 10000);
test('local signer profile rejects public relay destinations before connecting', () => {
  const key = 'a'.repeat(64);
  for (const url of [
    'wss://relay.example',
    'ws://localhost',
    'ws://127.0.0.1.evil.example',
    'ws://name:password@127.0.0.1',
  ])
    expect(() =>
      bunkerCredential(`bunker://${key}?relay=${encodeURIComponent(url)}`, 'local'),
    ).toThrow();
  expect(() =>
    bunkerCredential(`bunker://${key}?relay=${encodeURIComponent('ws://127.0.0.1')}`, 'public'),
  ).toThrow();
});

test('client pairing ignores forged acknowledgements, persists a restartable client credential and scopes permissions', async () => {
  const e = await environment();
  try {
    e.provider.bunkerSecret = undefined;
    const accounts = new Accounts('local', e.directory, e.vault);
    let permissions: string[] = [];
    e.provider.onConnect = (_client, requested) => {
      permissions = requested;
      return true;
    };
    const attacker = new PrivateKeySigner();
    const account = await accounts.pair([e.url], {
      timeoutMs: 3000,
      onPairing: async (uri) => {
        const link = new URL(uri);
        expect(link.protocol).toBe('nostrconnect:');
        expect(link.searchParams.get('secret')!.length).toBeGreaterThanOrEqual(32);
        for (const result of ['ack', 'incorrect secret']) {
          const content = await attacker.nip44.encrypt(
            link.hostname,
            JSON.stringify({ id: 'forged', result }),
          );
          const event = await attacker.signEvent({
            kind: 24133,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', link.hostname]],
            content,
          });
          await e.pool.publish([e.url], event);
        }
        await Bun.sleep(25);
        await e.provider.handleNostrConnectURI(uri);
      },
    });
    expect(account.pubkey).toBe(await e.creator.getPublicKey());
    expect(permissions).toContain('sign_event:35129');
    expect(permissions).not.toContain('sign_event:9734');
    const stored = [...e.values.values()].map((v) => JSON.parse(v));
    expect(stored[0].remote).toBe(await e.transport.getPublicKey());
    expect(stored[0].secret).toBeUndefined();
    const signer = await new Accounts('local', e.directory, e.vault).signer({ timeoutMs: 3000 });
    try {
      await expect(
        signer.signEvent({ kind: 9734, created_at: 1, tags: [], content: '' }),
      ).rejects.toMatchObject({ code: 'SIGNING_SCOPE' });
      expect(
        (await signer.signEvent({ kind: 35129, created_at: 1, tags: [], content: '' })).pubkey,
      ).toBe(account.pubkey);
    } finally {
      await signer.close();
    }
  } finally {
    await e.close();
  }
}, 10000);

test('pairing timeout and cancellation leave no account, and retries use fresh client keys', async () => {
  const e = await environment();
  try {
    const accounts = new Accounts('local', e.directory, e.vault);
    const uris: string[] = [];
    await expect(
      accounts.pair([e.url], {
        timeoutMs: 100,
        onPairing: (uri) => {
          uris.push(uri);
        },
      }),
    ).rejects.toMatchObject({ code: 'SIGNER_TIMEOUT' });
    const controller = new AbortController();
    await expect(
      accounts.pair([e.url], {
        signal: controller.signal,
        onPairing: (uri) => {
          uris.push(uri);
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'SIGNER_CANCELLED' });
    expect(await accounts.current()).toBeNull();
    expect(e.values.size).toBe(0);
    expect(new URL(uris[0]).hostname).not.toBe(new URL(uris[1]).hostname);
    expect(new URL(uris[0]).searchParams.get('secret')).not.toBe(
      new URL(uris[1]).searchParams.get('secret'),
    );
    await expect(
      pairCredential(['wss://not-local.example'], 'local', { onPairing: () => {} }),
    ).rejects.toMatchObject({ code: 'INVALID_RELAY' });
  } finally {
    await e.close();
  }
});

test('browser identity scopes signatures, reconnects the same user, cancels pairing and rejects stale signatures after a switch', async () => {
  const e = await environment();
  const identity = new BrowserIdentity('local');
  try {
    const template = { kind: 7, created_at: 1, tags: [], content: '+' };
    await identity.bunker(await e.provider.getBunkerURI());
    const creator = await e.creator.getPublicKey();
    expect(identity.state.pubkey).toBe(creator);
    for (const kind of websiteKinds)
      expect((await identity.sign(creator, { ...template, kind })).pubkey).toBe(creator);
    await expect(identity.sign(creator, { ...template, kind: 35129 })).rejects.toThrow(
      'permissions',
    );
    e.provider.onSignEvent = () => false;
    await expect(identity.sign(creator, template)).rejects.toThrow('still selected');
    expect(identity.state).toMatchObject({ pubkey: creator, reconnect: true });
    e.provider.onSignEvent = () => true;
    await identity.reconnect();
    expect(identity.state.pubkey).toBe(creator);
    let release!: (value: boolean) => void;
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    e.provider.onSignEvent = () => {
      requested();
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const signing = identity.sign(creator, template);
    const rejected = signing.then(
      () => null,
      (error) => error,
    );
    await started;
    const replacement = new PrivateKeySigner();
    await identity.importKey(Buffer.from(replacement.key).toString('hex'));
    release(true);
    expect((await rejected)?.message).toContain('Signing did not complete');
    expect(identity.state.pubkey).toBe(await replacement.getPublicKey());
    await expect(identity.sign(creator, template)).rejects.toThrow('correct account');
    const pairing = identity.pair([e.url], () => {
      identity.cancel();
    });
    await expect(pairing).rejects.toThrow();
    expect(identity.state.pubkey).toBe(await replacement.getPublicKey());
    identity.disconnect();
    expect(identity.state).toMatchObject({ pubkey: null, method: null, reconnect: false });
  } finally {
    identity.disconnect();
    await e.close();
  }
}, 15000);
