import { chmod, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildGrasp, graspBinary, graspVersion } from './grasp-build';
import { graspHealth, localGraspOrigin, localGraspInstance, seedLocalGrasp } from './grasp';
import { seedExamples } from './seed';
import { refreshPublicCatalog } from './publicdev';
import {
  buildBlossom,
  blossomBundle,
  localBlossomOrigin,
  localBlossomInstance,
  seedLocalBlossom,
} from './blossom';
import {
  buildRelay,
  localRelayInstance,
  localRelayUrl,
  relayBinary,
  seedLocalRelay,
} from './relay';

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
  SPACE_SERVICE_PREFIX: 'napplet-local',
  SPACE_RELAY_BIN: relayBinary,
  SPACE_RELAY_BIND: '127.0.0.1:19347',
  SPACE_RELAY_DATA: resolve(local, 'services/relay'),
  SPACE_RELAY_ORIGIN: `${site}/relay`,
  SPACE_RELAY_INSTANCE: localRelayInstance,
  SPACE_BLOSSOM_BUNDLE: blossomBundle,
  SPACE_BLOSSOM_ORIGIN: localBlossomOrigin,
  SPACE_BLOSSOM_PORT: '19348',
  SPACE_BLOSSOM_LOCAL: '1',
  SPACE_BLOSSOM_DATA: resolve(local, 'services/blossom'),
  SPACE_BLOSSOM_INSTANCE: localBlossomInstance,
  SPACE_GRASP_BIN: graspBinary,
  SPACE_GRASP_BIND: '127.0.0.1:19349',
  SPACE_GRASP_ORIGIN: localGraspOrigin,
  SPACE_GRASP_LOCAL: '1',
  SPACE_GRASP_DATA: resolve(local, 'services/grasp'),
  SPACE_GRASP_INSTANCE: localGraspInstance,
  SPACE_SITE_ADDRESS: site,
  SPACE_WEB_PORT: port,
  XDG_DATA_HOME: resolve(local, 'caddy/data'),
  XDG_CONFIG_HOME: resolve(local, 'caddy/config'),
  SPACE_SITE_ORIGIN:
    process.env.SPACE_SITE_ORIGIN || (command === 'production' ? site : `http://localhost:${port}`),
  SPACE_PUBLICDEV: publicdev ? '1' : '0',
  SPACE_PUBLICDEV_DIR: publicdev ? resolve(local, 'publicdev') : '',
  SPACE_INDEX_DIR: resolve(local, 'services/index'),
  SPACE_INDEX_RELAYS: localRelayUrl,
  SPACE_INDEX_LOCAL_BLOSSOM: localBlossomOrigin,
};
async function prepare() {
  await startRelay();
  await startBlossom();
  await startGrasp();
  await startProxy();
  const seed = await seedExamples();
  console.log(
    `Local examples: ${seed.count} checked, ${seed.writes} files updated (${seed.milliseconds} ms).`,
  );
  const blossomSeed = await seedLocalBlossom();
  console.log(
    `Local Blossom: ${blossomSeed.blobs} blobs verified, ${blossomSeed.uploaded} uploaded (${blossomSeed.milliseconds} ms).`,
  );
  const relaySeed = await seedLocalRelay();
  console.log(
    `Local relay: ${relaySeed.events} signed events checked, ${relaySeed.published} published (${relaySeed.milliseconds} ms).`,
  );
  const sourceSeed = await seedLocalGrasp();
  console.log(
    `Local Git: ${sourceSeed.repositories} repositories checked, ${sourceSeed.published} published (${sourceSeed.milliseconds} ms).`,
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
  // The same persistent worker runs under PM2 in development and on the VPS.
  const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-indexer'], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await stop.exited;
  await run(['node', pm2, 'start', 'infra/indexer.ecosystem.config.cjs', '--update-env']);
}
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: root, env, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
}
async function relayHealth() {
  try {
    const response = await fetch('http://127.0.0.1:19347/health', {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { service: string; build: string; instance: string };
  } catch {
    return null;
  }
}
async function startRelay() {
  const build = await buildRelay();
  const health = await relayHealth();
  if (health && (health.service !== 'relay' || health.instance !== localRelayInstance))
    throw new Error(
      'Port 19347 belongs to another service or checkout; stop that checkout before starting this relay.',
    );
  if (health?.build === build) return;
  const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-relay'], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await stop.exited;
  await run(['node', pm2, 'start', 'infra/relay.ecosystem.config.cjs', '--update-env']);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await relayHealth();
    if (result?.build === build && result.instance === localRelayInstance) return;
    await Bun.sleep(500);
  }
  throw new Error(
    'Relay did not become ready. Check .local/pm2/logs/napplet-local-relay-error.log.',
  );
}
async function blossomHealth() {
  try {
    const response = await fetch(`${localBlossomOrigin}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { service: string; build: string; instance: string };
  } catch {
    return null;
  }
}
async function startBlossom() {
  const build = await buildBlossom();
  const health = await blossomHealth();
  if (health && (health.service !== 'blossom' || health.instance !== localBlossomInstance))
    throw new Error(
      'Port 19348 belongs to another service or checkout; stop that checkout before starting this Blossom.',
    );
  if (health?.build === build) return;
  const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-blossom'], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await stop.exited;
  await run(['node', pm2, 'start', 'infra/blossom.ecosystem.config.cjs', '--update-env']);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await blossomHealth();
    if (result?.build === build && result.instance === localBlossomInstance) return;
    await Bun.sleep(500);
  }
  throw new Error(
    'Blossom did not become ready. Check .local/pm2/logs/napplet-local-blossom-error.log.',
  );
}
async function startGrasp() {
  await buildGrasp();
  const version = await graspVersion();
  const name = `Napplet Space Git (${localGraspInstance})`;
  const configuration = createHash('sha256')
    .update(await Bun.file(resolve(root, 'services/grasp/config.cjs')).text())
    .update(await Bun.file(resolve(root, 'infra/grasp.ecosystem.config.cjs')).text())
    .update(JSON.stringify([env.SPACE_GRASP_ORIGIN, env.SPACE_GRASP_BIND, env.SPACE_GRASP_DATA]))
    .digest('hex');
  const marker = Bun.file(resolve(env.SPACE_GRASP_DATA, 'local.configuration'));
  const health = await graspHealth('http://127.0.0.1:19349');
  if (health && health.name !== name)
    throw new Error('Port 19349 belongs to another GRASP instance; stop that checkout first.');
  if (
    health?.version === version &&
    (await marker.exists()) &&
    (await marker.text()) === configuration
  )
    return;
  await mkdir(env.SPACE_GRASP_DATA, { recursive: true, mode: 0o700 });
  const stop = Bun.spawn(['node', pm2, 'delete', 'napplet-local-grasp'], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await stop.exited;
  await run(['node', pm2, 'start', 'infra/grasp.ecosystem.config.cjs', '--update-env']);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await graspHealth('http://127.0.0.1:19349');
    if (result?.version === version && result.name === name) {
      await Bun.write(marker, configuration);
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    'GRASP did not become ready. Check .local/pm2/logs/napplet-local-grasp-error.log.',
  );
}
async function startProxy() {
  await installCaddy();
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
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await graspHealth(localGraspOrigin);
    if (
      result?.name === `Napplet Space Git (${localGraspInstance})` &&
      result.version === (await graspVersion())
    )
      return;
    await Bun.sleep(500);
  }
  throw new Error('The local Caddy Git origin did not become ready. Check .local/pm2/logs.');
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
  console.log(
    `Relay: ${(await relayHealth()) ? `ready at ${localRelayUrl}` : 'not running; use bun run dev or dev:prod'}`,
  );
  console.log(
    `Blossom: ${(await blossomHealth()) ? `ready at ${localBlossomOrigin}` : 'not running; use bun run dev or dev:prod'}`,
  );
  console.log(
    `Git/GRASP: ${(await graspHealth(localGraspOrigin)) ? `ready at ${localGraspOrigin}` : 'not running; use bun run dev or dev:prod'}`,
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
      await buildRelay();
      await buildBlossom();
      await buildGrasp();
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
