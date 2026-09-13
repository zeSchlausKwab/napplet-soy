import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { blossomAuthorization, readBounded, uploadBlob } from '../packages/blossom/src/client';
import { blossomOrigin, type BlobDescriptor } from '../packages/blossom/src/protocol';
import { sha256, validateRelease } from '../packages/protocol/src';

const root = resolve(import.meta.dir, '..');
export const blossomBundle = resolve(root, '.local/bin/blossom.js');
export const localBlossomOrigin = 'http://127.0.0.1:19348';
export const localBlossomInstance = createHash('sha256').update(root).digest('hex').slice(0, 16);
export async function blossomBuildID() {
  const hash = createHash('sha256')
    .update(Bun.version)
    .update(process.platform)
    .update(process.arch);
  const paths = ['bun.lock', 'scripts/blossom.ts'];
  for (const directory of [
    'services/blossom',
    'packages/blossom/src',
    'packages/protocol/src',
    'packages/moderation/src',
  ])
    for (const file of new Bun.Glob('**/*.ts').scanSync(resolve(root, directory)))
      if (!file.endsWith('.test.ts')) paths.push(`${directory}/${file}`);
  for (const path of paths.sort())
    hash.update(path).update(await Bun.file(resolve(root, path)).bytes());
  return hash.digest('hex').slice(0, 16);
}
export async function buildBlossom(output = blossomBundle) {
  const build = await blossomBuildID();
  if (
    (await Bun.file(output).exists()) &&
    (await Bun.file(`${output}.build`).exists()) &&
    (await Bun.file(`${output}.build`).text()) === build
  )
    return build;
  await mkdir(resolve(output, '..'), { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, 'services/blossom/index.ts')],
    target: 'bun',
    define: { BLOSSOM_BUILD_ID: JSON.stringify(build) },
  });
  if (!result.success || result.outputs.length !== 1)
    throw new AggregateError(result.logs, 'Blossom build failed');
  const temporary = `${output}.${process.pid}.tmp`;
  await Bun.write(temporary, result.outputs[0]);
  await rename(temporary, output);
  await Bun.write(`${output}.build`, build);
  return build;
}
/** Fixed public fixture identity, literal loopback only; publicdev targets never enter this path. */
export async function seedLocalBlossom(input = localBlossomOrigin) {
  const started = performance.now();
  const origin = blossomOrigin(input, true);
  const key = new Uint8Array(32);
  key[31] = 1;
  const signer = new PrivateKeySigner(key);
  const pubkey = await signer.getPublicKey();
  const listing = await fetch(`${origin}/list/${pubkey}?limit=100`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: await blossomAuthorization(signer, 'list', origin) },
  });
  if (!listing.ok) throw new Error(`Local Blossom ownership check failed (${listing.status})`);
  const owned: BlobDescriptor[] = JSON.parse(
    new TextDecoder().decode(await readBounded(listing, 65536)),
  );
  if (!Array.isArray(owned) || owned.length > 100)
    throw new Error('Invalid local Blossom ownership listing');
  const hashes = new Set(owned.map((blob) => blob.sha256));
  const catalog = await Bun.file(resolve(root, 'packages/backend/data/catalog.json')).json();
  if (!Array.isArray(catalog) || catalog.length > 32)
    throw new Error('Invalid local fixture catalog');
  let uploaded = 0;
  for (const record of catalog) {
    const release = await validateRelease(record.current, record.snapshot);
    if (release.identity.pubkey !== pubkey || record.artifactHash !== release.artifactHash)
      throw new Error('Fixture identity or artifact hash mismatch');
    const bytes = await Bun.file(
      resolve(root, `packages/backend/data/artifacts/${release.artifactHash}.html`),
    ).bytes();
    if ((await sha256(bytes)) !== release.artifactHash)
      throw new Error('Fixture bytes were modified');
    let verified = false;
    if (hashes.has(release.artifactHash)) {
      const response = await fetch(`${origin}/${release.artifactHash}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        try {
          verified =
            (await sha256(await readBounded(response, bytes.length))) === release.artifactHash;
        } catch {
          /* A truncated or oversized stored file must be re-uploaded too. */
        }
      } else await response.body?.cancel();
    }
    if (verified) continue;
    await uploadBlob({ origin, bytes, type: 'text/html', signer, local: true });
    uploaded++;
  }
  return { blobs: catalog.length, uploaded, milliseconds: Math.round(performance.now() - started) };
}
if (import.meta.main) {
  if (process.argv[2] === 'build')
    console.log('Blossom build:', await buildBlossom(process.argv[3]));
  else if (process.argv[2] === 'seed') console.log('Local Blossom:', await seedLocalBlossom());
  else throw new Error('Expected build [output] or seed.');
}
