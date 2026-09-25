import { join, resolve } from 'node:path';
import type { previewAssets } from '../apps/cli/src/preview/assets';

const root = resolve(import.meta.dir, '..');

/** Release and standalone integration fixtures share loaders and runtime isolation. */
export async function compileCli(
  outfile: string,
  version: string,
  options: {
    target?: Bun.Build.CompileTarget;
    previewAssets?: Awaited<ReturnType<typeof previewAssets>>;
  } = {},
) {
  const build = await Bun.build({
    entrypoints: [join(root, 'apps/cli/src/index.ts')],
    target: 'bun',
    minify: true,
    define: {
      NAPPLET_STANDALONE: 'true',
      NAPPLET_CLI_VERSION: JSON.stringify(version),
      ...(options.previewAssets
        ? { NAPPLET_PREVIEW_ASSETS: JSON.stringify(options.previewAssets) }
        : {}),
    },
    plugins: [
      {
        name: 'raw-creator-source',
        setup(build) {
          // Keep the shipped helper text separate from its executable module identity.
          build.onResolve(
            { filter: /\/(gamepad|app-data|app-data-contract|handler|handler-types)\.ts\?raw$/ },
            ({ path }) => ({
              path: resolve(root, 'apps/cli/src', path.slice(0, -4)),
              namespace: 'creator-source',
            }),
          );
          build.onLoad({ filter: /.*/, namespace: 'creator-source' }, async ({ path }) => ({
            contents: await Bun.file(path).text(),
            loader: 'text',
          }));
        },
      },
    ],
    compile: {
      ...(options.target ? { target: options.target } : {}),
      outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
}

if (import.meta.main) {
  const [outfile, version] = process.argv.slice(2);
  if (!outfile || !version)
    throw new Error('Usage: bun scripts/cli-compile.ts <outfile> <version>');
  await compileCli(outfile, version);
}
