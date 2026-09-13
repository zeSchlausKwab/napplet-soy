import { expect, test } from 'bun:test';
import { downloadArtifact, fetchPublicBytes } from '../../packages/backend/src/blossom';
import { fetchPublicBytesInNode } from '../../packages/backend/src/public-http-node';
import { sha256 } from '../../packages/protocol/src';

// Opt-in real HTTPS check for the pinned legacy VPS runtime. No relay writes.
test.skipIf(process.env.SPACE_TEST_PUBLIC_HTTP !== '1')(
  'guarded HTTPS preserves TLS hostname and verifies a published artifact',
  async () => {
    const hash = '6f69527ce41dc95d1b53aa4aa8ebf15bc44e433dda8d999078f0d34e330e6b81';
    const url = new URL(`https://cdn.hzrd149.com/${hash}`);
    const bytes = await fetchPublicBytes(url, AbortSignal.timeout(15000));
    expect(await sha256(bytes)).toBe(hash);
    expect(
      await sha256(await fetchPublicBytesInNode(url, AbortSignal.timeout(15000), 10 * 1024 ** 2)),
    ).toBe(hash);
    await expect(fetchPublicBytesInNode(url, AbortSignal.timeout(15000), 16)).rejects.toThrow();
    await expect(
      fetchPublicBytesInNode(new URL('https://127.0.0.1/private'), AbortSignal.timeout(5000), 1024),
    ).rejects.toThrow();
    await expect(
      fetchPublicBytesInNode(
        new URL('https://wrong.host.badssl.com/'),
        AbortSignal.timeout(10000),
        1024,
      ),
    ).rejects.toThrow();
  },
  60000,
);

test.skipIf(process.env.SPACE_TEST_PUBLIC_HTTP !== '1')(
  'near-limit public packages fit the production download deadline',
  async () => {
    const hash = '174a50a0f0b83d0b11893fb9442e0c55e5b5f6a444704578a56399d233aef055';
    const bytes = await downloadArtifact(
      ['https://blossom.bimcvp.com'],
      hash,
      AbortSignal.timeout(12000),
    );
    expect(bytes.length).toBe(9246415);
    expect(await sha256(bytes)).toBe(hash);
  },
  15000,
);
