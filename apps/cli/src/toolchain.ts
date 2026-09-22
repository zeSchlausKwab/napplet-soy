import { DiagnosticError, ToolOutput } from '../../../packages/diagnostics/src';
import { validateAssets } from '../../../packages/assets/src';
import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import pins from '../vendor/toolchain.json';
import { AccountError } from '../../../packages/identity/src/signer';
import { backendProject } from './backend';
import { selectNodeToolchain } from './toolchain-platform';

export const toolchainCache = () =>
  resolve(
    process.env.SPACE_TOOLCHAIN_CACHE ||
      join(
        process.env.XDG_CACHE_HOME ||
          (process.platform === 'darwin'
            ? join(homedir(), 'Library/Caches')
            : join(homedir(), '.cache')),
        'napplet-space/toolchains',
      ),
  );

function environment() {
  const env: Record<string, string> = {};
  for (const key of [
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'XDG_CACHE_HOME',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'PLAYWRIGHT_BROWSERS_PATH',
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  return env;
}
async function command(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  signal?: AbortSignal,
  capture = false,
  operation = 'run project tool',
) {
  if (signal?.aborted) throw new AccountError('BUILD_CANCELLED', 'Project setup/build cancelled.');
  const tool = args[1]?.endsWith('/pnpm.cjs') ? 'pnpm' : args[0].split('/').pop() || 'project tool';
  let child;
  try {
    child = Bun.spawn(args, {
      cwd,
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });
  } catch (cause) {
    throw new DiagnosticError('PROJECT_TOOL_START', 'Could not start the project tool.', {
      operation,
      tool,
      cause,
    });
  }
  const kill = (kind: NodeJS.Signals) => {
    try {
      process.kill(-child.pid, kind);
    } catch {
      child.kill(kind);
    }
  };
  let cancelled = false;
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    cancelled = true;
    kill('SIGTERM');
    cancellationTimer ??= setTimeout(() => kill('SIGKILL'), 500);
  };
  signal?.addEventListener('abort', stop, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    kill('SIGKILL');
  }, 300000);
  const stdoutLog = new ToolOutput((text) => process.stderr.write(text));
  const stderrLog = new ToolOutput((text) => process.stderr.write(text));
  let output = '';
  async function drain(stream: ReadableStream<Uint8Array>, stdout: boolean) {
    for await (const bytes of stream) {
      if (capture && stdout) {
        output += new TextDecoder().decode(bytes);
        if (output.length > 2 * 1024 * 1024) {
          kill('SIGKILL');
          throw new DiagnosticError(
            'PROJECT_TOOL_OUTPUT',
            'Tool output exceeds the 2 MiB capture limit.',
            { operation, tool },
          );
        }
      } else (stdout ? stdoutLog : stderrLog).push(bytes);
    }
    (stdout ? stdoutLog : stderrLog).finish();
  }
  try {
    const [code] = await Promise.all([
      child.exited,
      drain(child.stdout, true),
      drain(child.stderr, false),
    ]);
    if (cancelled) throw new AccountError('BUILD_CANCELLED', 'Project setup/build cancelled.');
    if (timedOut || code)
      throw new DiagnosticError(
        timedOut ? 'PROJECT_TOOL_TIMEOUT' : 'PROJECT_TOOL',
        timedOut
          ? 'Project tool exceeded its five-minute deadline.'
          : 'The project tool reported a failure.',
        {
          operation,
          tool,
          exitCode: code,
          detail: stderrLog.text || stdoutLog.text,
          recovery:
            'Fix the tool error shown above and retry setup/build or the requested project command.',
        },
      );
    return output;
  } finally {
    clearTimeout(timeout);
    clearTimeout(cancellationTimer);
    signal?.removeEventListener('abort', stop);
    if (child.exitCode === null) kill('SIGKILL');
  }
}

async function download(url: string, target: string, digest: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
  }).catch((cause) => {
    throw new DiagnosticError('TOOLCHAIN_DOWNLOAD', 'Could not download the project toolchain.', {
      operation: 'download project toolchain',
      target: url,
      cause,
    });
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new DiagnosticError('TOOLCHAIN_DOWNLOAD', 'Toolchain download failed.', {
      operation: 'download project toolchain',
      target: url,
      status: response.status,
      recovery: 'Check connectivity and the download service, then retry soyli setup.',
    });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > 100 * 1024 * 1024) throw new Error('Toolchain download exceeds limit');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  const valid = digest.startsWith('sha512-')
    ? `sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}` === digest
    : new Bun.CryptoHasher('sha256').update(bytes).digest('hex') === digest;
  if (!valid)
    throw new AccountError(
      'TOOLCHAIN_CHECKSUM',
      'Downloaded toolchain did not match its release checksum. Nothing was installed.',
    );
  await Bun.write(target, bytes);
}

