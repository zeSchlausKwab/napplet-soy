import { test, expect } from 'bun:test';
import records from '../../backend/data/catalog.json';
import { discoverNapplets } from './discovery';
test('discovery queries all napplet kinds without a Space filter and rejects forged/unsigned entries', async () => {
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
        const m = JSON.parse(String(raw));
        requests.push(m);
        if (m[0] === 'REQ') {
          for (const event of [
            records[0].current,
            { ...records[0].current, content: 'forged' },
            { title: 'unsigned catalog item' },
          ])
            ws.send(JSON.stringify(['EVENT', m[1], event]));
          ws.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  try {
    const events = await discoverNapplets([`ws://127.0.0.1:${relay.port}`], 1000);
    expect(events.map((e) => e.id)).toEqual([records[0].current.id]);
    const req = requests.find((r) => r[0] === 'REQ')!;
    expect(req.slice(2)).toEqual([
      { kinds: [35129], limit: 150 },
      { kinds: [15129], limit: 25 },
      { kinds: [5129], limit: 25 },
    ]);
    expect(requests.some((r) => r[0] === 'EVENT' || r[0] === 'AUTH')).toBe(false);
  } finally {
    relay.stop(true);
  }
});
