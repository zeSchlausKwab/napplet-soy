import { expect, test } from 'bun:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { createBlossom } from '../../services/blossom/server';
import { blossomAuthorization } from '../../packages/blossom/src/client';
import { sha256 } from '../../packages/protocol/src';

/** Write literal HTTP framing: Bun 1.3.8's node:http adapter drops Content-Length
 * for streamed writes, and newer versions delay early responses until end(). */
function rawUpload(port: number, length: number, hash: string, authorization: string) {
  const socket = connect({ host: '127.0.0.1', port });
  let finished = false;
  const response = new Promise<{ status: number; message: string }>((resolve, reject) => {
    let raw = Buffer.alloc(0);
    const fail = (error: Error) => {
      finished = true;
      reject(error);
      socket.destroy();
    };
    socket.on('error', fail);
    socket.on('close', () => {
      if (!finished) fail(new Error('Upload connection closed before a complete response'));
    });
    socket.on('data', (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length > 16384) return fail(new Error('Upload response exceeds test limit'));
      const boundary = raw.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const headers = raw.subarray(0, boundary).toString();
      const status = Number(/^HTTP\/1.1 (\d+)/.exec(headers)?.[1]);
      const declared = /content-length: (\d+)/i.exec(headers)?.[1];
      if (!status || declared === undefined) return fail(new Error('Malformed upload response'));
      const size = Number(declared);
      if (raw.length < boundary + 4 + size) return;
      finished = true;
      resolve({ status, message: raw.subarray(boundary + 4, boundary + 4 + size).toString() });
    });
    socket.on('connect', () =>
      socket.write(
        `PUT /upload HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/x-tar\r\nContent-Length: ${length}\r\nX-SHA-256: ${hash}\r\nAuthorization: ${authorization}\r\nConnection: close\r\n\r\n`,
      ),
    );
  });
  // A response may reject while the caller is still sending or waiting for connect.
  void response.catch(() => {});
  return { socket, response, connected: once(socket, 'connect') };
}

test('a continuously progressing 11 MiB upload survives the former 20-second deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blossom-slow-upload-'));
  const service = await createBlossom({
    directory,
    origin: 'http://127.0.0.1:19348',
    local: true,
    port: 0,
    instance: 'test',
    build: 'test',
  });
  const origin = `http://127.0.0.1:${service.server.port}`;
  const bytes = new Uint8Array(11 * 1024 ** 2).fill(77);
  const hash = await sha256(bytes);
  const signer = new PrivateKeySigner();
  let sending: Promise<void> | undefined;
  let upload: ReturnType<typeof rawUpload> | undefined;
  try {
    const authorization = await blossomAuthorization(signer, 'upload', origin, hash);
    const started = Date.now();
    upload = rawUpload(service.server.port!, bytes.length, hash, authorization);
    await upload.connected;
    sending = (async () => {
      for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
        if (upload!.socket.destroyed) break;
        if (!upload!.socket.write(bytes.subarray(offset, offset + 512 * 1024)))
          await once(upload!.socket, 'drain');
        if (offset + 512 * 1024 < bytes.length) await Bun.sleep(1100);
      }
    })();
    // Observe both directions: an early server refusal must not wait for all bytes.
    void sending.catch(() => {});
    const result = await Promise.race([upload.response, sending.then(() => upload!.response)]);
    expect(result.status, result.message).toBe(201);
    expect(Date.now() - started).toBeGreaterThan(20000);
    expect(await sha256(await (await fetch(`${origin}/${hash}`)).bytes())).toBe(hash);
    expect(await readdir(join(directory, 'incoming'))).toEqual([]);
  } finally {
    upload?.socket.destroy();
    await sending?.catch(() => {});
    await service.close(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);

test('stalled and indefinitely trickling uploads time out and release partial bytes and slots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blossom-idle-upload-'));
  const service = await createBlossom({
    directory,
    origin: 'http://127.0.0.1:19348',
    local: true,
    port: 0,
    instance: 'test',
    build: 'test',
    uploadTimeouts: { idleMs: 200, totalMs: 650 },
  });
  const origin = `http://127.0.0.1:${service.server.port}`;
  const bytes = new Uint8Array(1024).fill(3);
  const hash = await sha256(bytes);
  const signer = new PrivateKeySigner();
  try {
    // Five failures also prove the service's four upload slots are released.
    for (const trickle of [false, false, true, false, true]) {
      const authorization = await blossomAuthorization(signer, 'upload', origin, hash);
      let tick: ReturnType<typeof setInterval> | undefined;
      let upload: ReturnType<typeof rawUpload> | undefined;
      try {
        upload = rawUpload(service.server.port!, bytes.length, hash, authorization);
        await upload.connected;
        upload.socket.write(bytes.subarray(0, 1));
        if (trickle)
          tick = setInterval(() => {
            if (!upload!.socket.destroyed) upload!.socket.write(bytes.subarray(0, 1));
          }, 50);
        const response = await upload.response;
        expect(response.status).toBe(408);
        expect(response.message).toContain(trickle ? 'overall time limit' : 'stalled');
        expect(await readdir(join(directory, 'incoming'))).toEqual([]);
        expect(await readdir(join(directory, 'blobs'))).toEqual([]);
        expect(service.store.lookup(hash)).toBeNull();
      } finally {
        clearInterval(tick);
        upload?.socket.destroy();
      }
    }
  } finally {
    await service.close(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
