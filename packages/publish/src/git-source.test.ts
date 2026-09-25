import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../grasp/src/client';
import { encodeAddress } from '../../protocol/src';
import { inspectHistory } from './git-source';
import { checkSource } from './project';

const path = '.napplet-space/soy-backend.json';
const publicContext = {
  version: 1,
  napplet: encodeAddress({ kind: 35129, pubkey: 'a'.repeat(64), identifier: 'test-world' }),
  provider: { pubkey: 'b'.repeat(64), relays: ['wss://relay.example.com/'] },
  boards: ['scores'],
  modules: ['world'],
};

async function history(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'soy-history-'));
  await sourceGit(root, ['init']);
  for (const [file, text] of Object.entries(files)) await Bun.write(join(root, file), text);
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Old authoring guidance']);
  const original = await sourceGit(root, ['rev-parse', 'HEAD']);
  const blob = await sourceGit(root, ['rev-parse', `${original}:${Object.keys(files)[0]}`]);
  await sourceGit(root, ['rm', '-r', '.']);
  await Bun.write(join(root, '.gitignore'), '.napplet-space/\n');
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Keep generated context ignored']);
  const head = await sourceGit(root, ['rev-parse', 'HEAD']);
  return { root, original, blob, head, close: () => rm(root, { recursive: true, force: true }) };
}

test('removed legacy public backend context remains publishable without rewriting history', async () => {
  const f = await history({ [path]: JSON.stringify(publicContext, null, 2) });
  try {
    const result = await inspectHistory(f.root, f.head);
    expect(result).toMatchObject({
      commit: f.head,
      legacyPublicContexts: [{ path, object: f.blob, commit: f.original }],
    });
    expect(await sourceGit(f.root, ['rev-parse', 'HEAD'])).toBe(f.head);
    expect(await sourceGit(f.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await sourceGit(f.root, ['status', '--porcelain'])).toBe('');
    // This is an ancestry-only compatibility rule, never a source-selection exemption.
    expect(() =>
      checkSource(path, new TextEncoder().encode(JSON.stringify(publicContext))),
    ).toThrow('private or generated');
    await expect(inspectHistory(f.root, f.original)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      context: {
        recovery: expect.stringContaining('Remove the generated context from Git tracking'),
      },
    });
  } finally {
    await f.close();
  }
});

test('history rejection identifies path, blob and containing commit without printing contents', async () => {
  const f = await history({
    '.napplet-space/project.json': '{"privateKey":"fixture-secret-value"}',
  });
  try {
    await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      message: expect.stringContaining('Git history'),
      context: {
        detail: expect.stringContaining(f.blob),
        recovery: expect.stringContaining('history'),
      },
    });
  } finally {
    await f.close();
  }
});

test('legacy compatibility rejects unknown fields, credentials, malformed and oversized metadata', async () => {
  const variants = [
    JSON.stringify({ ...publicContext, secret: 'fixture-secret-value' }),
    JSON.stringify({
      ...publicContext,
      provider: { ...publicContext.provider, token: 'fixture-secret-value' },
    }),
    JSON.stringify({
      ...publicContext,
      provider: {
        ...publicContext.provider,
        relays: ['wss://relay.example.com/?secret=fixture-secret-value'],
      },
    }),
    JSON.stringify({ ...publicContext, modules: ['nsec1' + 'q'.repeat(58)] }),
    JSON.stringify({
      ...publicContext,
      provider: {
        ...publicContext.provider,
        relays: ['wss://relay.example.com/nsec1' + 'q'.repeat(58)],
      },
    }),
    JSON.stringify({ ...publicContext, napplet: 'not-an-address' }),
    JSON.stringify({ ...publicContext, version: 2 }),
    '{"version":1,"provider":',
    '{"modules":["fixture-secret-value"],' + JSON.stringify(publicContext).slice(1),
    ' '.repeat(16385) + JSON.stringify(publicContext),
  ];
  for (const [index, text] of variants.entries()) {
    const f = await history({ [path]: text });
    try {
      await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({ code: 'SOURCE_SECRET' });
      if (index === 0)
        await expect(inspectHistory(f.root, f.original)).rejects.toMatchObject({
          code: 'SOURCE_SECRET',
          context: { recovery: expect.stringContaining('history cleanup') },
        });
    } finally {
      await f.close();
    }
  }
}, 15000);

test('the same historical blob cannot hide a forbidden alias behind its public context path', async () => {
  const text = JSON.stringify(publicContext);
  const f = await history({ [path]: text, '.napplet-space/world.db': text });
  try {
    await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      message: expect.stringContaining('.napplet-space/world.db'),
    });
  } finally {
    await f.close();
  }
});
