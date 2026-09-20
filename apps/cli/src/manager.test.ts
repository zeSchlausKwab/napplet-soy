import { test, expect } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manageProject, editProject } from './manager';
import {
  readAssets,
  importAsset,
  assetBytes,
  validateAssets,
  ASSET_LOCK,
} from '../../../packages/assets/src';
import { inspectProject } from '../../../packages/publish/src/project';
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
    'base64',
  ),
);
test('manager edits shared files, preserves identity/destinations, rejects stale edits and verifies asset source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-manager-'));
  const creator = { pubkey: 'a'.repeat(64), network: 'local' };
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Demo',
        entry: 'index.html',
        license: 'MIT',
        previewId: crypto.randomUUID(),
        creator,
      }),
    );
    await Bun.write(join(root, 'index.html'), '<!doctype html><p>Demo</p>');
    await Bun.write(join(root, 'LICENSE'), 'MIT');
    let state = await manageProject(root, 'local');
    const before = state;
    state = await editProject(root, 'local', {
      action: 'project',
      revision: state.revision,
      changes: { ...state.project, title: 'New title', description: 'A story', topics: ['#Game'] },
    });
    expect(state.project.topics).toEqual(['game']);
    await expect(
      editProject(root, 'local', {
        action: 'project',
        revision: before.revision,
        changes: before.project,
      }),
    ).rejects.toThrow('Project changed');
    const targets = { ...state.targets, blossom: 'http://127.0.0.1:9123' };
    state = await editProject(root, 'local', {
      action: 'targets',
      revision: state.revision,
      targets,
    });
    expect(state.targets.blossom).toBe(targets.blossom);
    expect(
      (await Bun.file(join(root, '.napplet-space/project.json')).json()).project.creator,
    ).toEqual(creator);
    state = await editProject(root, 'local', {
      action: 'asset',
      revision: state.revision,
      id: 'sprite',
      storage: 'external',
      license: 'CC0',
      data: Buffer.from(png).toString('base64'),
    });
    const asset = state.assets[0];
    expect(asset.mime).toBe('image/png');
    expect(await assetBytes(root, asset)).toEqual(png);
    const inspected = await inspectProject(root, 'local', creator.pubkey);
    expect(inspected.plan.requires).toContain('resource');
    expect(inspected.contents.get(asset.path)).toEqual(png);
    expect(inspected.contents.has(ASSET_LOCK)).toBe(true);
    await expect(
      importAsset(root, { id: 'sprite', storage: 'external', license: 'CC0', bytes: png }),
    ).rejects.toThrow('already exists');
    await Bun.write(join(root, asset.path), 'changed');
    await expect(validateAssets(root)).rejects.toThrow('corrupt');
    expect((await manageProject(root, 'local')).assets[0].error).not.toBeNull();
    await rm(join(root, asset.path));
    await symlink(join(root, 'LICENSE'), join(root, asset.path));
    await expect(assetBytes(root, asset)).rejects.toThrow('symlink');
    await rm(join(root, asset.path));
    await Bun.write(join(root, asset.path), png);
    state = await manageProject(root, 'local');
    await editProject(root, 'local', {
      action: 'asset-remove',
      revision: state.revision,
      id: 'sprite',
    });
    expect((await readAssets(root)).assets).toHaveLength(0);
    expect(await Bun.file(join(root, asset.path)).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
