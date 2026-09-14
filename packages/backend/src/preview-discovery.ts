import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appReferences } from '../../protocol/src/preview';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import type { Filter } from 'nostr-tools';

let bundle: Promise<Blob> | undefined;
async function workerBundle() {
  bundle ??= (async () => {
    const result = await Bun.build({
      entrypoints: [new URL('./preview-relay-worker.ts', import.meta.url).pathname],
      target: 'node',
      format: 'esm',
      packages: 'external',
    });
    if (!result.success) throw new Error('Could not prepare the metadata worker');
    return result.outputs[0];
  })();
  return bundle;
}

/** Node preserves ws DNS/payload controls; Bun's HTTPS upgrade implementation is incompatible.
 * This worker has a finite lifetime and no signing credentials or browser state in its input. */
export async function discoverPreviewMetadata(
  manifests: SignedEvent[],
  relays: string[],
  signal: AbortSignal,
) {
  const linked = manifests.filter((manifest) => appReferences(manifest).length).slice(0, 100);
  if (!linked.length || signal.aborted) return [];
  const result = await relayWorker({ manifests: linked, relays }, signal);
  return verifiedResults(result);
}
function verifiedResults(result: unknown) {
  if (!Array.isArray(result) || result.length > 400) return [];
  return result.flatMap((event) => {
    try {
      return [verifiedEvent(event)];
    } catch {
      return [];
    }
  });
}
export async function discoverFromHints(relays: string[], filters: Filter[], signal: AbortSignal) {
  if (!relays.length || signal.aborted) return { events: [], complete: false };
  const result = (await relayWorker(
    { relays: relays.slice(0, 4), filters: filters.slice(0, 3) },
    signal,
  )) as { events?: unknown; complete?: boolean };
  return { events: verifiedResults(result?.events), complete: result?.complete === true };
}
async function relayWorker(payload: unknown, signal: AbortSignal): Promise<unknown> {
  const workerRoot = new URL('../../../.local/preview-workers/', import.meta.url).pathname;
  await mkdir(workerRoot, { recursive: true });
  const directory = await mkdtemp(resolve(workerRoot, 'query-'));
  try {
    const path = resolve(directory, 'worker.mjs');
    await Bun.write(path, await workerBundle());
    if (signal.aborted) return [];
    const child = Bun.spawn(['node', path], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS },
    });
    const stop = () => child.kill();
    const timeout = setTimeout(stop, 17000);
    signal.addEventListener('abort', stop, { once: true });
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
      const reader = child.stdout.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8 * 1024 * 1024) throw new Error('Metadata response exceeds size limit');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const code = await child.exited;
      if (signal.aborted) return [];
      if (code !== 0) throw new Error(`Metadata worker exited with status ${code}`);
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return result;
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
