import { expect, test } from 'bun:test';
import { MAX_ARTIFACT_BYTES, sha256 } from '../../protocol/src';
import { PLAYER_SANDBOX, verifiedDocument } from './index';
test('verifies bytes before constructing a document', async () => {
  const source = '<h1>Hello</h1><script>console.log("hello")</script>';
  const html = await verifiedDocument(new TextEncoder().encode(source), await sha256(source));
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<h1>'));
  expect(html).toContain("connect-src 'none'");
  expect(PLAYER_SANDBOX).toBe('allow-scripts');
});
test('tampering and oversized packages fail closed', async () => {
  await expect(
    verifiedDocument(new TextEncoder().encode('changed'), '0'.repeat(64)),
  ).rejects.toThrow('does not match');
  await expect(
    verifiedDocument(new Uint8Array(MAX_ARTIFACT_BYTES + 1), '0'.repeat(64)),
  ).rejects.toThrow('10 MiB');
});
test('non-UTF8 HTML is rejected', async () => {
  const bytes = new Uint8Array([0xff, 0xfe]);
  await expect(verifiedDocument(bytes, await sha256(bytes))).rejects.toThrow();
});
