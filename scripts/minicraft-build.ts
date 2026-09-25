// Build browser assets in a fresh process: Bun's resolver must not reuse loaded
// server-side dependency variants (the same boundary as soyLI preview assets).
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const source = join(root, 'packages/dynamic-backends/demo');
const [directory, napplet] = process.argv.slice(2);
if (!directory || !napplet) throw new Error('Expected demo directory and public napplet address.');
const built = await Bun.build({
  entrypoints: [join(source, 'main.ts')],
  target: 'browser',
  format: 'iife',
  minify: true,
  define: { MINICRAFT_NAPPLET: JSON.stringify(napplet) },
});
if (!built.success) throw new AggregateError(built.logs, 'MiniCraft frontend build failed');
const script = (await built.outputs[0].text()).replace(/<\/script/gi, '<\\/script');
// A replacement callback preserves literal $ sequences inside bundled shaders.
const html = (await Bun.file(join(source, 'index.html')).text()).replace(
  '<!-- script -->',
  () => '<script>' + script + '</script>',
);
await Bun.write(join(directory, 'index.html'), html);
const host = await Bun.build({
  entrypoints: [join(source, 'host.ts')],
  target: 'browser',
  format: 'esm',
  minify: true,
  plugins: [
    {
      name: 'napplet-shim',
      setup(build) {
        build.onResolve({ filter: /^@napplet\/shim\/prelude.global\?raw$/ }, () => ({
          path: Bun.resolveSync('@napplet/shim/prelude.global', root),
          namespace: 'raw',
        }));
        build.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
          contents: await Bun.file(path).text(),
          loader: 'text',
        }));
      },
    },
  ],
});
if (!host.success) throw new AggregateError(host.logs, 'MiniCraft preview host build failed');
await mkdir(join(directory, '.napplet'), { recursive: true });
await Bun.write(join(directory, '.napplet/client.js'), await host.outputs[0].text());
await Bun.write(
  join(directory, '.napplet/preview.html'),
  await Bun.file(join(source, 'host.html')).text(),
);
