import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graspReady, previousRelease } from './deploy-state';

test('GRASP readiness accepts upstream formatted JSON but rejects another service or build', () => {
  const info = { name: 'Napplet Space Git (napplet.soy)', version: '3.0.2+space.test' };
  for (const indentation of [undefined, 2])
    expect(graspReady(JSON.stringify(info, null, indentation), info.version, info.name)).toBe(true);
  for (const response of [
    '',
    '{',
    'null',
    '[]',
    JSON.stringify({ ...info, version: 'old' }),
    JSON.stringify({ ...info, name: 'other' }),
  ])
    expect(graspReady(response, info.version, info.name)).toBe(false);
});

test('first deployment has no rollback release; only a real directory symlink is accepted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'napplet-deploy-state-'));
  const current = join(directory, 'current');
  try {
    expect(previousRelease(current)).toBe('');
    const release = join(directory, 'release');
    mkdirSync(release);
    symlinkSync(release, current);
    expect(previousRelease(current)).toBe(realpathSync(release));
    rmSync(current);
    symlinkSync(current, current);
    expect(() => previousRelease(current)).toThrow();
    rmSync(current);
    symlinkSync(join(directory, 'missing'), current);
    expect(() => previousRelease(current)).toThrow();
    rmSync(current);
    writeFileSync(current, 'unexpected file');
    expect(() => previousRelease(current)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
