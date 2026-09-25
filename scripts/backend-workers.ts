import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export async function buildBackendWorkers(directory: string) {
  await mkdir(directory, { recursive: true });
  for (const name of ['worker', 'source-worker', 'sandbox-probe', 'source-http']) {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, '../packages/dynamic-backends/src', name + '.ts')],
      target: name === 'source-http' ? 'node' : 'bun',
      format: 'esm',
      minify: true,
    });
    if (!result.success) throw new Error(result.logs.join('\n'));
    await Bun.write(join(directory, name + '.js'), result.outputs[0]);
  }
}
if (import.meta.main)
  await buildBackendWorkers(resolve(process.argv[2] || '.local/backend-workers'));
