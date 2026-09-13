import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { prepareSource, sourceGit } from './client';

test('source preparation refuses uncommitted files and signer mutation before publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-source-'));
  const signer = new PrivateKeySigner();
  const input = {
    directory,
    signer,
    identifier: 'example',
    title: 'Example',
    origin: 'https://git.example',
  };
  try {
    await sourceGit(directory, ['init', '--initial-branch=main']);
    await Bun.write(join(directory, 'index.html'), '<!doctype html><h1>Source</h1>');
    await sourceGit(directory, ['add', 'index.html']);
    await sourceGit(directory, ['commit', '-m', 'First revision']);
    await Bun.write(join(directory, 'uncommitted.txt'), 'Not part of a release');
    await expect(prepareSource(input)).rejects.toThrow('Commit source changes');
    await rm(join(directory, 'uncommitted.txt'));
    await expect(
      prepareSource({
        ...input,
        signer: {
          getPublicKey: () => signer.getPublicKey(),
          signEvent: async (event) => {
            event.tags.find((t) => t[0] === 'clone')![1] = 'https://unselected.example/source.git';
            return signer.signEvent(event);
          },
        },
      }),
    ).rejects.toThrow('Signer changed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
