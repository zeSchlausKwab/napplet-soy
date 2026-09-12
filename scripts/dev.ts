import { chmod, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { seedExamples } from './seed';
import { refreshPublicCatalog } from './publicdev';

const root = resolve(import.meta.dir, '..');
const local = resolve(root, '.local');
const caddy = resolve(local, 'bin/caddy');
const pm2 = resolve(root, 'node_modules/pm2/bin/pm2');
const port = process.env.PORT ?? '3000';
const site = process.env.SPACE_SITE_ADDRESS ?? 'http://localhost:8080';
const command = process.argv[2];
const flags = process.argv.slice(3).filter((arg) => arg !== '--');
const publicdev = flags.includes('publicdev') || flags.includes('--publicdev');
const env = {
  ...process.env,
  PM2_HOME: resolve(local, 'pm2'),
  BUN_BIN: process.execPath,
  PORT: port,
  SPACE_RELEASE_DIR: root,
  SPACE_APP_NAME: 'napplet-local-web',
  SPACE_SITE_ADDRESS: site,
  SPACE_WEB_PORT: port,
  XDG_DATA_HOME: resolve(local, 'caddy/data'),
  XDG_CONFIG_HOME: resolve(local, 'caddy/config'),
  SPACE_SITE_ORIGIN:
    process.env.SPACE_SITE_ORIGIN || (command === 'production' ? site : `http://localhost:${port}`),
  SPACE_PUBLICDEV: publicdev ? '1' : '0',
  SPACE_PUBLICDEV_DIR: publicdev ? resolve(local, 'publicdev') : '',
};
async function prepare() {
  const seed = await seedExamples();
  console.log(
    `Local examples: ${seed.count} checked, ${seed.writes} files updated (${seed.milliseconds} ms).`,
  );
  if (publicdev) {
    const result = await refreshPublicCatalog(env.SPACE_PUBLICDEV_DIR, {
      refresh: flags.includes('--refresh'),
    });
    console.log(
      `Public dev: ${result.cache?.entries.length ?? 0} signed napplets from Nostr relays (${result.source}).`,
    );
    if ('error' in result)
      console.warn(`Public catalog: ${result.error}. Local examples remain available.`);
  }
}
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: root, env, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
}
async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function installCaddy() {
  if (await Bun.file(caddy).exists()) return;
  const platform =
    process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
  if (!platform || !arch) throw new Error('Local setup supports macOS/Linux on arm64 or x64.');
  const filename = `caddy_2.10.2_${platform}_${arch}.tar.gz`;
  const base = 'https://github.com/caddyserver/caddy/releases/download/v2.10.2';
  const [bytes, sums] = await Promise.all([
    fetchBytes(`${base}/${filename}`),
    fetchBytes(`${base}/caddy_2.10.2_checksums.txt`),
  ]);
  const line = new TextDecoder()
    .decode(sums)
    .split('\n')
    .find((line) => line.trim().split(/\s+/)[1] === filename);
  if (!line || createHash('sha512').update(bytes).digest('hex') !== line.split(/\s+/)[0])
    throw new Error('Caddy checksum mismatch');
  await mkdir(resolve(local, 'bin'), { recursive: true });
  await Bun.write(resolve(local, filename), bytes);
  await run(['tar', '-xzf', resolve(local, filename), '-C', resolve(local, 'bin'), 'caddy']);
  await chmod(caddy, 0o755);
}
async function doctor() {
  console.log(`Bun ${Bun.version} (pinned deployment: 1.3.11)`);
  console.log(
    `Caddy: ${(await Bun.file(caddy).exists()) ? 'installed locally' : 'run bun run dev:setup'}`,
  );
  try {
    const result = await fetch(`${site}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!result.ok) throw new Error(String(result.status));
    console.log('App behind Caddy:', await result.json());
  } catch {
    console.log(`No healthy app detected at ${site}. Use bun run dev:prod.`);
  }
}
try {
  if (flags.some((arg) => !['publicdev', '--publicdev', '--refresh'].includes(arg)))
    throw new Error('Supported dev flags: publicdev (or --publicdev), --refresh.');
  if (
    (publicdev || flags.includes('--refresh')) &&
    !['development', 'production'].includes(command)
  )
    throw new Error('Public dev flags apply to dev and dev:prod.');
  if (flags.includes('--refresh') && !publicdev) throw new Error('--refresh requires publicdev.');
  switch (command) {
    case 'development': {
      await prepare();
      const child = Bun.spawn(
        [process.execPath, '--bun', 'vite', '--host', '127.0.0.1', '--port', port],
        {
          cwd: resolve(root, 'apps/web'),
          env,
          stdout: 'inherit',
          stderr: 'inherit',
          stdin: 'inherit',
        },
      );
      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      process.exitCode = await child.exited;
      break;
    }
    case 'setup':
      await installCaddy();
      await doctor();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'down':
      // This PM2_HOME belongs only to this checkout; other PM2 applications are untouched.
      await run(['node', pm2, 'kill']);
      break;
    case 'production':
      await prepare();
      await installCaddy();
      await run(['bun', 'run', 'build']);
      // PM2 reload retains the old executable/cwd when an ecosystem definition changes.
      {
        const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-web'], {
          env,
          stdout: 'ignore',
          stderr: 'ignore',
        });
        await stop.exited;
      }
      await run(['node', pm2, 'start', 'infra/ecosystem.config.cjs', '--update-env']);
      // Replace only this project's proxy, so changed origins/ports take effect.
      {
        const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-caddy'], {
          env,
          stdout: 'ignore',
          stderr: 'ignore',
        });
        await stop.exited;
      }
      await run([
        'node',
        pm2,
        'start',
        caddy,
        '--name',
        'napplet-local-caddy',
        '--interpreter',
        'none',
        '--',
        'run',
        '--config',
        resolve(root, 'infra/Caddyfile'),
        '--adapter',
        'caddyfile',
      ]);
      await run(['node', pm2, 'save']);
      {
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            const r = await fetch(`${site}/api/health`, { signal: AbortSignal.timeout(1000) });
            if (r.ok) {
              ready = true;
              break;
            }
          } catch {}
          await Bun.sleep(1000);
        }
        if (!ready)
          throw new Error(
            'The PM2/Caddy stack did not become healthy. Check bun run dev:doctor and .local/pm2/logs.',
          );
      }
      console.log(`Production build under PM2 + Caddy: ${site}`);
      break;
    default:
      throw new Error('Expected development, setup, doctor, production, or down.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
