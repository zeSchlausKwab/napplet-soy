import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectConfiguration } from './project-config';
import {
  defaultTargets,
  projectPublishingDefaults,
  projectSchema,
  resolveTargets,
} from '../../../packages/publish/src/config';

test('effective targets are readable before setup and editable per network without changing runtime hints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-config-'));
  try {
    const project = {
      schema: 'space-local-project/v1',
      name: 'Test',
      previewId: crypto.randomUUID(),
      entry: 'dist/index.html',
      license: 'MIT',
      relays: [],
      servers: [],
    };
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(project));
    expect((await projectConfiguration(root, 'public')).targets).toMatchObject({
      relay: 'wss://napplet.soy/relay',
      blossom: 'https://blossom.napplet.soy',
      grasp: 'https://git.napplet.soy',
    });
    await projectConfiguration(root, 'public', true);
    const configured = await Bun.file(join(root, 'napplet.json')).json();
    expect(configured.publish.networks.public.relay).toBe('wss://napplet.soy/relay');
    configured.publish.networks.public.blossom = 'https://assets.example.com';
    configured.publish.networks.public.mirrors = [];
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(configured));
    expect((await projectConfiguration(root, 'public')).targets).toMatchObject({
      blossom: 'https://assets.example.com',
      mirrors: [],
    });
    expect((await projectConfiguration(root, 'local')).targets).toEqual(defaultTargets('local'));
    const legacy = projectSchema.parse({
      ...project,
      publish: { blossom: 'https://legacy.example.com' },
    });
    expect(resolveTargets(legacy, 'public').blossom).toBe('https://legacy.example.com');
    const scaffolded = projectSchema.parse({ ...project, publish: projectPublishingDefaults() });
    expect(resolveTargets(scaffolded, 'local')).toEqual(defaultTargets('local'));
    expect(
      resolveTargets(scaffolded, 'public', { blossom: 'https://override.example.com' }).blossom,
    ).toBe('https://override.example.com');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
