// Offline Blossom used by browser tests. Public test key; never target a live server.
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { createBlossom } from '../../services/blossom/server';
import { uploadBlob } from '../../packages/blossom/src/client';

const directory = process.argv[2];
if (!directory) throw new Error('Expected test directory');
const service = await createBlossom({
  directory: join(directory, 'blossom'),
  origin: 'http://127.0.0.1:19348',
  local: true,
  port: 0,
  instance: 'asset-test',
  build: 'asset-test',
});
try {
  const origin = `http://127.0.0.1:${service.server.port}`;
  const fixture = Bun.spawn(['bun', 'tests/fixtures/linked-preview.ts', directory, 'assets'], {
    env: { ...process.env, FIXTURE_ASSET_ORIGIN: origin },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (await fixture.exited) throw new Error('Fixture generation failed');
  const key = new Uint8Array(32);
  key[31] = 1;
  const signer = new PrivateKeySigner(key);
  for (const [path, type] of [
    [join(directory, 'original.png'), 'image/png'],
    ['tests/fixtures/preview.webm', 'video/webm'],
    [join(directory, 'source/source.tar'), 'application/x-tar'],
  ])
    await uploadBlob({ origin, type, bytes: await Bun.file(path).bytes(), signer, local: true });
  console.log(`Assets listening on ${origin}`);
  await new Promise<void>((done) => {
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
  });
} finally {
  await service.close(true);
}
