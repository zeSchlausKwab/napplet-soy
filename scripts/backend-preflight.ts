import { productionSandbox } from '../packages/dynamic-backends/src/sandbox';
import { compileHandler, executeHandler } from '../packages/dynamic-backends/src/runtime';
export async function backendPreflight(directory: string) {
  const sandbox = await productionSandbox(directory);
  const code = await compileHandler(
    'export async function handle(ctx:any){await ctx.state.set("test","a",{n:1}); return {n:(await ctx.state.get("test","a")).n, fetch:typeof fetch, process:typeof process};}',
    sandbox.workerCommand,
  );
  const calls: string[] = [];
  const result = (await executeHandler(
    code,
    {
      actor: '',
      account: null,
      principal: '',
      owner: '',
      instance: 'probe',
      release: '',
      operation: 'probe',
      requestId: '',
      now: 0,
    },
    {},
    (method) => {
      calls.push(method);
      return method === 'get' ? { n: 1 } : null;
    },
    { command: sandbox.workerCommand },
  )) as any;
  if (
    result.n !== 1 ||
    result.fetch !== 'undefined' ||
    result.process !== 'undefined' ||
    calls.join(',') !== 'set,get'
  )
    throw new Error('Backend sandbox compilation/state bridge probe failed.');
  console.log(JSON.stringify({ status: 'ready', ...sandbox.isolation }));
  return sandbox;
}
if (import.meta.main)
  await backendPreflight(process.argv[2] || process.env.SPACE_DYNAMIC_BUNDLE_DIR || '');
