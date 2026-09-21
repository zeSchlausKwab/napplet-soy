import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('.', import.meta.url));
export const root = resolve(source, '../../..');
export const output = join(root, 'output/spatial-proof');
/** Shared by Vite and the standalone movie/scene authoring tools. */
export async function buildScene(destination: string) {
  await mkdir(destination, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(source, 'main.ts')],
    target: 'browser',
    minify: true,
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Could not build the spatial presentation.');
  const script = await result.outputs[0].text();
  const scriptName = `spatial-${Bun.hash(script).toString(16)}.js`;
  await Bun.write(join(destination, scriptName), script);
  const html = await Bun.file(join(source, 'index.html')).text();
  await Bun.write(
    join(destination, 'index.html'),
    html.replace('src="spatial.js"', `src="${scriptName}"`),
  );
  const fonts = [
    ['dm-sans', 'dm-sans-latin-400-normal.woff2', 'sans.woff2'],
    ['dm-sans', 'dm-sans-latin-600-normal.woff2', 'sans-bold.woff2'],
    ['dm-mono', 'dm-mono-latin-400-normal.woff2', 'mono.woff2'],
    ['fredoka', 'fredoka-latin-600-normal.woff2', 'display.woff2'],
  ];
  for (const [pkg, from, to] of fonts)
    await cp(join(root, `node_modules/@fontsource/${pkg}/files/${from}`), join(destination, to));
  await cp(join(root, 'apps/web/public/brand/soy-mascot.png'), join(destination, 'soybert.png'));
  for (const asset of ['story-audio.m4a', 'story-poster.webp'])
    await cp(join(source, 'assets', asset), join(destination, asset));
}
export async function buildSpatial() {
  await buildScene(output);
  await cp(join(source, 'landing.html'), join(output, 'landing.html'));
  await cp(
    join(root, 'apps/web/public/brand/soybert-laptop-aligned.png'),
    join(output, 'soybert-laptop.png'),
  );
  console.log(`Spatial proof built: ${output}`);
}
if (import.meta.main) await buildSpatial();
