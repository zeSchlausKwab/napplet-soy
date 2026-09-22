import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateReleaseVersion } from './cli-release-check';
import { verifyReleaseArtifacts } from './cli-github-release';

test('CI refuses mismatched versions and tags before building or publishing', () => {
  expect(validateReleaseVersion('0.18.0', 'version=0.18.0\n', 'refs/tags/soyli-v0.18.0')).toBe(
    '0.18.0',
  );
  expect(() => validateReleaseVersion('0.18.0', 'version=0.17.0\n')).toThrow('must match');
  expect(() =>
    validateReleaseVersion('0.18.0', 'version=0.18.0\n', 'refs/tags/soyli-v0.19.0'),
  ).toThrow('tag must');
  expect(() => validateReleaseVersion('0.18.0-beta', 'version=0.18.0-beta\n')).toThrow();
});
test('publication requires all four archives and their exact checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-ci-artifacts-'));
  try {
    for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
      const name = `soyli-${platform}.tar.gz`;
      await Bun.write(join(root, name), platform);
      await Bun.write(
        join(root, name + '.sha256'),
        `${new Bun.CryptoHasher('sha256').update(platform).digest('hex')}  ${name}\n`,
      );
    }
    expect(await verifyReleaseArtifacts(root)).toHaveLength(8);
    await Bun.write(join(root, 'soyli-linux-arm64.tar.gz'), 'corrupted');
    await expect(verifyReleaseArtifacts(root)).rejects.toThrow('checksum mismatch');
    await rm(join(root, 'soyli-darwin-x64.tar.gz.sha256'));
    await expect(verifyReleaseArtifacts(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
