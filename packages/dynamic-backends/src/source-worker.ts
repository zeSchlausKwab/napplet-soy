import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceGit } from '../../grasp/src/client';
import { LIMITS, manifestSchema, sourceSchema } from './contracts';
import { blob } from './source-files';
import { jsonLines } from './worker-process';
import { ISOLATION } from './sandbox';
import { diagnose } from '../../diagnostics/src';

for await (const message of jsonLines(Bun.stdin.stream(), ISOLATION.sourcePackBytes * 2)) {
  const directory = await mkdtemp(join(tmpdir(), 'source-'));
  try {
    const source = sourceSchema.parse(message.source);
    const pack = Buffer.from(message.pack, 'base64');
    if (pack.length > ISOLATION.sourcePackBytes || pack.subarray(0, 4).toString() !== 'PACK')
      throw new Error('Invalid or oversized Git pack.');
    await sourceGit(directory, ['init', '--bare']);
    const packPath = join(directory, 'objects/pack/input.pack');
    await writeFile(packPath, pack);
    // No checkout, hooks, submodules, object alternates or network. Expansion is in bounded tmpfs.
    await sourceGit(directory, [
      'index-pack',
      '--strict',
      '--max-input-size=' + ISOLATION.sourcePackBytes,
      packPath,
    ]);
    if ((await sourceGit(directory, ['rev-parse', source.commit + '^{commit}'])) !== source.commit)
      throw new Error('Requested source commit is missing.');
    const files: Record<string, string> = Object.create(null);
    files[source.manifest] = await blob(directory, source.commit, source.manifest, 8192);
    const manifest = manifestSchema.parse(JSON.parse(files[source.manifest]));
    files[manifest.entry] = await blob(
      directory,
      source.commit,
      manifest.entry,
      LIMITS.sourceBytes,
    );
    files[manifest.schemas] = await blob(
      directory,
      source.commit,
      manifest.schemas,
      LIMITS.schemaBytes,
    );
    process.stdout.write(JSON.stringify({ type: 'result', value: files }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        type: 'failure',
        message: diagnose(error, 'read backend source pack').message,
      }) + '\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
