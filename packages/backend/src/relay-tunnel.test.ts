import { expect, test } from 'bun:test';
import { connect, createServer } from 'node:net';
import { relayTunnel } from './relay-tunnel';

test('relay tunnel requires its token and exact authority, pins the peer, and tears down on abort', async () => {
  let connections = 0;
  const upstream = createServer((socket) => {
    connections++;
    socket.on('error', () => {});
    socket.on('data', (data) => socket.write(data));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const signal = new AbortController();
  const tunnel = await relayTunnel(
    'station.example:443',
    '127.0.0.1',
    (upstream.address() as { port: number }).port,
    signal.signal,
  );
  const proxy = new URL(tunnel.proxy);
  const token = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
  const open = () => connect({ host: '127.0.0.1', port: Number(proxy.port) });
  try {
    for (const [authority, auth] of [
      ['station.example:443', 'wrong'],
      ['127.0.0.1:22', token],
    ]) {
      const client = open();
      await new Promise<void>((resolve, reject) => {
        client.on('error', reject);
        client.on('close', () => resolve());
        client.on('connect', () =>
          client.write(`CONNECT ${authority} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`),
        );
      });
    }
    expect(connections).toBe(0);
    const client = open();
    const messages: string[] = [];
    client.on('data', (data) => messages.push(data.toString()));
    client.on('error', () => {});
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.write(`CONNECT station.example:443 HTTP/1.1\r\nProxy-Authorization: ${token}\r\n\r\n`);
    await Bun.sleep(20);
    expect(messages.join('')).toContain('200 Connection Established');
    client.write('pinned transport');
    await Bun.sleep(20);
    expect(messages.join('')).toContain('pinned transport');
    expect(connections).toBe(1);
    const ended = new Promise<void>((resolve) => client.once('close', () => resolve()));
    signal.abort();
    await ended;
    expect(client.destroyed).toBe(true);
  } finally {
    signal.abort();
    tunnel.close();
    upstream.close();
  }
});
