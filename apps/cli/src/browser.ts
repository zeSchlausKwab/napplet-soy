import { access, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountError } from '../../../packages/identity/src/signer';
import { playwrightDirectory, standalone } from './distribution';

type Playwright = Pick<typeof import('@playwright/test'), 'chromium'>;
let engine: Playwright | undefined;

export function browserCache() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH === '0')
    return join(playwrightDirectory(), '.local-browsers');
  return (
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(
      process.env.XDG_CACHE_HOME ||
        (process.platform === 'darwin'
          ? join(homedir(), 'Library/Caches')
          : join(homedir(), '.cache')),
      'napplet-space/browsers',
    )
  );
}
export async function browserEngine(): Promise<Playwright> {
  if (standalone) process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
  return (engine ??= (await import(
    pathToFileURL(join(playwrightDirectory(), 'index.mjs')).href
  )) as Playwright);
}
export async function browserInstalled(video = false, interactive = false) {
  await browserEngine();
  // The pinned Playwright registry knows each platform's headless-shell path.
  const require = createRequire(pathToFileURL(join(playwrightDirectory(), 'index.js')));
  const registry = require('./lib/coreBundle.js').registry.registry;
  const executables = [
    interactive ? 'chromium' : 'chromium-headless-shell',
    ...(video ? ['ffmpeg'] : []),
  ].map((name) => registry.findExecutable(name)?.executablePath());
  return (
    await Promise.all(
      executables.map((executable) =>
        executable
          ? access(executable).then(
              () => true,
              () => false,
            )
          : false,
      ),
    )
  ).every(Boolean);
}
export async function installBrowser(
  progress = (message: string) => process.stderr.write(message + '\n'),
  video = false,
  interactive = false,
) {
  if (await browserInstalled(video, interactive)) return;
  const cwd = browserCache();
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  progress('Downloading the pinned Chromium check browser. It is cached for future publications.');
  const env: Record<string, string> = {};
  for (const key of [
    'PATH',
    'HOME',
    'XDG_CACHE_HOME',
    'TMPDIR',
    'TEMP',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  if (standalone) env.BUN_BE_BUN = '1';
  if (process.env.PLAYWRIGHT_BROWSERS_PATH)
    env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  // Run only our shipped Playwright installer, with no project scripts or signing material.
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      join(playwrightDirectory(), 'cli.js'),
      'install',
      ...(interactive ? [] : ['--only-shell']),
      'chromium',
    ],
    {
      cwd,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const bytes of stream) process.stderr.write(bytes);
  };
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5 * 60_000);
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const [code] = await Promise.all([child.exited, drain(child.stdout), drain(child.stderr)]);
    if (code !== 0 || !(await browserInstalled(video, interactive))) throw new Error();
  } catch {
    throw new AccountError(
      'BROWSER_INSTALL',
      'Browser setup failed. Check your network and retry soyli browser install. Linux may also need system browser libraries; doctor explains the supported environment.',
    );
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
