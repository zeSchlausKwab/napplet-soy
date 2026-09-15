import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AudioStream } from './audio-stream';

let bundle: Promise<Blob> | undefined;
/** Node compatibility transport for the legacy VPS runtime; stdout stays backpressured. */
export async function openAudioInNode(url: URL, signal: AbortSignal): Promise<AudioStream> {
  bundle ??= (async () => {
    const built = await Bun.build({
      entrypoints: [
        resolve(
          process.env.SPACE_RELEASE_DIR ?? process.cwd(),
          'packages/backend/src/audio-stream-worker.ts',
        ),
      ],
      target: 'node',
      format: 'esm',
      packages: 'external',
    });
    if (!built.success) throw new Error('Could not prepare audio transport');
    return built.outputs[0];
  })();
  const root = resolve(process.env.SPACE_RELEASE_DIR ?? process.cwd(), '.local/http-workers');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'audio-'));
  let stop: (() => void) | undefined;
  try {
    const path = join(directory, 'worker.mjs');
    await Bun.write(path, await bundle);
    if (signal.aborted) throw new Error('Audio cancelled');
    const child = Bun.spawn(['node', path], {
      stdin: new Blob([JSON.stringify({ url: url.href })]),
      stdout: 'pipe',
      stderr: 'ignore',
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS },
    });
    stop = () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const timeout = setTimeout(stop, 2 * 60 * 60 * 1000 + 1000);
    void child.exited.finally(async () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop!);
      await rm(directory, { recursive: true, force: true });
    });
    const reader = child.stdout.getReader();
    let initial = new Uint8Array(0),
      newline = -1;
    while (newline < 0) {
      const next = await reader.read();
      if (next.done || initial.length > 256) throw new Error('Audio transport failed');
      const bytes = new Uint8Array(initial.length + next.value.length);
      bytes.set(initial);
      bytes.set(next.value, initial.length);
      initial = bytes;
      newline = initial.indexOf(10);
    }
    const mime = new TextDecoder().decode(initial.slice(0, newline));
    if (!['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(mime))
      throw new Error('Invalid audio response');
    let remainder = initial.slice(newline + 1);
    return {
      mime,
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (remainder.length) {
              controller.enqueue(remainder);
              remainder = new Uint8Array(0);
              return;
            }
            const next = await reader.read();
            if (next.done) {
              if (await child.exited) throw new Error('Audio transport failed');
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            stop!();
            controller.error(error);
          }
        },
        cancel: async () => {
          stop!();
          await reader.cancel().catch(() => {});
        },
      }),
    };
  } catch (error) {
    stop?.();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
