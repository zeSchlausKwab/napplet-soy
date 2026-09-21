import { test, expect } from 'bun:test';
import records from '../data/catalog.json';
import { ogImage, ogResponse, previewSvg } from './og';
import { siteOrigin } from './site-origin';
for (const id of ['site', records[0].snapshot.id])
  test(`OG preview ${id} is a real 1200 × 630 PNG with conditional GET and HEAD support`, async () => {
    const bytes = (await ogImage(id))!;
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    const head = await ogResponse(
      id,
      new Request('http://localhost/api/og/' + id, { method: 'HEAD' }),
    );
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(
      (
        await ogResponse(
          id,
          new Request('http://localhost/api/og/' + id, {
            headers: { 'if-none-match': head.headers.get('etag')! },
          }),
        )
      ).status,
    ).toBe(304);
    expect(await ogImage('0'.repeat(64))).toBeNull();
  });
test('preview text is escaped, remote images are never loaded, and origins are explicit', () => {
  const svg = previewSvg({
    title: '<script>&',
    description: '<image href="https://evil.example"/>',
    creator: 'Alice',
    topics: ['visual', '<unsafe>'],
    slug: 'soft-orbit',
  });
  expect(svg).toContain('&lt;script&gt;&amp;');
  expect(svg).toContain('#visual · #&lt;unsafe&gt;');
  expect(svg).not.toContain('data:image/svg+xml');
  expect(svg).not.toContain('FROM NOSTR');
  expect(svg).not.toContain('<image href="https://');
  const old = process.env.SPACE_SITE_ORIGIN;
  try {
    process.env.SPACE_SITE_ORIGIN = 'https://napplet.space';
    expect(siteOrigin()).toBe('https://napplet.space');
    process.env.SPACE_SITE_ORIGIN = 'https://user:pass@example.com';
    expect(siteOrigin).toThrow();
  } finally {
    if (old === undefined) delete process.env.SPACE_SITE_ORIGIN;
    else process.env.SPACE_SITE_ORIGIN = old;
  }
});