let preparing: Promise<Awaited<ReturnType<typeof prepare>>> | undefined;
async function prepare(signal?: AbortSignal) {
  const platform = `${process.platform}-${process.arch}`;
  const macVersion =
    process.platform === 'darwin'
      ? (
          await command(
            ['/usr/bin/sw_vers', '-productVersion'],
            process.cwd(),
            environment(),
            signal,
            true,
          )
        ).trim()
      : undefined;
  const selected = selectNodeToolchain(process.platform, process.arch, macVersion);
  const node = selected.archive;
  if (!node)
    throw new AccountError(
      'TOOLCHAIN_PLATFORM',
      'The project toolchain supports macOS and glibc Linux on ARM64/x64.',
    );
  const root = toolchainCache();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const nodeRoot = join(root, node.directory),
    pnpmRoot = join(root, `pnpm-${pins.pnpm.version}`);
  const nodeBin = join(nodeRoot, 'bin/node'),
    pnpm = join(pnpmRoot, 'package/bin/pnpm.cjs');
  const baseEnv = { ...environment(), PATH: '/usr/bin:/bin' };
  async function ensure(
    destination: string,
    executable: string,
    url: string,
    digest: string,
    prefix: string,
  ) {
    const current = await lstat(executable).catch(() => null);
    if (current?.isFile() && !current.isSymbolicLink()) return;
    if (await lstat(destination).catch(() => null))
      throw new AccountError(
        'TOOLCHAIN_CACHE',
        `Incomplete toolchain cache at ${destination}; move it aside and retry setup.`,
      );
    const stage = await mkdtemp(join(root, '.download-'));
    try {
      process.stderr.write(`Preparing ${prefix} (cached for future projects)…\n`);
      const archive = join(stage, 'archive.tar.gz');
      await download(url, archive, digest, signal);
      const entries = (
        await command(['/usr/bin/tar', '-tzf', archive], stage, baseEnv, signal, true)
      )
        .trim()
        .split('\n');
      if (
        entries.some(
          (path) =>
            !path.startsWith(prefix + '/') ||
            path.split('/').some((part) => part === '..' || part === '.'),
        )
      )
        throw new Error('Unexpected toolchain archive path');
      await command(['/usr/bin/tar', '-xzf', archive, '-C', stage], stage, baseEnv, signal);
      if (prefix === 'package') {
        await rm(archive);
        try {
          await rename(stage, destination);
        } catch (error) {
          if (!(await Bun.file(executable).exists())) throw error;
        }
      } else {
        try {
          await rename(join(stage, prefix), destination);
        } catch (error) {
          if (!(await Bun.file(executable).exists())) throw error;
        }
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  await ensure(nodeRoot, nodeBin, node.url, node.sha256, node.directory);
  await ensure(pnpmRoot, pnpm, pins.pnpm.url, pins.pnpm.integrity, 'package');
  const bin = join(root, `bin-${selected.version}-${pins.pnpm.version}-${platform}`);
  await mkdir(bin, { recursive: true });
  const pnpmLink = join(bin, 'pnpm');
  if (!(await lstat(pnpmLink).catch(() => null))) await symlink(pnpm, pnpmLink);
  await chmod(pnpm, 0o755);
  const env = {
    ...environment(),
    PATH: `${dirname(nodeBin)}:${bin}:${process.env.PATH || '/usr/bin:/bin'}`,
    PNPM_HOME: bin,
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(root, 'browsers'),
  };
  if (
    (await command([nodeBin, '--version'], root, env, signal, true)).trim() !==
    `v${selected.version}`
  )
    throw new AccountError('TOOLCHAIN_VERSION', 'Unexpected cached Node version.');
  return { nodeBin, pnpm, env };
}

function prepared(signal?: AbortSignal) {
  return (preparing ??= prepare(signal).catch((error) => {
    preparing = undefined;
    throw error;
  }));
}

/** The pinned runtime also runs bundled Node tools; never use a project/global Node. */
export async function managedNode(signal?: AbortSignal) {
  return (await prepared(signal)).nodeBin;
}

export async function projectTool(directory: string, args: string[], signal?: AbortSignal) {
  const tools = await prepared(signal);
  const operation =
    args[0] === 'install'
      ? 'install project dependencies'
      : args[0] === 'run' && args[1] === 'build'
        ? 'build napplet'
        : 'run project command';
  return command(
    [tools.nodeBin, tools.pnpm, ...args],
    resolve(directory),
    tools.env,
    signal,
    false,
    operation,
  );
}

export async function setupProject(directory: string, signal?: AbortSignal) {
  const pkg = await Bun.file(join(directory, 'package.json')).json();
  if (pkg.packageManager !== `pnpm@${pins.pnpm.version}`)
    throw new AccountError(
      'PROJECT_TOOLCHAIN',
      `This CLI supports the upstream pnpm@${pins.pnpm.version} pin. Use your chosen package manager explicitly for a different toolchain.`,
    );
  await projectTool(directory, ['install', '--frozen-lockfile', '--ignore-scripts'], signal);
}

export async function buildProject(directory: string, signal?: AbortSignal) {
  await validateAssets(directory);
  await backendProject(directory);
  if (!(await Bun.file(join(directory, 'node_modules/.modules.yaml')).exists()))
    await setupProject(directory, signal);
  await projectTool(directory, ['run', 'build'], signal);
}

export async function installConformanceBrowser(directory: string, signal?: AbortSignal) {
  const tools = await prepared(signal);
  const projectRequire = createRequire(join(resolve(directory), 'package.json'));
  const conformanceRequire = createRequire(
    projectRequire.resolve('@napplet/conformance-cli/package.json'),
  );
  const cli = join(dirname(conformanceRequire.resolve('playwright/package.json')), 'cli.js');
  await command(
    [tools.nodeBin, cli, 'install', '--only-shell', 'chromium'],
    directory,
    tools.env,
    signal,
  );
}

/** Watch source through Vite's actual single-file plugin; keep host preview separate. */
export async function watchProject(directory: string, signal: AbortSignal) {
  await buildProject(directory, signal);
  const tools = await preparing!;
  const child = Bun.spawn([tools.nodeBin, tools.pnpm, 'exec', 'vite', 'build', '--watch'], {
    cwd: directory,
    env: tools.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  });
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (kind: NodeJS.Signals) => {
    try {
      process.kill(-child.pid, kind);
    } catch {
      child.kill(kind);
    }
  };
  const stop = () => {
    kill('SIGTERM');
    forceTimer ??= setTimeout(() => kill('SIGKILL'), 500);
  };
  signal.addEventListener('abort', stop, { once: true });
  let ready!: () => void;
  const firstBuild = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let output = '';
  const stdoutLog = new ToolOutput((text) => process.stderr.write(text));
  const stderrLog = new ToolOutput((text) => process.stderr.write(text));
  const failure = (message: string) =>
    new DiagnosticError('BUILD_WATCH', message, {
      operation: 'watch project builds',
      tool: 'Vite',
      exitCode: child.exitCode ?? undefined,
      detail: stderrLog.text || stdoutLog.text,
      recovery: 'Fix the reported build error and restart soyli dev.',
    });
  const drain = async (stream: ReadableStream<Uint8Array>, log: ToolOutput) => {
    for await (const bytes of stream) {
      log.push(bytes);
      // Vite's pinned watch reporter emits this after the single-file plugin completes.
      output = (output + new TextDecoder().decode(bytes)).slice(-4096);
      if (/built in \d+ms/.test(output)) ready();
    }
    log.finish();
  };
  const finished = Promise.all([
    child.exited,
    drain(child.stdout, stdoutLog),
    drain(child.stderr, stderrLog),
  ]).finally(() => {
    signal.removeEventListener('abort', stop);
    clearTimeout(forceTimer);
  });
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal.aborted) stop();
    await Promise.race([
      firstBuild,
      finished.then(() => {
        throw failure('The Vite watcher stopped before its first build.');
      }),
      new Promise<never>((_, reject) => {
        startupTimer = setTimeout(
          () => reject(failure('Timed out waiting for the first Vite build.')),
          60000,
        );
      }),
    ]);
  } catch (error) {
    stop();
    await finished;
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
  return {
    stop: async () => {
      stop();
      await finished;
      clearTimeout(forceTimer);
    },
    exited: finished,
    failure: () => failure('The Vite build watcher stopped.'),
  };
}
