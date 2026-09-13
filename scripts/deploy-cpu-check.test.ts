import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function check(kernel: string, architecture: string, cpuinfo: string, profile = 'standard') {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-deploy-cpu-'));
  try {
    const path = join(directory, 'cpuinfo');
    await writeFile(path, cpuinfo);
    const process = Bun.spawn(
      [
        'bash',
        '-c',
        'source "$1"; napplet_check_cpu "$2" "$3" "$4" "$5"',
        'cpu-check',
        new URL('./deploy-cpu-check.sh', import.meta.url).pathname,
        kernel,
        architecture,
        path,
        profile,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return {
      code: await process.exited,
      output: await new Response(process.stdout).text(),
      error: await new Response(process.stderr).text(),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('deployment rejects legacy QEMU CPUs before trying to execute Bun', async () => {
  const result = await check(
    'Linux',
    'x86_64',
    'processor : 0\nmodel name : QEMU Virtual CPU version 2.5+\nflags : fpu sse sse2 pni cx16 hypervisor\n',
  );
  expect(result.code).toBe(1);
  expect(result.error).toContain('SSE4.2');
  expect(result.error).toContain('VPS provider');
});

test('legacy CPU support is explicit and restricted to the tested Linux x64 profile', async () => {
  const legacy = 'flags : fpu sse sse2 pni cx16 hypervisor\n';
  expect((await check('Linux', 'x86_64', legacy, 'legacy-x64')).code).toBe(0);
  expect((await check('Linux', 'x86_64', legacy)).code).toBe(1);
  expect((await check('Linux', 'arm64', '', 'legacy-x64')).code).toBe(1);
  expect((await check('Darwin', 'x86_64', legacy, 'legacy-x64')).code).toBe(1);
  expect((await check('Linux', 'x86_64', legacy, 'unchecked')).code).toBe(1);
});

test('CPU check accepts baseline x64 without AVX and Linux arm64', async () => {
  expect((await check('Linux', 'x86_64', 'flags\t: sse sse2 sse4_1 sse4_2\n')).code).toBe(0);
  for (const architecture of ['aarch64', 'arm64'])
    expect((await check('Linux', architecture, '')).code).toBe(0);
});

test('CPU check rejects missing or partial capabilities and unsupported platforms', async () => {
  for (const cpuinfo of ['', 'flags : sse4_20\n', 'flags : sse4_2\n\nflags : sse sse2\n'])
    expect((await check('Linux', 'x86_64', cpuinfo)).code).toBe(1);
  expect((await check('Darwin', 'arm64', '')).code).toBe(1);
  expect((await check('Linux', 'riscv64', '')).code).toBe(1);
});
