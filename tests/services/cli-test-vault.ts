import { NativeVault, type Vault } from '../../packages/identity/src/accounts';

/** macOS scopes Keychain access to the executable. Test cleanup must use the same
 * compiled executable that created the temporary credentials, not the test runner. */
export function cliTestVault(service: string): Vault {
  const binary = process.env.SPACE_TEST_CLI;
  if (!binary) return new NativeVault(service);
  async function operation(action: 'get' | 'set' | 'delete', name: string, value?: string) {
    const child = Bun.spawn(
      [
        binary!,
        '--no-env-file',
        '-e',
        'const {action,...item}=JSON.parse(await Bun.stdin.text()); const result=await Bun.secrets[action](item); console.log(JSON.stringify(result??null));',
      ],
      {
        env: { PATH: '/usr/bin:/bin', BUN_BE_BUN: '1' },
        stdin: new Blob([JSON.stringify({ action, service, name, value })]),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      const [code, output] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error('Temporary test credential operation failed.');
      return JSON.parse(output);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    get: (name) => operation('get', name),
    set: async (name, value) => {
      await operation('set', name, value);
    },
    delete: async (name) => {
      await operation('delete', name);
    },
  };
}
