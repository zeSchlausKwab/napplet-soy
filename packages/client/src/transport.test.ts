import { expect, test } from 'bun:test';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { ProtocolClient } from './nostr';
import { blossomBytes, readBytes, resourceUrl } from './bytes';
import { sha256 } from '../../protocol/src';
const key = new Uint8Array(32).fill(7); // Public fixture only.
const sign = (kind: number, content = '', created_at = Math.floor(Date.now() / 1000)) =>
  finalizeEvent({ kind, tags: [], content, created_at }, key);

test('direct queries reject invalid signatures, mismatched filters and future events; publish requires a relay acknowledgement', async () => {
  const good = sign(1, 'from Nostr'),
    unrelated = sign(2),
    future = sign(1, '', Math.floor(Date.now() / 1000) + 1000);
  const attempts: string[] = [];
  let connections = 0;
  let deny = true;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response('', { status: 404 });
    },
    websocket: {
      open() {
        connections++;
      },
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of [good, good, unrelated, future, { ...good, content: 'tampered' }])
            socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        } else if (m[0] === 'EVENT') {
          attempts.push(JSON.stringify(m[1]));
          socket.send(JSON.stringify(['OK', m[1].id, !deny, 'fixture']));
        }
      },
    },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`]);
  try {
    const streamed: string[] = [];
    expect(
      (await client.query([{ kinds: [1] }], [], undefined, (e) => streamed.push(e.id))).map(
        (e) => e.id,
      ),
    ).toEqual([good.id]);
    expect(streamed).toEqual([good.id]);
    expect((await client.query([{ ids: [good.id], kinds: [1] }])).map((e) => e.id)).toEqual([
      good.id,
    ]);
    await expect(client.publish(good)).rejects.toThrow('No relay acknowledged');
    deny = false;
    expect(await client.publish(good)).toHaveLength(1);
    expect(connections).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    expect(JSON.parse(attempts[0])).toEqual(JSON.parse(JSON.stringify(good)));
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('aborting a relay query closes its subscription without waiting for the relay', async () => {
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response();
    },
    websocket: { message() {} },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`]);
  try {
    const start = Date.now();
    await expect(client.query([{ kinds: [1] }], [], AbortSignal.timeout(60))).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('Blossom bytes are verified across declared fallbacks and redirects are refused', async () => {
  const bytes = new TextEncoder().encode('<!doctype html><p>Verified</p>'),
    hash = await sha256(bytes);
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path.startsWith('/redirect/'))
        return Response.redirect(`http://127.0.0.1:${server.port}/${hash}`);
      return new Response(path.startsWith('/bad/') ? 'tampered' : bytes);
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    expect(
      await blossomBytes(hash, [origin + '/bad', origin], AbortSignal.timeout(1000), undefined, [
        origin,
      ]),
    ).toEqual(bytes);
    await expect(
      blossomBytes(hash, [origin + '/redirect'], AbortSignal.timeout(1000), undefined, [origin]),
    ).rejects.toThrow('verified file');
    expect(paths).toEqual([`/bad/${hash}`, `/${hash}`, `/redirect/${hash}`]);
    await expect(blossomBytes(hash, [origin], AbortSignal.timeout(1000))).rejects.toThrow(
      'verified file',
    );
    expect(() => resourceUrl('https://127.0.0.1/private')).toThrow();
    expect(() => resourceUrl('https://user:password@files.example/x')).toThrow();
    expect(resourceUrl('https://files.example:8443/x').port).toBe('8443');
  } finally {
    server.stop(true);
  }
});

test('streaming download limits apply even without Content-Length', async () => {
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(6));
        c.enqueue(new Uint8Array(6));
        c.close();
      },
    }),
  );
  await expect(readBytes(response, 10)).rejects.toThrow('too-large');
});
