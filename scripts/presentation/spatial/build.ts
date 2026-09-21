import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export const root = resolve(import.meta.dir, '../../..');
export const output = join(root, 'output/spatial-proof');
export async function buildSpatial() {
  await mkdir(output, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'main.ts')],
    target: 'browser',
    minify: true,
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Could not build the spatial presentation.');
  await Bun.write(join(output, 'spatial.js'), await result.outputs[0].text());
  await cp(join(import.meta.dir, 'index.html'), join(output, 'index.html'));
  await cp(join(import.meta.dir, 'landing.html'), join(output, 'landing.html'));
  const fonts = [
    ['dm-sans', 'dm-sans-latin-400-normal.woff2', 'sans.woff2'],
    ['dm-sans', 'dm-sans-latin-600-normal.woff2', 'sans-bold.woff2'],
    ['dm-mono', 'dm-mono-latin-400-normal.woff2', 'mono.woff2'],
    ['fredoka', 'fredoka-latin-600-normal.woff2', 'display.woff2'],
  ];
  for (const [pkg, from, to] of fonts)
    await cp(join(root, `node_modules/@fontsource/${pkg}/files/${from}`), join(output, to));
  await cp(join(root, 'apps/web/public/brand/soy-mascot.png'), join(output, 'soybert.png'));
  await cp(
    join(root, 'apps/web/public/brand/soybert-laptop-aligned.png'),
    join(output, 'soybert-laptop.png'),
  );
  console.log(`Spatial proof built: ${output}`);
}
if (import.meta.main) await buildSpatial();
