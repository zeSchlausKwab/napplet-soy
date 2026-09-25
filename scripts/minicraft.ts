import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backendProject, localBackend } from '../apps/cli/src/backend';
import { startPreviewServer } from '../apps/cli/src/preview/server';
import { DiagnosticError, diagnose, formatDiagnostic } from '../packages/diagnostics/src';

const root = resolve(import.meta.dir, '..');
export async function prepareMinicraft(directory = join(root, '.local/minicraft')) {
  await mkdir(join(directory, 'backend'), { recursive: true });
  for (const file of ['backend.json', 'handler.ts', 'schemas.json'])
    await copyFile(
      join(root, 'packages/dynamic-backends/fixtures/minicraft', file),
      join(directory, 'backend', file),
    );
  // Fixed local fixture scope keeps saved worlds available across restarts.
  await Bun.write(
    join(directory, 'napplet.json'),
    JSON.stringify(
      {
        schema: 'space-local-project/v1',
        name: 'MiniCraft',
        description: 'A little world, together.',
        previewId: '737fb75b-91ca-408f-b228-971152a89283',
        identifier: 'minicraft',
        entry: 'index.html',
        license: 'MIT',
        requires: ['cvm', 'storage'],
        backend: { boards: [], modules: ['backend/backend.json'] },
      },
      null,
      2,
    ),
  );
  const project = await backendProject(directory);
  const child = Bun.spawn(
    [process.execPath, join(root, 'scripts/minicraft-build.ts'), directory, project!.napplet],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const deadline = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    const [code, detail] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0)
      throw new DiagnosticError('MINICRAFT_BUILD', 'MiniCraft browser build failed.', {
        operation: 'build MiniCraft browser assets',
        tool: 'bun',
        exitCode: code,
        target: directory,
        detail,
        recovery:
          'Address the compiler error above, then rerun bun run demo:minicraft. A killed build may have exceeded its 30-second deadline.',
      });
  } finally {
    clearTimeout(deadline);
  }
  return {
    directory,
    assets: {
      html: await Bun.file(join(directory, '.napplet/preview.html')).text(),
      client: await Bun.file(join(directory, '.napplet/client.js')).text(),
    },
  };
}
export async function startMinicraft(
  prepared: Awaited<ReturnType<typeof prepareMinicraft>>,
  port = 4180,
) {
  const backend = await localBackend(prepared.directory);
  try {
    const server = startPreviewServer(
      pathToFileURL(prepared.directory + '/'),
      port,
      false,
      prepared.assets,
      { network: 'local', backend: backend!.provider },
    );
    return {
      server,
      backend: backend!,
      close: async () => {
        await server.stop(true);
        await backend!.close();
      },
    };
  } catch (error) {
    await backend?.close();
    throw error;
  }
}
if (import.meta.main) {
  try {
    const prepared = await prepareMinicraft();
    const demo = await startMinicraft(prepared, Number(process.env.MINICRAFT_PORT ?? 4180));
    console.log('MiniCraft: ' + demo.server.url);
    console.log('Open a second tab/browser and join with a world code to build together.');
    console.log('Local data: ' + prepared.directory + '/.napplet-space/backend/');
    console.log('Temporary demo players stay in the host tab; public execution remains disabled.');
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await demo.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } catch (error) {
    console.error(formatDiagnostic(diagnose(error, 'start MiniCraft local demo')));
    process.exitCode = 1;
  }
}
