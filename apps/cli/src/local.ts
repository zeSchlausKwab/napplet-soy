import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AccountError, type Network } from '../../../packages/identity/src/signer';
import { inspectProject, regularFile } from '../../../packages/publish/src/project';
import { browserEngine, browserInstalled } from './browser';
import { checkPublication } from './publish-check';
import { previewAssets } from './preview/assets';
import { startPreviewServer } from './preview/server';
import { gitAvailable } from './prerequisites';
import { version } from './distribution';
import { watchProject } from './toolchain';

export async function preview(
  directory: string,
  port: number,
  open: boolean,
  json: boolean,
  signal: AbortSignal,
) {
  const root = await realpath(directory);
  const config = await Bun.file(new URL('napplet.json', pathToFileURL(root + '/'))).json();
  const watcher = config.entry === 'dist/index.html' ? await watchProject(root, signal) : undefined;
  let server: ReturnType<typeof startPreviewServer> | undefined;
  const stop = () => server?.stop(true);
  try {
    server = startPreviewServer(pathToFileURL(root + '/'), port, false, await previewAssets());
    signal.addEventListener('abort', stop, { once: true });
    const response = await fetch(new URL('revision', server.url));
    if (!response.ok)
      throw new AccountError(
        'PROJECT_CONFIG',
        'Cannot preview this project. Check index.html and napplet.json.',
      );
    console.log(
      json
        ? JSON.stringify({ url: server.url.href })
        : `Local napplet preview: ${server.url}\nEdit ${watcher ? 'src/main.ts, src/styles.css or index.html' : 'index.html'}; the preview reloads after each build/save. Press Ctrl+C to stop.`,
    );
    if (open && !json) {
      const executable = Bun.which(process.platform === 'darwin' ? 'open' : 'xdg-open');
      if (executable) {
        const child = Bun.spawn([executable, server.url.href], {
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
        });
        child.unref();
      }
    }
    if (!signal.aborted)
      await Promise.race([
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
        ...(watcher
          ? [
              watcher.exited.then(() => {
                if (!signal.aborted)
                  throw new AccountError(
                    'BUILD_WATCH',
                    'The Vite build watcher stopped. See its output above.',
                  );
              }),
            ]
          : []),
      ]);
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    await watcher?.stop();
  }
}

export async function checkProject(directory: string, network: Network) {
  const root = await realpath(directory);
  const bytes = await regularFile(root, 'napplet.json', 16384);
  let config;
  try {
    config = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AccountError('PROJECT_CONFIG', 'Invalid napplet.json.');
  }
  // Inspection needs no signer. A declared creator is only a public reference.
  const { plan, contents } = await inspectProject(
    root,
    network,
    config.creator?.pubkey ?? '0'.repeat(64),
  );
  const { profile, browser, preview } = await checkPublication(contents);
  return {
    status: 'checked',
    profile,
    browser,
    previewBytes: preview.length,
    artifactHash: plan.artifactHash,
    sourceBytes: plan.sourceBytes,
  };
}

export async function doctor() {
  const git = await gitAvailable();
  let browser = 'not installed (downloaded on first check/publish, or run browser install)';
  if (await browserInstalled()) {
    try {
      const instance = await (
        await browserEngine()
      ).chromium.launch({ headless: true, timeout: 10000 });
      await instance.close();
      browser = 'ready';
    } catch {
      browser =
        'installed but cannot start; Linux needs Chromium system libraries (see https://napplet.soy/cli)';
    }
  }
  return {
    version,
    platform: `${process.platform}-${process.arch}`,
    git: git ? 'ready' : 'missing; install Git with your OS package manager',
    browser,
    credentials:
      process.platform === 'darwin'
        ? 'Uses your login Keychain; account check verifies the selected signer.'
        : 'Requires an unlocked desktop Secret Service (e.g. GNOME Keyring) and D-Bus session; account check verifies the selected signer.',
  };
}
