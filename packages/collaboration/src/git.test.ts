import { test, expect } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceGit } from '../../grasp/src/client';
import { checkpoint, committedSource, inspectHistory } from '../../publish/src/git-source';
import { cloneUrl } from './git';
import { diagnose, formatDiagnostic } from '../../diagnostics/src';

test('real Git merge preflight preserves conflict filenames from stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-merge-errors-'));
  try {
    await Bun.write(join(root, 'game.txt'), 'original\n');
    const base = await checkpoint(root, 'Original');
    await Bun.write(join(root, 'game.txt'), 'maintainer change\n');
    const target = await checkpoint(root, 'Maintainer');
    await sourceGit(root, ['checkout', '--detach', base.commit]);
    await Bun.write(join(root, 'game.txt'), 'proposed change\n');
    const proposed = await checkpoint(root, 'Proposal');
    await sourceGit(root, ['checkout', '--detach', target.commit]);
    let failure: unknown;
    try {
      await sourceGit(root, ['merge-tree', '--write-tree', target.commit, proposed.commit]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeTruthy();
    const diagnostic = diagnose(failure);
    expect(diagnostic.details).toContain('Exit status: 1');
    expect(formatDiagnostic(diagnostic)).toContain('CONFLICT');
    expect(formatDiagnostic(diagnostic)).toContain('game.txt');
    expect(await sourceGit(root, ['rev-parse', 'HEAD'])).toBe(target.commit);
    expect(await sourceGit(root, ['status', '--porcelain'])).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkpoints are explicit, preserve authorship, and uncommitted work cannot be shared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-git-'));
  try {
    await Bun.write(join(root, 'index.html'), '<p>hi</p>');
    await expect(committedSource(root)).rejects.toMatchObject({ code: 'COMMIT_REQUIRED' });
    await committedSource(root).catch((error) => {
      expect(formatDiagnostic(diagnose(error))).toContain('Git rev-parse');
      expect(formatDiagnostic(diagnose(error))).toContain('Exit status:');
    });
    const first = await checkpoint(root, 'An idea', 'Alice');
    expect(await sourceGit(root, ['log', '-1', '--format=%an'])).toBe('Alice');
    await Bun.write(join(root, 'index.html'), '<p>better</p>');
    await expect(committedSource(root)).rejects.toMatchObject({ code: 'SOURCE_DIRTY' });
    const next = await checkpoint(root, 'Improve it', 'Bob');
    expect(await sourceGit(root, ['rev-parse', 'HEAD^'])).toBe(first.commit);
    await inspectHistory(root, next.commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('deleted credentials in reachable Git history and source symlinks are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-git-'));
  try {
    await sourceGit(root, ['init', '--initial-branch=main']);
    await Bun.write(join(root, '.env'), 'SECRET=private');
    await sourceGit(root, ['add', '.env']);
    await sourceGit(root, ['commit', '-m', 'Accidental secret']);
    await sourceGit(root, ['rm', '.env']);
    await sourceGit(root, ['commit', '-m', 'Delete it']);
    await expect(inspectHistory(root, await committedSource(root))).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
    });
    await symlink('/etc/passwd', join(root, 'leak'));
    await sourceGit(root, ['add', 'leak']);
    await sourceGit(root, ['commit', '-m', 'Bad link']);
    await expect(inspectHistory(root, await committedSource(root))).rejects.toMatchObject({
      code: 'SOURCE_PATH',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('proposal clone transports never invoke Git helpers or accept private hosts', () => {
  for (const url of [
    'file:///etc/passwd',
    'ext::sh',
    'https://127.0.0.1/repo',
    'https://user:secret@git.example/repo',
    'http://git.example/repo',
  ])
    expect(() => cloneUrl(url)).toThrow();
  expect(cloneUrl('https://git.example/repo')).toBe('https://git.example/repo');
  expect(cloneUrl('http://127.0.0.1:8082/repo', true)).toContain('8082');
});
