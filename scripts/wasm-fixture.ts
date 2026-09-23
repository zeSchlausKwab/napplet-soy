/** Reproducible acceptance specimen, not a required creator template. Never publishes. */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { creatorSkills } from '../apps/cli/src/creator-kit';
import { importAsset } from '../packages/assets/src';
import { sourceGit } from '../packages/grasp/src/client';

export async function prepareWasmFixture(destination: string) {
  const root = resolve(destination);
  await mkdir(root); // Never overwrite an existing project.
  await cp(resolve('tests/fixtures/wasm-bevy'), root, { recursive: true });
  const kit = creatorSkills();
  for (const file of [
    'docs/napplet-wasm.md',
    'docs/examples/napplet.rs',
    'docs/examples/napplet_bevy.rs',
  ]) {
    await mkdir(resolve(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), kit[file]);
  }
  await cp('LICENSE', join(root, 'LICENSE'));
  await writeFile(join(root, '.gitignore'), '/target/\n/.napplet-space/\n/dist/\n');
  await writeFile(
    join(root, 'README.md'),
    '# Rust garden\n\nRead docs/napplet-wasm.md. Run soyli setup, soyli build, soyli dev and soyli check.\n',
  );
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#8cb879' },
  })
    .png()
    .toBuffer();
  const asset = await importAsset(root, { id: 'leaf', bytes, storage: 'external', license: 'MIT' });
  const html = await Bun.file(join(root, 'index.html')).text();
  await writeFile(
    join(root, 'index.html'),
    html.replace('</head>', `<meta name="proof-resource" content="${asset.hash}"></head>`),
  );
  await sourceGit(root, ['init']);
  return root;
}
if (import.meta.main) console.log(await prepareWasmFixture(process.argv[2] ?? '.local/wasm-proof'));
