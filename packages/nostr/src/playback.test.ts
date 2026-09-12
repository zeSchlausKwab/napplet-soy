import { test, expect } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { PlaybackNostr, playbackFilters } from './playback';

test('playback relay reads validate signatures and filters, deduplicate, and close without publishing', async () => {
  const key = new Uint8Array(32);
  key[31] = 2;
  const event = finalizeEvent(
    { kind: 1, tags: [], content: 'hello', created_at: Math.floor(Date.now() / 1000) },
    key,
  );
  const wrongKind = finalizeEvent(
    { kind: 2, tags: [], content: 'wrong kind', created_at: event.created_at },
    key,
  );
  const requests: unknown[][] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        requests.push(message);
        if (message[0] === 'REQ') {
          for (const e of [event, event, { ...event, content: 'forged' }, wrongKind])
            ws.send(JSON.stringify(['EVENT', message[1], e]));
          ws.send(JSON.stringify(['EOSE', message[1]]));
        }
      },
    },
  });
  const delivered: Record<string, unknown>[] = [];
  const client = new PlaybackNostr(
    [`ws://127.0.0.1:${relay.port}/`],
    (m) => delivered.push(m),
    () => null,
  );
  try {
    const result = await client.handle({ type: 'outbox.query', filters: { kinds: [1], limit: 5 } });
    expect(result).toMatchObject({ events: [{ event }], incomplete: false });
    await client.handle({
      type: 'relay.subscribe',
      subId: 'one',
      filters: { kinds: [1], limit: 5 },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(delivered.filter((m) => m.type === 'relay.event')).toHaveLength(1);
    expect(delivered.some((m) => m.type === 'relay.eose')).toBe(true);
    await expect(client.handle({ type: 'relay.publish', event })).rejects.toThrow('disabled');
    await expect(
      client.handle({
        type: 'relay.subscribe',
        subId: 'escape',
        relay: 'wss://attacker.example/',
        filters: {},
      }),
    ).rejects.toThrow('not allowed');
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const before = requests.filter((r) => r[0] === 'REQ').length;
    expect(await client.query([{ kinds: [1] }])).toEqual([]);
    expect(requests.filter((r) => r[0] === 'REQ')).toHaveLength(before);
    expect(requests.some((r) => r[0] === 'EVENT' || r[0] === 'AUTH')).toBe(false);
    expect(delivered.some((m) => m.type === 'relay.closed')).toBe(true);
  } finally {
    client.close();
    relay.stop(true);
  }
});
test('playback filters are bounded and guest identity is explicit', async () => {
  for (const input of [
    { limit: 10000 },
    { authors: ['bad-key'] },
    Array(5).fill({}),
    { secret: ['x'] },
  ])
    expect(() => playbackFilters(input)).toThrow();
  const client = new PlaybackNostr(
    [],
    () => {},
    () => null,
  );
  expect(await client.identity('getPublicKey')).toEqual({ pubkey: '' });
  expect(await client.identity('getFollows')).toEqual({ pubkeys: [] });
  expect(await client.handle({ type: 'outbox.query', filters: {} })).toMatchObject({
    events: [],
    incomplete: true,
  });
  await expect(client.common({ type: 'common.follow', pubkeys: [] })).rejects.toThrow('disabled');
  client.close();
});
