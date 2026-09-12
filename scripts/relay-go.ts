import { cp, chmod, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dir, '..');
const cwd = resolve(root, 'services/relay');
const env = { ...process.env, GOTOOLCHAIN: 'go1.25.0', CGO_ENABLED: '1' };
const version = 'v0.0.0-20260902034142-316ef6591fa2';

/** Apply checksum-guarded fixes in an isolated module copy. Never edit Go's shared module cache. */
export async function relayGo(args: string[]) {
  const go = Bun.which('go');
  if (!go)
    throw new Error(
      'The relay needs Go 1.21+ and a C compiler. Install Go, then rerun bun run dev:setup. Builds use pinned Go 1.25.0.',
    );
  const download = Bun.spawn([go, 'mod', 'download', '-json', `fiatjaf.com/nostr@${version}`], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const output = await new Response(download.stdout).text();
  if ((await download.exited) !== 0)
    throw new Error('Could not download the pinned relay dependency.');
  const module = JSON.parse(output) as { Dir: string };
  const directory = resolve(root, '.local/relay-build');
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(resolve(directory, 'build-'));
  try {
    const patchedModule = resolve(scratch, 'nostr');
    await cp(module.Dir, patchedModule, { recursive: true });
    const writable = Bun.spawn(['chmod', '-R', 'u+w', patchedModule]);
    if ((await writable.exited) !== 0)
      throw new Error('Could not prepare the isolated relay dependency copy.');
    const patches = [
      {
        file: 'event.go',
        sha256: '41f74d5ac62e18df2bd84c829e44ef71716482e45d462800e1c04613cde9afe1',
        apply: (source: string) =>
          source
            .replaceAll(
              'base := uintptr(unsafe.Pointer(unsafe.StringData(s)))',
              'base := unsafe.Pointer(unsafe.StringData(s))',
            )
            .replaceAll('unsafe.Pointer(base + uintptr(i))', 'unsafe.Add(base, i)'),
      },
      {
        file: 'eventstore/lmdb/query.go',
        sha256: '962207dffd965840af5f28f0236a944004101ab36fc1b53d51c3501b5f38d335',
        // LMDB yields incrementally, but the upstream batch allocation scales with the full query limit.
        apply: (source: string) =>
          source.replace(
            'batchSizePerQuery := internal.BatchSizePerNumberOfQueries(limit, len(queries))',
            'batchSizePerQuery := min(500, internal.BatchSizePerNumberOfQueries(limit, len(queries)))',
          ),
      },
    ];
    for (const patch of patches) {
      const path = resolve(module.Dir, patch.file);
      const source = await Bun.file(path).text();
      if (createHash('sha256').update(source).digest('hex') !== patch.sha256)
        throw new Error(
          `Pinned relay source changed: ${patch.file}. Review the compatibility patch before upgrading.`,
        );
      const patched = resolve(patchedModule, patch.file);
      await chmod(patched, 0o644);
      await Bun.write(patched, patch.apply(source));
    }
    const modfile = resolve(scratch, 'go.mod');
    await Bun.write(
      modfile,
      (await Bun.file(resolve(cwd, 'go.mod')).text()) +
        `\nreplace fiatjaf.com/nostr => ${JSON.stringify(patchedModule)}\n`,
    );
    await Bun.write(resolve(scratch, 'go.sum'), await Bun.file(resolve(cwd, 'go.sum')).bytes());
    const child = Bun.spawn([go, args[0], '-modfile', modfile, ...args.slice(1)], {
      cwd,
      env,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await child.exited) !== 0)
      throw new Error(
        `Relay ${args[0]} failed. Build prerequisites: Go and a C compiler (Xcode command-line tools on macOS, build-essential on Debian/Ubuntu).`,
      );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
if (import.meta.main) await relayGo(process.argv.slice(2));
