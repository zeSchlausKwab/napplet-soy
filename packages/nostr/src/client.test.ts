import { expect, test } from 'bun:test';
import records from '../../backend/data/catalog.json';
import { createNostrClient } from './client';
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

test('Applesauce receives a signed event through its WebSocket relay transport', async () => {
  const event = records[0].current;
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
        const [type, subscription] = JSON.parse(String(data));
        if (type === 'REQ') {
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
    const subscription = client.store.insert$.subscribe((value) => {
      if (value.id === event.id) {
        subscription.unsubscribe();
        resolve();
      }
    });
  });
  try {
    stop = client.connect([`ws://127.0.0.1:${relay.port}`]);
    await arrived;
    expect(client.store.getEvent(event.id)?.id).toBe(event.id);
  } finally {
    clearTimeout(timer!);
    stop();
    client.store.dispose();
    relay.stop(true);
  }
});
