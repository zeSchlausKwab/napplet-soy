import { test, expect } from 'bun:test';
import { resourceMime, resourceResponse, resolveResource } from './resources';
import { fetchPublicBytes, publicResourceUrl } from './blossom';
const bytes = (s: string) => new TextEncoder().encode(s);
test('resource classification ignores upstream MIME and refuses active documents', () => {
  expect(resourceMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
  expect(resourceMime(bytes('RIFF1234WEBP'))).toBe('image/webp');
  expect(resourceMime(bytes('{"title":"hello"}'))).toBe('application/json');
  expect(resourceMime(new Uint8Array([17, 17, 17]), true)).toBe('application/octet-stream');
  expect(() => resourceMime(bytes('<svg/>'), true)).toThrow();
  for (const source of [
    '<svg onload="alert(1)"/>',
    '<!DOCTYPE html><script>bad()</script>',
    '<?xml version="1.0"?>',
    '\0binary',
  ])
    expect(() => resourceMime(bytes(source))).toThrow();
});
test('resource fetches reject private networks and unsafe schemes without redirecting', async () => {
  for (const value of [
    'http://example.com/a',
    'file:///etc/passwd',
    'https://user:pass@example.com/a',
    'https://example.com:8443/a',
  ])
    expect(() => publicResourceUrl(value)).toThrow();
  for (const value of [
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://169.254.169.254/latest/meta-data',
  ])
    await expect(fetchPublicBytes(new URL(value), AbortSignal.timeout(1000))).rejects.toThrow();
  await expect(
    resolveResource({ url: 'file:///etc/passwd' }, [], AbortSignal.timeout(1000)),
  ).rejects.toThrow('unsupported-scheme');
});
test('resource endpoint rejects opaque/cross-origin callers and unknown manifests', async () => {
  const url = 'http://localhost:3000/api/resources';
  for (const origin of ['null', 'https://evil.example']) {
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: origin, 'X-Space-Host': '1' },
      body: '{}',
    });
    expect((await resourceResponse(request)).status).toBe(403);
  }
  const request = new Request(url, {
    method: 'POST',
    headers: { Origin: new URL(url).origin, 'X-Space-Host': '1' },
    body: JSON.stringify({ manifest: '0'.repeat(64), url: 'https://example.com/picture.png' }),
  });
  expect((await resourceResponse(request)).status).toBe(404);
});
