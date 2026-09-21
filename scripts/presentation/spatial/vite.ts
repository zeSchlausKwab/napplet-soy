import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { buildScene } from './build.ts';

/** Always prepare the scene from source, including a fresh checkout and VPS builds. */
export function storyAssets(): Plugin {
  const source = fileURLToPath(new URL('.', import.meta.url));
  let destination: string;
  return {
    name: 'napplet-collaboration-story',
    async configResolved(config) {
      destination = resolve(config.publicDir, 'story');
      await buildScene(destination);
    },
    configureServer(server) {
      server.watcher.add(source);
      let pending = Promise.resolve();
      const update = (path: string) => {
        if (!path.startsWith(source) || !/\.(ts|html|m4a|webp)$/.test(path)) return;
        pending = pending.then(async () => {
          try {
            await buildScene(destination);
            server.ws.send({ type: 'full-reload' });
          } catch (error) {
            server.config.logger.error(
              `Could not rebuild the collaboration story: ${String(error)}`,
            );
          }
        });
      };
      server.watcher.on('change', update);
      server.httpServer?.once('close', () => server.watcher.off('change', update));
    },
  };
}
