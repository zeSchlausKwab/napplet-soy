import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boilerplateFiles, creatorSkills, installCreatorSkills } from './creator-kit';
import boilerplate from '../vendor/boilerplate.json';
import skills from '../vendor/skills.json';
import { scaffold } from './scaffold';
import { inspectProject, freezeSource } from '../../../packages/publish/src/project';
import { executableBytes } from '../../../packages/publish/src/artifact';
import { sha256 } from '../../../packages/protocol/src';

const root = await mkdtemp(join(tmpdir(), 'napplet-creator-kit-'));
afterAll(() => rm(root, { recursive: true, force: true }));

test('preserves the upstream project and skill bodies with only the documented integration changes', () => {
  const files = boilerplateFiles('my-creation');
  const adapted = new Set([
    'package.json',
    'AGENTS.md',
    'README.md',
    '.gitignore',
    'tests/guidance.test.mjs',
  ]);
  for (const [path, original] of Object.entries(boilerplate.files))
    if (!adapted.has(path)) expect(files[path], path).toBe(original);
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
  const frozen = await inspectProject(join(frozenDirectory, 'source'), 'local', 'a'.repeat(64));
  expect(frozen.fingerprint).toBe(inspected.fingerprint);
  expect(frozen.plan).toEqual(inspected.plan);
});
