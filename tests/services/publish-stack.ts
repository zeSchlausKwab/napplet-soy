import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlossom } from '../../services/blossom/server';
import { buildRelay } from '../../scripts/relay';
import { buildGrasp, graspBinary } from '../../scripts/grasp-build';
import { graspEnvironment } from '../../scripts/grasp';
export async function stack() {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-publish-services-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let blossom: Awaited<ReturnType<typeof createBlossom>> | undefined;
  async function start(binary: string, data: string, env: Record<string, string>, pattern: RegExp) {
    await mkdir(data, { recursive: true });
    const child = Bun.spawn([binary], {
      cwd: data,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const reader = child.stdout.getReader();
    let output = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) throw new Error(`Service did not start: ${output}`);
        output += new TextDecoder().decode(part.value);
        const port = output.match(pattern)?.[1];
        if (port) return `http://127.0.0.1:${port}`;
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
      void (async () => {
        for await (const _ of child.stdout) {
          /* drain */
        }
      })();
    }
  }
  async function close() {
    await blossom?.close(true);
    for (const child of children) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      await child.exited;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await buildGrasp();
    const relayBinary = join(directory, 'relay');
    await buildRelay(relayBinary);
    const data = join(directory, 'grasp');
    const grasp = await start(
      graspBinary,
      data,
      {
        ...graspEnvironment({
          directory: data,
          origin: 'http://127.0.0.1:1',
          local: true,
          instance: 'publish-test',
          bind: '127.0.0.1:0',
        }),
        NGIT_DOMAIN: '',
      },
      /Starting HTTP server on 127\.0\.0\.1:(\d+)/,
    );
    const relay = await start(
      relayBinary,
      join(directory, 'relay-state'),
      {
        SPACE_SERVICE_BIND: '127.0.0.1:0',
        SPACE_SERVICE_DATA: join(directory, 'relay-state'),
        SPACE_SERVICE_URL: 'http://127.0.0.1/relay',
        SPACE_SERVICE_INSTANCE: 'publish-test',
      },
      /listening on http:\/\/127\.0\.0\.1:(\d+)/,
    );
    blossom = await createBlossom({
      directory: join(directory, 'blobs'),
      origin: 'http://127.0.0.1:19348',
      local: true,
      port: 0,
      instance: 'publish-test',
      build: 'test',
    });
    return {
      directory,
      targets: {
        relay: `${relay.replace('http:', 'ws:')}/relay`,
        grasp,
        blossom: `http://127.0.0.1:${blossom.server.port}`,
        // No ambient dev website may affect this storage/publication-only test.
        site: 'http://127.0.0.1:1',
        mirrors: [],
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
