import { expect, test } from 'bun:test';
import records from '../../backend/data/catalog.json';
import { createNostrClient } from './client';
import { matchFilters, finalizeEvent } from 'nostr-tools';
test('Applesauce deduplicates signed seeds and isolates sessions', () => {
  const event = records[0].current;
  const first = createNostrClient([event, event]);
  const second = createNostrClient();
  expect(first.store.getEvent(event.id)?.id).toBe(event.id);
  expect(second.store.getEvent(event.id)).toBeUndefined();
  expect(() => createNostrClient([{ ...event, content: 'tampered' }])).toThrow();
  first.store.dispose();
  second.store.dispose();
});

test('Applesauce discovers unbranded named, root and snapshot manifests through a filtering relay', async () => {
  const key = new Uint8Array(32);
  key[31] = 1;
  const root = finalizeEvent(
    {
      ...records[0].current,
      kind: 15129,
      tags: records[0].current.tags.filter((t) => !['d', 't', 'e'].includes(t[0])),
    },
    key,
  );
  const events = [records[0].current, records[0].snapshot, root];
  // A bounded NIP-01 transport fixture; this is not a substitute for GRASP/relay integration.
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('WebSocket required', { status: 400 });
    },
    websocket: {
      message(socket, data) {
        const [type, subscription, ...filters] = JSON.parse(String(data));
        if (type === 'REQ') {
          for (const event of events)
            if (matchFilters(filters, event))
              socket.send(JSON.stringify(['EVENT', subscription, event]));
          socket.send(JSON.stringify(['EOSE', subscription]));
        }
      },
    },
  });
  const client = createNostrClient();
  let stop = () => {};
  let timer: ReturnType<typeof setTimeout>;
  const arrived = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Relay delivery timed out')), 2000);
    const subscription = client.store.insert$.subscribe(() => {
      if (events.every((event) => client.store.getEvent(event.id))) {
        subscription.unsubscribe();
        resolve();
      }
    });
  });
  try {
    stop = client.connect([`ws://127.0.0.1:${relay.port}`]);
    await arrived;
    for (const event of events) expect(client.store.getEvent(event.id)?.id).toBe(event.id);
  } finally {
    clearTimeout(timer!);
    stop();
    client.store.dispose();
    relay.stop(true);
  }
});
