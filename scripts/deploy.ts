import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export function validateTarget(host: string | undefined, domain: string | undefined) {
  if (!host || !/^(?:[a-z_][a-z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host))
    throw new Error('--host must be an SSH host or user@host (SSH config aliases work).');
  if (
    !domain ||
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  )
    throw new Error('--domain must be a DNS hostname, without a scheme or path.');
  return { host, domain };
}
async function run(args: string[], stdin?: string) {
  const child = Bun.spawn(args, {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: stdin === undefined ? 'inherit' : new Blob([stdin]),
  });
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${args[0]}`);
}
if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { host: { type: 'string' }, domain: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(
      'Usage: bun run deploy --host root@your-vps --domain napplet.example\n\nFor a dedicated Debian/Ubuntu VPS with systemd and root or passwordless sudo.\nInstalls pinned Bun, Caddy and PM2; uploads source without secrets; checks and activates a release.',
    );
    process.exit(0);
  }
  try {
    const { host, domain } = validateTarget(values.host, values.domain);
    const release = `${new Date().toISOString().replace(/[-:TZ.]/g, '')}-${process.pid}`;
    const staging = await mkdtemp(join(tmpdir(), 'napplet-deploy-'));
    const archive = join(staging, `napplet-${release}.tar.gz`);
    try {
      await run(['bun', 'run', 'check']);
      await run(['bun', 'run', 'test:relay']);
      await run([
        'tar',
        '--exclude=node_modules',
        '--exclude=dist',
        '--exclude=.output',
        '--exclude=.tanstack',
        '--exclude=.env',
        '--exclude=.env.*',
        '--exclude=.local',
        '-czf',
        archive,
        'package.json',
        'LICENSE',
        'bun.lock',
        'tsconfig.json',
        'apps',
        'packages',
        'scripts',
        'infra',
        'services',
        'tests/services',
      ]);
      await run(['scp', archive, `${host}:/tmp/napplet-${release}.tar.gz`]);
      const script = await Bun.file(new URL('./deploy-remote.sh', import.meta.url)).text();
      // Arguments have an allowlisted alphabet; never interpolate arbitrary input into a remote shell.
      await run(
        [
          'ssh',
          host,
          `if [ "$(id -u)" = 0 ]; then exec bash -s -- ${release} ${domain}; else exec sudo -n bash -s -- ${release} ${domain}; fi`,
        ],
        script,
      );
      console.log(`\nRelease ${release} is running behind Caddy at https://${domain}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
