import { resolve } from 'node:path';
import { DiagnosticError, ToolOutput } from '../packages/diagnostics/src';

/** Ask this checkout's PM2 for its current logs; filenames include changing IDs. */
export async function serviceStartupError(root: string, service: string) {
  const name = `napplet-local-${service}`;
  const output = new ToolOutput();
  const errors = new ToolOutput();
  let logStatus: string;
  try {
    const child = Bun.spawn(
      [
        'node',
        resolve(root, 'node_modules/pm2/bin/pm2'),
        'logs',
        name,
        '--lines',
        '30',
        '--nostream',
      ],
      {
        cwd: root,
        env: { ...process.env, PM2_HOME: resolve(root, '.local/pm2') },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 5000);
    async function collect(stream: ReadableStream<Uint8Array>, target: ToolOutput) {
      for await (const chunk of stream) target.push(chunk);
      target.finish();
    }
    try {
      const [status] = await Promise.all([
        child.exited,
        collect(child.stdout, output),
        collect(child.stderr, errors),
      ]);
      logStatus = timedOut ? 'PM2 log lookup timed out.' : `PM2 log lookup exit status: ${status}.`;
    } finally {
      clearTimeout(timer);
    }
  } catch (cause) {
    logStatus = `PM2 log lookup failed: ${cause instanceof Error ? cause.message : 'unknown error'}`;
  }
  return new DiagnosticError('DEV_SERVICE_NOT_READY', `${name} did not become ready.`, {
    operation: 'start local development services',
    tool: 'PM2',
    target: name,
    detail: [logStatus, output.text, errors.text].filter(Boolean).join('\n'),
    recovery:
      `Run bun run dev:doctor. From this checkout, inspect PM2_HOME=.local/pm2 node node_modules/pm2/bin/pm2 logs ${name} --lines 30 --nostream. ` +
      'If the data directory is already in use, identify its owning process before stopping it; do not delete database or lock files.',
  });
}
