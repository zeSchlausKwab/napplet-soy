import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boilerplateFiles, creatorSkills, installCreatorSkills } from './creator-kit';
import boilerplate from '../vendor/boilerplate.json';
import skills from '../vendor/skills.json';
import { scaffold } from './scaffold';
import { inspectProject } from '../../../packages/publish/src/project';
import { freezeFixture as freezeSource } from '../../../packages/publish/src/testing';
import { executableBytes } from '../../../packages/publish/src/artifact';
import { sha256 } from '../../../packages/protocol/src';

const root = await mkdtemp(join(tmpdir(), 'napplet-creator-kit-'));
afterAll(() => rm(root, { recursive: true, force: true }));

test('the assembled starter passes upstream documentation checks, including bundled soyLI docs', async () => {
  const project = await scaffold(root, 'guidance-check', 'boilerplate');
  // Run the starter's actual checks after all managed guides/skills are installed.
  // The unchanged domain-helper test needs the starter's older TS compiler API;
  // here run all documentation/layout checks with no dependency downloads.
  await symlink(
    new URL('../../../node_modules', import.meta.url).pathname,
    join(project, 'node_modules'),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      'test',
      'tests/guidance.test.mjs',
      '--test-name-pattern',
      '^(rejects|keeps|ships)',
    ],
    {
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
});

test('preserves the upstream project and skill bodies with only the documented integration changes', () => {
  const files = boilerplateFiles('my-creation');
  const adapted = new Set([
    'package.json',
    'AGENTS.md',
    'README.md',
    '.gitignore',
    'tests/guidance.test.mjs',
    'src/main.ts',
  ]);
  for (const [path, original] of Object.entries(boilerplate.files))
    if (!adapted.has(path)) expect(files[path], path).toBe(original);
  expect(files['src/main.ts'].replace("import './napplet-settings.js';\n", '')).toBe(
    boilerplate.files['src/main.ts'],
  );
  const pkg = JSON.parse(files['package.json']),
    original = JSON.parse(boilerplate.files['package.json']);
  expect({ ...pkg, name: original.name }).toEqual(original);
  for (const [path, body] of Object.entries(skills.files))
    if (path.startsWith('skills/')) {
      expect(creatorSkills()[`.agents/${path}`]).toBe(body);
      expect(creatorSkills()[`.claude/${path}`]).toBe(body);
    }
});

test('skill updates preserve creator edits, unrelated skills and symlink targets', async () => {
  const directory = await mkdtemp(join(root, 'updates-'));
  expect((await installCreatorSkills(directory)).conflicts).toEqual([]);
  const path = '.agents/skills/napplet-make/SKILL.md';
  await writeFile(join(directory, path), 'Creator-owned instructions');
  const result = await installCreatorSkills(directory);
  expect(result.conflicts).toContain(path);
  expect(await readFile(join(directory, path), 'utf8')).toBe('Creator-owned instructions');
  const linked = '.claude/skills/napplet-ui/SKILL.md';
  const precious = join(root, 'precious.md');
  await writeFile(precious, 'Never overwrite');
  await rm(join(directory, linked));
  await symlink(precious, join(directory, linked));
  expect((await installCreatorSkills(directory)).conflicts).toContain(linked);
  expect(await readFile(precious, 'utf8')).toBe('Never overwrite');
});

test('managed app-data guidance and both portable helper files reach projects while edited helpers stay owned by the creator', async () => {
  const directory = await mkdtemp(join(root, 'app-data-guidance-'));
  const installed = await installCreatorSkills(directory);
  for (const path of ['docs/napplet-data.md', 'docs/examples/app-data.ts', 'docs/examples/app-data-contract.ts'])
    expect(installed.updated).toContain(path);
  expect(await readFile(join(directory, 'docs/napplet-space.md'), 'utf8')).toContain('For player-created tracks');
  const path = 'docs/examples/app-data.ts';
  await writeFile(join(directory, path), '// My project customization');
  expect((await installCreatorSkills(directory)).conflicts).toContain(path);
  expect(await readFile(join(directory, path), 'utf8')).toBe('// My project customization');
});

test('publishing freezes editable upstream source and the separate built artifact, including build capabilities', async () => {
  const project = await scaffold(root, 'built-project', 'boilerplate');
  await expect(inspectProject(project, 'local', 'a'.repeat(64))).rejects.toMatchObject({
    code: 'ARTIFACT_MISSING',
  });
  const html =
    '<!doctype html><meta name="napplet-requires" content="storage,theme"><p>Built artifact</p>';
  await Bun.write(join(project, 'dist/index.html'), html);
  const inspected = await inspectProject(project, 'local', 'a'.repeat(64));
  expect(new TextDecoder().decode(executableBytes(inspected.contents))).toBe(html);
  expect(inspected.plan.artifactHash).toBe(await sha256(html));
  expect(inspected.plan.requires).toEqual(['storage', 'theme']);
  expect(inspected.contents.get('src/main.ts')).toBeDefined();
  expect(inspected.contents.get('pnpm-lock.yaml')).toBeDefined();
  expect(inspected.contents.get('index.html')).not.toEqual(executableBytes(inspected.contents));
  const frozenDirectory = join(root, 'frozen');
  await freezeSource(frozenDirectory, inspected.contents, 1800000000);
  const frozen = await inspectProject(
    join(frozenDirectory, 'files'),
    'local',
    'a'.repeat(64),
    {},
    inspected.plan.sourceCommit,
    inspected.plan.files.map((f) => f.path),
  );
  expect(frozen.fingerprint).toBe(inspected.fingerprint);
  expect(frozen.plan).toEqual(inspected.plan);
});
