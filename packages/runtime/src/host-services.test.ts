import { test, expect } from 'bun:test';
import { scopedStorage, type KeyValueStorage } from './storage';
import { NappletFiles, type ExportFile } from './filesystem';
import { missingDomains } from './capabilities';

function memory(): KeyValueStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (i) => [...entries.keys()][i] ?? null,
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => {
      entries.set(k, v);
    },
    removeItem: (k) => {
      entries.delete(k);
    },
  };
}
test('storage persists for the same verified identity while isolating authors, accounts, versions and instances', () => {
  const backing = memory();
  backing.setItem('host-session', 'private');
  const one = scopedStorage(backing, 'author-a:game:build:user-a', '1');
  one({ type: 'storage.set', key: 'save', value: 'level 2' });
  one({ type: 'storage.set', scope: 'instance', key: 'save', value: 'temporary' });
  const restarted = scopedStorage(backing, 'author-a:game:build:user-a', '2');
  expect(restarted({ type: 'storage.get', key: 'save' })).toEqual({ value: 'level 2' });
  expect(restarted({ type: 'storage.get', scope: 'instance', key: 'save' })).toEqual({
    value: null,
  });
  for (const id of [
    'author-b:game:build:user-a',
    'author-a:game:other-build:user-a',
    'author-a:game:build:user-b',
  ])
    expect(scopedStorage(backing, id, '1')({ type: 'storage.keys' })).toEqual({ keys: [] });
  expect(one({ type: 'storage.keys' })).toEqual({ keys: ['save'] });
  expect(backing.getItem('host-session')).toBe('private');
  expect(() => one({ type: 'storage.set', key: 'save', value: 'x'.repeat(1024 * 1024) })).toThrow(
    'quota',
  );
  expect(one({ type: 'storage.get', key: 'save' })).toEqual({ value: 'level 2' });
});
test('virtual files support chunked exports, revision checks, reads and scoped watches without host paths', async () => {
  const messages: Record<string, unknown>[] = [];
  let exported: ExportFile[] = [];
  const files = new NappletFiles(
    (m) => messages.push(m),
    (f) => {
      exported = f;
    },
  );
  const call = (type: string, values = {}) =>
    files.handle({ type: `fs.${type}`, ...values }, async () => true);
  const picked = await call('pickSaveFile', { options: { suggestedName: '../../sticker.webp' } });
  const path = picked.result!.entries![0].path;
  expect(path).toStartWith('/files/');
  expect(path.split('/')).toHaveLength(3);
  await call('watch', { path: '/files' });
  await call('write', { path, data: btoa('hello'), options: { mode: 'replace' } });
  await call('write', { path, data: btoa(' world'), options: { mode: 'append' } });
  expect(await exported[0].blob.text()).toBe('hello world');
  expect((await call('read', { path, options: { offset: 6, length: 5 } })).result).toMatchObject({
    data: btoa('world'),
    bytesRead: 5,
    eof: true,
  });
  await expect(
    call('write', { path, data: btoa('bad'), options: { ifRevision: 'stale' } }),
  ).rejects.toThrow('conflict');
  await expect(call('write', { path: '/etc/passwd', data: '' })).rejects.toThrow();
  await expect(call('read', { path: '/files/../private' })).rejects.toThrow();
  expect(messages.map((m) => m.type)).toEqual(['fs.changed', 'fs.changed']);
  await call('mkdir', { path: '/files/nested' });
  await call('move', { fromPath: path, toPath: '/files/nested/saved.webp' });
  await expect(call('remove', { path: '/files/nested' })).rejects.toThrow('conflict');
  await call('remove', { path: '/files/nested', recursive: true });
  expect(exported).toEqual([]);
});
test('file picker cancellation creates nothing and quotas fail before writes', async () => {
  const files = new NappletFiles(
    () => {},
    () => {},
  );
  await expect(files.handle({ type: 'fs.pickSaveFile' }, async () => false)).rejects.toThrow(
    'cancelled',
  );
  await expect(
    files.handle(
      { type: 'fs.write', path: '/files/large', data: btoa('x'.repeat(262145)) },
      async () => true,
    ),
  ).rejects.toThrow();
  expect(
    (await files.handle({ type: 'fs.list', path: '/files' }, async () => true)).entries,
  ).toEqual([]);
  expect(missingDomains(['shell', 'storage', 'resource', 'fs', 'cvm', 'inc'])).toEqual(['inc']);
});

test('native picks import atomic copies with virtual paths, directory structure and cancellation', async () => {
  let exports: ExportFile[] = [];
  const files = new NappletFiles(
    () => {},
    (value) => {
      exports = value;
    },
  );
  const call = (type: string, values = {}) => files.handle({ type, ...values }, async () => true);
  const selected = new File(['sample'], 'sound.wav');
  const result = await files.handle(
    { type: 'fs.pickFile' },
    async () => true,
    async () => [selected],
  );
  const path = result.result!.entries![0].path;
  expect(path).toMatch(/^\/files\/import-[^/]+\/sound.wav$/);
  expect((await call('fs.read', { path })).result!.data).toBe(btoa('sample'));
  await call('fs.write', { path, data: btoa('edited') });
  expect(await selected.text()).toBe('sample');
  const nested = new File(['nested'], 'logo.png');
  Object.defineProperty(nested, 'webkitRelativePath', { value: 'folder/images/logo.png' });
  const folder = await files.handle(
    { type: 'fs.pickDirectory' },
    async () => true,
    async () => [nested],
  );
  expect(folder.result!.entries![0].name).toBe('folder');
  expect(folder.result!.entries![0].kind).toBe('directory');
  const before = exports.length;
  await expect(
    files.handle(
      { type: 'fs.pickFiles' },
      async () => true,
      async () => [selected, new File(['bad'], '../escape')],
    ),
  ).rejects.toThrow();
  expect(exports.length).toBe(before);
  const abort = new AbortController();
  await expect(
    files.handle(
      { type: 'fs.pickFile' },
      async () => true,
      async () => {
        abort.abort();
        return [selected];
      },
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(exports.length).toBe(before);
});
