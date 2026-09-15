import { expect, test } from 'bun:test';
import { RelayPool, type RelayOptions } from 'applesauce-relay';
import { finalizeEvent } from 'nostr-tools';
import { PlaybackNostr } from '../../nostr/src/playback';
import { directReadPool } from '../../nostr/src/playback';
import { createPlaybackRelayResponder } from './playback-relay-response';
import { readRelayUrl } from '../../nostr/src/relay-policy';

const manifest = 'a'.repeat(64);
const origin = 'https://napplet.example';
function request(input: unknown, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3040/api/relay-read', {
    method: 'POST',
    headers: { Origin: origin, 'X-Space-Host': '1', ...headers },
    body: JSON.stringify(input),
  });
}
const query = {
  manifest,
  relay: 'wss://station.example/',
  filters: [{ kinds: [31237], limit: 10 }],
  live: false,
  timeoutMs: 1000,
};

test('runtime relay URLs admit public WSS and only explicitly configured literal loopback WS', () => {
  expect(readRelayUrl('wss://station.example')).toBe('wss://station.example/');
  expect(readRelayUrl('ws://127.0.0.1:4000', ['ws://127.0.0.1:4000/'])).toBe(
    'ws://127.0.0.1:4000/',
  );
  for (const value of [
    'wss://127.1',
    'wss://[::ffff:127.0.0.1]',
    'wss://10.0.0.1',
    'wss://169.254.169.254',
    'wss://localhost.',
    'wss://host.local',
    'wss://user:password@station.example',
    'wss://station.example:444',
    'wss://station.example/#hash',
    'ws://station.example',
    'ws://127.0.0.1:4001',
  ])
    expect(() => readRelayUrl(value, ['ws://127.0.0.1:4000'])).toThrow();
});

test('relay endpoint checks HTTPS origin, admission, shape and destination before opening a connection', async () => {
  let opens = 0;
  const responder = createPlaybackRelayResponder(
    async (id) => (id === manifest ? {} : null),
    () => origin,
    async () => {
      opens++;
      throw new Error();
    },
  );
  expect((await responder(request(query, { Origin: 'null' }))).status).toBe(403);
  expect((await responder(request(query, { Origin: 'http://127.0.0.1:3040' }))).status).toBe(403);
  expect((await responder(request(query, { 'X-Space-Host': '' }))).status).toBe(403);
  expect((await responder(request({ ...query, manifest: 'b'.repeat(64) }))).status).toBe(404);
  expect((await responder(request({ ...query, relay: 'wss://127.0.0.1' }))).status).toBe(403);
  expect((await responder(request({ ...query, relay: 'ws://127.0.0.1:4000' }))).status).toBe(403);
  expect((await responder(request({ ...query, filters: [{ limit: 10000 }] }))).status).toBe(400);
  expect((await responder(request({ ...query, event: { kind: 1 } }))).status).toBe(400);
  expect(
    (await responder(request({ ...query, filters: [{ search: 'a'.repeat(25000) }] }))).status,
  ).toBe(400);
  expect(opens).toBe(0);
  const failed = await responder(request(query));
  expect(failed.status).toBe(200);
  expect(await failed.text()).toContain('CLOSED');
  expect(opens).toBe(1);
  const local = createPlaybackRelayResponder(
    async () => ({ localRelays: ['ws://127.0.0.1:4000'] }),
    () => origin,
    async () => {
      opens++;
      throw new Error();
    },
  );
  const admitted = await local(request({ ...query, relay: 'ws://127.0.0.1:4000' }));
  expect(admitted.status).toBe(200);
  await admitted.text();
  expect((await local(request({ ...query, relay: 'ws://127.0.0.1:4001' }))).status).toBe(403);
  expect(opens).toBe(2);
});

test('direct Applesauce host reads the hinted station, verifies events, streams beyond EOSE, and cancels without publishing', async () => {
  const event = finalizeEvent(
    {
      kind: 31237,
      content: 'station',
      tags: [['d', 'radio']],
      created_at: Math.floor(Date.now() / 1000),
    },
    new Uint8Array(32).fill(3),
  );
  const wire: unknown[][] = [];
  const sockets = new Set<any>();
  const relay = Bun.serve<{ hint: boolean }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req, { data: { hint: new URL(req.url).pathname === '/station' } })) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        wire.push(message);
        if (message[0] !== 'REQ') return;
        if (ws.data.hint && message[2].kinds?.includes(31237)) {
          ws.send(JSON.stringify(['EVENT', message[1], { ...event, content: 'forged' }]));
          ws.send(JSON.stringify(['EVENT', message[1], event]));
        }
        ws.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
  const opened: string[] = [];
  let closed = 0;
  class FixtureWebSocket extends WebSocket {
    constructor(target: string) {
      opened.push(target);
      super(`ws://127.0.0.1:${relay.port}/${target.includes('station') ? 'station' : 'discovery'}`);
    }
  }
  const pool = new RelayPool({ WebSocket: FixtureWebSocket as RelayOptions['WebSocket'] });
  const close = pool.close.bind(pool);
  pool.close = () => {
    closed++;
    close();
  };
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://discovery.example/'],
    (value) => delivered.push(value),
    () => null,
    directReadPool(pool),
  );
  try {
    const result = await host.handle({
      type: 'outbox.query',
      filters: { kinds: [31237], authors: [event.pubkey], '#d': ['radio'] },
      options: { relays: ['wss://station.example'], timeoutMs: 1000 },
    });
    expect(result).toMatchObject({ events: [{ event }] });
    expect(opened).toContain('wss://station.example/');
    await host.handle({
      type: 'relay.subscribe',
      relay: 'wss://station.example/',
      filters: { kinds: [31237] },
      subId: 'live',
    });
    await Bun.sleep(30);
    expect(delivered.some((m) => m.type === 'relay.eose')).toBe(true);
    expect(delivered.filter((m) => m.type === 'relay.event')).toHaveLength(1);
    expect(sockets.size).toBeGreaterThan(0); // EOSE does not tear down live subscriptions.
    host.close();
    await Bun.sleep(30);
    expect(closed).toBeGreaterThan(0);
    expect(sockets.size).toBe(0);
    expect(wire.some((m) => m[0] === 'EVENT' || m[0] === 'AUTH')).toBe(false);
  } finally {
    host.close();
    relay.stop(true);
  }
});

test('cancellation and deadlines release the concurrent relay budget', async () => {
  const responder = createPlaybackRelayResponder(
    async () => ({}),
    () => origin,
    async (_url, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('closed')), { once: true }),
      ),
  );
  const streams: Response[] = [];
  for (let i = 0; i < 32; i++) streams.push(await responder(request({ ...query, live: true })));
  expect((await responder(request(query))).status).toBe(429);
  await Promise.all(streams.map((response) => response.body!.cancel()));
  const timed = await responder(request({ ...query, timeoutMs: 10 }));
  expect(timed.status).toBe(200);
  expect(await timed.text()).toContain('deadline');
  const next = await responder(request(query));
  expect(next.status).toBe(200);
  await next.body!.cancel();
});
