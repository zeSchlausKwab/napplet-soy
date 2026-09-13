import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

let bundle: Promise<Blob> | undefined;
async function workerBundle() {
  bundle ??= (async () => {
    const result = await Bun.build({
      entrypoints: [
        resolve(
          process.env.SPACE_RELEASE_DIR ?? process.cwd(),
          'packages/backend/src/public-http-worker.ts',
        ),
      ],
      target: 'node',
      format: 'esm',
      packages: 'external',
    });
    if (!result.success) throw new Error('Could not prepare the HTTPS worker');
    return result.outputs[0];
  })();
  return bundle;
}

/** The legacy Bun HTTPS implementation loses the TLS hostname with custom DNS.
 * Node runs the same guarded transport, with a bounded lifetime and no credentials. */
export async function fetchPublicBytesInNode(url: URL, signal: AbortSignal, maxBytes: number) {
  if (signal.aborted) throw new Error('Download cancelled');
  const root = resolve(process.env.SPACE_RELEASE_DIR ?? process.cwd(), '.local/http-workers');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'download-'));
  try {
    const path = join(directory, 'worker.mjs');
    await Bun.write(path, await workerBundle());
    if (signal.aborted) throw new Error('Download cancelled');
    const child = Bun.spawn(['node', path], {
      stdin: new Blob([JSON.stringify({ url: url.href, maxBytes })]),
      stdout: 'pipe',
      stderr: 'ignore',
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS },
    });
    const stop = () => child.kill('SIGKILL');
    const timeout = setTimeout(stop, 30000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Download exceeds byte limit');
        chunks.push(chunk);
      }
      if ((await child.exited) !== 0 || signal.aborted)
        throw new Error('Public HTTPS download failed');
      return new Uint8Array(Buffer.concat(chunks, size));
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
      if (child.exitCode === null) stop();
      await child.exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
