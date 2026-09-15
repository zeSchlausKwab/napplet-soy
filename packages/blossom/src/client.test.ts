import { expect, test } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { uploadBlob, verifyBlob } from './client';
import { sha256 } from '../../protocol/src';

test('uploader rejects forged descriptors, changed download bytes and redirects', async () => {
  const bytes = new TextEncoder().encode('exact publication bytes');
  const hash = await sha256(bytes);
  let behavior = 'descriptor';
  let reads = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      if (new URL(request.url).pathname === '/upload') {
        if (behavior === 'redirect') return Response.redirect('http://127.0.0.1:1/upload');
        return Response.json({
          sha256: behavior === 'descriptor' ? '0'.repeat(64) : hash,
          size: bytes.length,
          uploaded: 1,
          type: 'text/plain',
          // The client must never follow this URL, even when the descriptor is valid.
          url: `https://cdn.example/${hash}.txt`,
        });
      }
      reads++;
      return new Response('changed bytes');
    },
  });
  const input = {
    origin: `http://127.0.0.1:${server.port}`,
    bytes,
    type: 'text/plain',
    signer: new PrivateKeySigner(),
    local: true,
  };
  try {
    await expect(uploadBlob(input)).rejects.toThrow('inconsistent descriptor');
    expect(reads).toBe(0);
    behavior = 'bytes';
    await expect(uploadBlob(input)).rejects.toThrow('independently hash-verified');
    expect(reads).toBe(1);
    behavior = 'redirect';
    await expect(uploadBlob(input)).rejects.toThrow();
    expect(reads).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test('upload and progressing verification each receive a fresh time budget', async () => {
  const bytes = new TextEncoder().encode('12345678');
  const hash = await sha256(bytes);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/upload') {
        await request.arrayBuffer();
        await Bun.sleep(450);
        return Response.json({
          sha256: hash,
          size: bytes.length,
          type: 'text/plain',
          uploaded: 1,
          url: `https://cdn.example/${hash}.txt`,
        });
      }
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 2) {
              await Bun.sleep(125);
              if (request.signal.aborted) return;
              controller.enqueue(bytes.slice(offset, offset + 2));
            }
            controller.close();
          },
        }),
      );
    },
  });
  try {
    const start = Date.now();
    const result = await uploadBlob({
      origin: `http://127.0.0.1:${server.port}`,
      bytes,
      type: 'text/plain',
      signer: new PrivateKeySigner(),
      local: true,
      timeouts: { uploadMs: 700, verificationMs: 700, idleMs: 250 },
    });
    expect(result.descriptor.sha256).toBe(hash);
    expect(Date.now() - start).toBeGreaterThan(700);
  } finally {
    await server.stop(true);
  }
}, 5000);

test('verification stops idle or trickling downloads, caller cancellation and oversized responses', async () => {
  const bytes = new Uint8Array(100).fill(4);
  const hash = await sha256(bytes);
  let mode = 'idle';
  let cancelled = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (mode === 'oversized') return new Response(new Uint8Array(101));
      let tick: ReturnType<typeof setInterval> | undefined;
      request.signal.addEventListener(
        'abort',
        () => {
          cancelled++;
          clearInterval(tick);
        },
        { once: true },
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 1));
            if (mode === 'trickle')
              tick = setInterval(() => controller.enqueue(bytes.slice(0, 1)), 40);
          },
          cancel() {
            clearInterval(tick);
          },
        }),
      );
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    for (mode of ['idle', 'trickle', 'cancel', 'oversized']) {
      const abort = new AbortController();
      const timer =
        mode === 'cancel'
          ? setTimeout(() => abort.abort(new Error('Creator cancelled')), 70)
          : undefined;
      try {
        const operation = verifyBlob(origin, hash, bytes.length, abort.signal, {
          idleMs: 150,
          verificationMs: 350,
        });
        if (mode === 'oversized') expect(await operation).toBe(false);
        else
          await expect(operation).rejects.toThrow(
            mode === 'idle'
              ? 'stalled'
              : mode === 'trickle'
                ? 'overall time limit'
                : 'Creator cancelled',
          );
      } finally {
        clearTimeout(timer);
      }
    }
    await Bun.sleep(50);
    expect(cancelled).toBe(3);
  } finally {
    await server.stop(true);
  }
}, 5000);
