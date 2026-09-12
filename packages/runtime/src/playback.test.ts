import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import records from '../../backend/data/catalog.json';
import { publicNapplet } from '../../backend/src/public-model';
import { preparePlayback } from './playback';

test('fixtures and relay-imported copies have identical playback identity and capabilities', async () => {
  for (const record of records) {
    expect((await preparePlayback(record.current, record.artifactHash)).hostIdentity).toBe(
      (await preparePlayback(record.snapshot, record.artifactHash)).hostIdentity,
    );
    for (const manifest of [record.current, record.snapshot]) {
      expect(manifest.tags.some((t) => ['space', 't', 'e'].includes(t[0]))).toBe(false);
      const imported = await publicNapplet(manifest);
      const local = await preparePlayback(manifest, record.artifactHash);
      const remote = await preparePlayback(imported.manifest, imported.artifactHash);
      expect(local.hostIdentity).toBe(remote.hostIdentity);
      expect(local.domains).toEqual(remote.domains);
      expect(local.aggregateHash).toBe(imported.aggregateHash);
    }
  }
});

test('snapshots preserve app identity and cannot claim another signer’s storage', async () => {
  const record = records[0];
  const key = new Uint8Array(32);
  key[31] = 2;
  const otherAuthor = finalizeEvent({ ...record.snapshot }, key);
  key[31] = 1;
  const otherApp = finalizeEvent(
    {
      ...record.snapshot,
      tags: record.snapshot.tags.map((t) =>
        t[0] === 'a' ? ['a', `35129:${record.pubkey}:other`] : t,
      ),
    },
    key,
  );
  const original = await preparePlayback(record.snapshot, record.artifactHash);
  for (const manifest of [otherAuthor, otherApp])
    expect((await preparePlayback(manifest, record.artifactHash)).hostIdentity).not.toBe(
      original.hostIdentity,
    );
});

test('local and imported metadata cannot bypass required capabilities or artifact verification', async () => {
  const record = records[0];
  const key = new Uint8Array(32);
  key[31] = 1;
  const manifest = finalizeEvent(
    { ...record.current, tags: [...record.current.tags, ['requires', 'cvm']] },
    key,
  );
  const imported = await publicNapplet(manifest);
  expect(imported.availability).toBe('host-required');
  for (const event of [manifest, imported.manifest])
    await expect(preparePlayback(event, record.artifactHash)).rejects.toThrow('cvm');
  await expect(preparePlayback(record.current, '0'.repeat(64))).rejects.toThrow('does not match');
});
