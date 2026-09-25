import { readFile, writeFile, access } from 'node:fs/promises';
import { jsonLines } from './worker-process';
for await (const message of jsonLines(Bun.stdin.stream(), 8192)) {
  try {
    if (process.env.SPACE_CVM_KEY_PATH || process.env.SPACE_TURN_SECRET_PATH)
      throw new Error('Service environment leaked.');
    for (const file of ['/etc/passwd', '/var/lib/napplet-space/cvm/identity', message.hidden]) {
      try {
        await access(file);
        throw new Error('Host path is readable: ' + file);
      } catch (error) {
        if (!['ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
    await writeFile('/work/probe', 'private scratch');
    const route = await readFile('/proc/net/route', 'utf8');
    if (route.trim().split('\n').length !== 1) throw new Error('Sandbox has a network route.');
    const status = await readFile('/proc/self/status', 'utf8');
    if (!/^NoNewPrivs:\s+1$/m.test(status)) throw new Error('NoNewPrivs missing.');
    const namespaces = Bun.spawn(['/usr/bin/unshare', '--user', 'true'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if ((await namespaces.exited) === 0)
      throw new Error('Nested user namespaces remain available.');
    process.stdout.write(JSON.stringify({ type: 'result', value: 'isolated' }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ type: 'failure', message: String(error) }) + '\n');
  }
}
