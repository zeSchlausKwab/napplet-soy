import { expect, test } from '@playwright/test';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { createHash, randomUUID } from 'node:crypto';
import { blossomAuthorization } from '../../packages/blossom/src/client';
import { blossomOrigin } from '../../packages/blossom/src/protocol';

test('Caddy serves signed cross-origin uploads, reads and deletion to a real browser', async ({
  page,
  request,
}) => {
  test.skip(process.env.TEST_BLOSSOM !== '1', 'Requires the local dev:prod Blossom/Caddy stack.');
  const origin = blossomOrigin(process.env.TEST_BLOSSOM_ORIGIN ?? 'http://127.0.0.1:8081', true);
  const signer = new PrivateKeySigner();
  const content = `<!doctype html><title>Temporary browser test</title>${randomUUID()}`;
  const hash = createHash('sha256').update(content).digest('hex');
  const upload = await blossomAuthorization(signer, 'upload', origin, hash);
  const remove = await blossomAuthorization(signer, 'delete', origin, hash);
  await page.goto('/');
  try {
    const result = await page.evaluate(
      async ({ origin, content, hash, upload, remove }) => {
        const written = await fetch(`${origin}/upload`, {
          method: 'PUT',
          body: content,
          headers: { Authorization: upload, 'Content-Type': 'text/html', 'X-SHA-256': hash },
        });
        const descriptor = await written.json();
        const read = await fetch(`${origin}/${hash}.html`);
        const bytes = await read.arrayBuffer();
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        const range = await fetch(`${origin}/${hash}`, { headers: { Range: 'bytes=0-14' } });
        const deleted = await fetch(`${origin}/${hash}`, {
          method: 'DELETE',
          headers: { Authorization: remove },
        });
        return {
          written: written.status,
          descriptor,
          digest,
          read: read.status,
          range: range.status,
          rangeBytes: (await range.arrayBuffer()).byteLength,
          deleted: deleted.status,
          missing: (await fetch(`${origin}/${hash}`)).status,
        };
      },
      { origin, content, hash, upload, remove },
    );
    expect(result).toMatchObject({
      written: 201,
      read: 200,
      digest: hash,
      range: 206,
      rangeBytes: 15,
      deleted: 204,
      missing: 404,
    });
    expect(result.descriptor.sha256).toBe(hash);
  } finally {
    // This test owns only this random blob; leave the persistent local fixtures intact.
    await request.delete(`${origin}/${hash}`, { headers: { Authorization: remove } });
  }
});
