import { readFile } from 'node:fs/promises';
import type { PreviewAssets } from './assets';

/** Build-time only in distributed CLIs. Source development runs this in a fresh process. */
export async function compilePreviewAssets(): Promise<PreviewAssets> {
  const built = await Bun.build({
    entrypoints: [new URL('./client.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
    minify: true,
    plugins: [
      {
        name: 'raw-napplet-prelude',
        setup(build) {
          build.onResolve({ filter: /^@napplet\/shim\/prelude.global\?raw$/ }, () => ({
            path: Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir),
            namespace: 'raw',
          }));
          build.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
            contents: await readFile(path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  if (!built.success) throw new Error(`Could not prepare preview: ${built.logs.join('\n')}`);
  return {
    client: await built.outputs[0].text(),
    html: await readFile(new URL('../../templates/preview.html', import.meta.url), 'utf8'),
  };
}
if (import.meta.main) console.log(JSON.stringify(await compilePreviewAssets()));
