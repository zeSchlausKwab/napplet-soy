import { expect, test } from 'bun:test';
import { request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { createBlossom } from '../../services/blossom/server';
import { blossomAuthorization } from '../../packages/blossom/src/client';
import { sha256 } from '../../packages/protocol/src';

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
  let upload: ReturnType<typeof request> | undefined;
  try {
    const authorization = await blossomAuthorization(signer, 'upload', origin, hash);
    const started = Date.now();
    const response = new Promise<{ status: number; message: string }>((resolve, reject) => {
      upload = request(
        `${origin}/upload`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/x-tar',
            'Content-Length': String(bytes.length),
            'X-SHA-256': hash,
            Authorization: authorization,
          },
        },
        async (response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(chunk);
          resolve({ status: response.statusCode!, message: Buffer.concat(chunks).toString() });
        },
      );
      upload.on('error', reject);
      sending = (async () => {
        for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
          if (upload!.destroyed) break;
          if (!upload!.write(bytes.subarray(offset, offset + 512 * 1024)))
            await once(upload!, 'drain');
          await Bun.sleep(1100);
        }
        upload!.end();
      })();
      sending.catch(reject);
    });
    const result = await response;
    expect(result.status, result.message).toBe(201);
    expect(Date.now() - started).toBeGreaterThan(20000);
    expect(await sha256(await (await fetch(`${origin}/${hash}`)).bytes())).toBe(hash);
    expect(await readdir(join(directory, 'incoming'))).toEqual([]);
  } finally {
    upload?.destroy();
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
      let upload: ReturnType<typeof connect> | undefined;
      try {
        const response = await new Promise<{ status: number; message: string }>(
          (resolve, reject) => {
            // Bun's node:http client withholds early responses until request.end().
            // A raw HTTP socket exercises cancellation while the body is still incomplete.
            upload = connect({ host: '127.0.0.1', port: service.server.port! });
            let raw = Buffer.alloc(0);
            upload.on('data', (chunk) => {
              raw = Buffer.concat([raw, chunk]);
              const boundary = raw.indexOf('\r\n\r\n');
              if (boundary < 0) return;
              const headers = raw.subarray(0, boundary).toString();
              const length = Number(/content-length: (\d+)/i.exec(headers)?.[1]);
              if (raw.length < boundary + 4 + length) return;
              resolve({
                status: Number(/^HTTP\/1.1 (\d+)/.exec(headers)?.[1]),
                message: raw.subarray(boundary + 4, boundary + 4 + length).toString(),
              });
            });
            upload.on('error', reject);
            upload.on('connect', () => {
              upload!.write(
                `PUT /upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${bytes.length}\r\nX-SHA-256: ${hash}\r\nAuthorization: ${authorization}\r\nConnection: close\r\n\r\n`,
              );
              upload!.write(bytes.subarray(0, 1));
              if (trickle)
                tick = setInterval(() => {
                  if (!upload!.destroyed) upload!.write(bytes.subarray(0, 1));
                }, 50);
            });
          },
        );
        expect(response.status).toBe(408);
        expect(response.message).toContain(trickle ? 'overall time limit' : 'stalled');
        expect(await readdir(join(directory, 'incoming'))).toEqual([]);
        expect(await readdir(join(directory, 'blobs'))).toEqual([]);
        expect(service.store.lookup(hash)).toBeNull();
      } finally {
        clearInterval(tick);
        upload?.destroy();
      }
    }
  } finally {
    await service.close(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
