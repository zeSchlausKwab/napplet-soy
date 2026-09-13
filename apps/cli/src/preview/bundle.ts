import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function preparePreviewRuntime(target: string) {
  // Bundle the exact shared host and policy into the standalone project.
  const builds = [
    await Bun.build({
      entrypoints: [new URL('./server.ts', import.meta.url).pathname],
      target: 'bun',
      format: 'esm',
      minify: true,
    }),
    await Bun.build({
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
    }),
  ];
  for (const [i, built] of builds.entries()) {
    if (!built.success)
      throw new Error(`Could not prepare the shared preview runtime: ${built.logs.join('\n')}`);
    await writeFile(
      resolve(target, `.napplet/${i === 0 ? 'server' : 'client'}.js`),
      await built.outputs[0].text(),
    );
  }
  await writeFile(
    resolve(target, '.napplet/preview.html'),
    await readFile(new URL('../../templates/preview.html', import.meta.url), 'utf8'),
  );
}

// Bun 1.3.11 can misread package files when Bun.build follows network/native
// activity in a long-lived process. Keep the compiler in a fresh trusted process.
export async function preparePreviewRuntimeIsolated(target: string) {
  const child = Bun.spawn([process.execPath, import.meta.path, target], {
    cwd: target,
    env: { PATH: process.env.PATH },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    const [code] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Could not compile the shared preview host');
  } finally {
    clearTimeout(timer);
  }
}
if (import.meta.main) await preparePreviewRuntime(process.argv[2]);
