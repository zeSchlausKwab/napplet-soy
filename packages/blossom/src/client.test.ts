import { expect, test } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { uploadBlob } from './client';
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
