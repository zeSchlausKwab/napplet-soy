import { test, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  NostrClientTransport,
  NostrServerTransport,
  ApplesauceRelayPool,
  PrivateKeySigner,
  EncryptionMode,
} from '@contextvm/sdk';
import { matchFilters, verifyEvent, type Filter, type NostrEvent } from 'nostr-tools';
import { createMatchmakingServer } from './server';
import records from '../../backend/data/catalog.json';

test('ContextVM carries encrypted matchmaking calls and derives the actor from the signed transport', async () => {
  type Socket = Bun.ServerWebSocket<{ subscriptions: Map<string, Filter[]> }>;
  const sockets = new Set<Socket>();
  const events: NostrEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: { subscriptions: new Map() } })) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      open(ws: Socket) {
        sockets.add(ws);
      },
      close(ws: Socket) {
        sockets.delete(ws);
      },
      message(ws: Socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') {
          const filters = message.slice(2);
          ws.data.subscriptions.set(message[1], filters);
          for (const event of events)
            if (matchFilters(filters, event)) ws.send(JSON.stringify(['EVENT', message[1], event]));
          ws.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'CLOSE') ws.data.subscriptions.delete(message[1]);
        else if (message[0] === 'EVENT' && verifyEvent(message[1])) {
          const event = message[1];
          events.push(event);
          ws.send(JSON.stringify(['OK', event.id, true, '']));
          for (const peer of sockets)
            for (const [id, filters] of peer.data.subscriptions)
              if (matchFilters(filters, event)) peer.send(JSON.stringify(['EVENT', id, event]));
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${relay.port}`;
  const signer = new PrivateKeySigner();
  const serverPool = new ApplesauceRelayPool([url]);
  const clientPool = new ApplesauceRelayPool([url]);
  const server = createMatchmakingServer();
  const client = new Client({ name: 'space-transport-test', version: '1' });
  const actorSigner = new PrivateKeySigner();
  try {
    await server.connect(
      new NostrServerTransport({
        signer,
        relayHandler: serverPool,
        injectClientPubkey: true,
        publishRelayList: false,
        isAnnouncedServer: false,
        encryptionMode: EncryptionMode.REQUIRED,
        logLevel: 'silent',
      }),
    );
    await client.connect(
      new NostrClientTransport({
        signer: actorSigner,
        relayHandler: clientPool,
        serverPubkey: await signer.getPublicKey(),
        encryptionMode: EncryptionMode.REQUIRED,
        logLevel: 'silent',
      }),
    );
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'space_match_join',
      'space_match_status',
      'space_match_leave',
    ]);
    const result = await client.callTool({
      name: 'space_match_join',
      arguments: { napplet: records[0].naddr, artifact: records[0].artifactHash },
      _meta: { clientPubkey: 'f'.repeat(64) },
    });
    expect(result.isError).not.toBe(true);
    const ticket = (result.structuredContent as { ticket: string }).ticket;
    const state = await client.callTool({ name: 'space_match_status', arguments: { ticket } });
    expect(state.isError).not.toBe(true);
    expect((state.structuredContent as { state: string }).state).toBe('waiting');
    // Request payloads do not appear as cleartext on the relay.
    expect(events.some((event) => event.content.includes(records[0].naddr))).toBe(false);
  } finally {
    await client.close();
    await server.close();
    await clientPool.disconnect();
    await serverPool.disconnect();
    relay.stop(true);
  }
}, 15000);
