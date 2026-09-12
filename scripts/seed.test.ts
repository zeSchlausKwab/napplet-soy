import { test, expect } from 'bun:test';
import { mkdtemp, rm, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedExamples } from './seed';
test('dev seeding is idempotent and repairs a missing artifact without rewriting the catalog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-seed-'));
  const root = pathToFileURL(`${dir}/`);
  try {
    expect((await seedExamples(root)).count).toBe(6);
    const path = join(dir, 'packages/backend/data/catalog.json');
    const before = await stat(path);
    const records = await Bun.file(path).json();
    expect((await seedExamples(root)).writes).toBe(0);
    await unlink(join(dir, `packages/backend/data/artifacts/${records[0].artifactHash}.html`));
    expect((await seedExamples(root)).writes).toBe(1);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
