import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pins from '../vendor/toolchain.json';

const command = process.env.SPACE_TEST_CLI
  ? [process.env.SPACE_TEST_CLI]
  : [process.execPath, new URL('./index.ts', import.meta.url).pathname];

test('Git failures reach the real CLI with stdout, stderr, status and redaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-git-errors-'));
  try {
    const bin = join(root, 'tools');
    await mkdir(bin);
    const git = Bun.which('git')!;
    await writeFile(
      join(bin, 'git'),
      `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = commit ]; then
    printf 'CONFLICT: fixture game.ts needs attention\\n'
    printf 'Authorization: Bearer fixture-git-token\\n'
    printf 'fixture: cannot finish Git operation\\n' >&2
    exit 23
  fi
done
exec '${git.replace(/'/g, "'\\''")}' "$@"
`,
      { mode: 0o755 },
    );
    const project = join(root, 'project');
    await Bun.write(join(project, 'game.ts'), 'export const game = true;');
    for (const json of [false, true]) {
      const child = Bun.spawn(
        [...command, 'checkpoint', 'Fixture', '--project', project, ...(json ? ['--json'] : [])],
        {
          cwd: project,
          env: { PATH: `${bin}:${process.env.PATH}`, SPACE_ACCOUNT_HOME: join(root, 'accounts') },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(1);
      const text = out + err;
      expect(text).not.toContain('fixture-git-token');
      expect(text).toContain('game.ts needs attention');
      expect(text).toContain('cannot finish Git operation');
      expect(text).toContain('Exit status: 23');
      if (json)
        expect(JSON.parse(out).error).toMatchObject({
          code: 'GIT_COMMAND',
          operation: 'Git commit',
        });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real CLI preserves actionable dependency errors and identifies missing project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-errors-'));
  const run = async () => {
    const child = Bun.spawn([...command, 'backend', 'status', '--project', root, '--json'], {
      cwd: root,
      env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: join(root, 'accounts') },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, out + err).toBe(1);
    expect(err).toBe('');
    return JSON.parse(out).error;
  };
  try {
    const missing = await run();
    expect(missing.code).toBe('ENOENT');
    expect(missing.message).toContain('napplet.json');
    expect(missing.operation).toContain('backend');
    expect(missing.recovery).toBeTruthy();
    await writeFile(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Fixture',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
      }),
    );
    const actionable = await run();
    expect(actionable.message).toContain('Add backend:');
    expect(actionable.message).toContain('napplet.json');
    expect(actionable.code).not.toBe('CLI_FAILED');
    const invalidSchema = {
      schema: 'space-local-project/v1',
      name: 'Fixture',
      entry: 'index.html',
      previewId: crypto.randomUUID(),
      license: 'MIT',
      backend: {
        boards: [
          {
            board: 'race',
            title: 'Race',
            order: 'lowest',
            minimum: 1,
            maximum: 100,
            dataSchema: {
              type: 'object',
              properties: { car: { type: 'string', pattern: 'private-schema-pattern' } },
            },
          },
        ],
      },
    };
    await writeFile(join(root, 'napplet.json'), JSON.stringify(invalidSchema));
    const schemaError = await run();
    expect(schemaError.message).toContain('dataSchema');
    expect(schemaError.message).toContain('Unsupported schema keyword pattern');
    expect(JSON.stringify(schemaError)).not.toContain('private-schema-pattern');
    await writeFile(join(root, 'napplet.json'), '{"password":"do-not-print-my-password",');
    const invalid = await run();
    expect(invalid.code).toBe('INVALID_JSON');
    expect(JSON.stringify(invalid)).not.toContain('do-not-print-my-password');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('wrapped tool failures retain exit status and stderr in both terminal and JSON output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-tool-errors-'));
  try {
    // Isolated executable fixtures exercise the real wrapper without downloads,
    // global toolchain changes, credentials or project scripts.
    const cache = join(root, 'toolchain');
    for (const pin of [pins.node, pins.nodeLegacyMac]) {
      const archive = (pin.platforms as Record<string, { directory: string }>)[
        `${process.platform}-${process.arch}`
      ];
      if (!archive) continue;
      const bin = join(cache, archive.directory, 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(
        join(bin, 'node'),
        `#!/bin/sh
if [ "$1" = --version ]; then printf 'v${pin.version}\\n'; exit 0; fi
printf 'Authorization: Bearer fixture-token\\n' >&2
printf 'fixture: could not resolve src/missing.ts\\n' >&2
exit 23
`,
        { mode: 0o755 },
      );
    }
    const pnpm = join(cache, `pnpm-${pins.pnpm.version}`, 'package/bin');
    await mkdir(pnpm, { recursive: true });
    await writeFile(join(pnpm, 'pnpm.cjs'), '// fixture');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: `pnpm@${pins.pnpm.version}` }),
    );
    for (const json of [false, true]) {
      const child = Bun.spawn(
        [...command, 'setup', '--project', root, ...(json ? ['--json'] : [])],
        {
          cwd: root,
          env: {
            PATH: '/usr/bin:/bin',
            SPACE_TOOLCHAIN_CACHE: cache,
            SPACE_ACCOUNT_HOME: join(root, 'accounts'),
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(stdout + stderr).not.toContain('fixture-token');
      if (json) {
        const { error } = JSON.parse(stdout);
        expect(error.code).toBe('PROJECT_TOOL');
        expect(error.operation).toBe('install project dependencies');
        expect(error.details).toContain('Exit status: 23');
        expect(error.details.join('\n')).toContain('could not resolve src/missing.ts');
      } else {
        expect(stderr).toContain('Exit status: 23');
        expect(stderr).toContain('could not resolve src/missing.ts');
        expect(stderr).toContain('Next:');
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
