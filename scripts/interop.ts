import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pins from '../tests/fixtures/interoperability/pins.json';

// Independent clients stay outside the application's dependency graph. All signed
// publications and test keys are disposable and confined to loopback services.
const root = resolve(import.meta.dir, '..');
const directory = join(root, '.local/interoperability');
const client = join(directory, 'client');
const upstream = join(directory, 'upstream');
async function run(args: string[], cwd = root, env = process.env) {
  const child = Bun.spawn(args, {
    cwd,
    env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 300000);
  try {
    if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
  } finally {
    clearTimeout(timer);
  }
}
if (!Bun.which('git-remote-nostr'))
  throw new Error('Install ngit (including git-remote-nostr) on PATH first.');
await mkdir(client, { recursive: true });
for (const file of ['package.json', 'bun.lock']) {
  await cp(join(root, 'tests/fixtures/interoperability', file), join(client, file));
}
await run([process.execPath, 'install', '--frozen-lockfile'], client);
if (!(await Bun.file(join(upstream, '.git/HEAD')).exists())) {
  await run(['git', 'clone', '--no-checkout', 'https://github.com/napplet/web.git', upstream]);
  await run(['git', 'checkout', '--detach', pins.upstream], upstream);
}
// The test verifies the exact revision, and never resets an existing checkout.
await run(['git', 'diff', '--exit-code', 'HEAD'], upstream);
await run([process.execPath, 'test', 'tests/services/interoperability.test.ts'], root, {
  ...process.env,
  SOY_INTEROP_PAJA: join(client, 'node_modules/@kehto/paja'),
  SOY_INTEROP_UPSTREAM: upstream,
});
