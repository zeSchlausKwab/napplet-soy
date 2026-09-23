import { test, expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { nip19 } from 'nostr-tools';
import { stack } from './publish-stack';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { inspectProject } from '../../packages/publish/src/project';
import { publishProject } from '../../packages/publish/src';
import { checkpoint } from '../../packages/publish/src/git-source';
import { Journal } from '../../packages/publish/src/journal';
import { readBinding, writeBinding } from '../../packages/publish/src/binding';
import { sourceGit } from '../../packages/grasp/src/client';
import { loadRemix, createRemix } from '../../packages/remix/src';
import { setupProject } from '../../apps/cli/src/toolchain';
import { proposeFromProject } from '../../apps/cli/src/share-project';
import { checkPublication } from '../../apps/cli/src/publish-check';
import { ProtocolClient } from '../../packages/client/src/nostr';
import {
  readRepository,
  readProposals,
  tag,
  validatePreview,
} from '../../packages/collaboration/src/protocol';

test.skipIf(!process.env.SPACE_TEST_WASM_PROJECT)(
  'a real Rust napplet publishes, clones with Cargo pins, rebuilds and proposes a playable revision through standard services',
  async () => {
    const services = await stack();
    const values = new Map<string, string>();
    const vault: Vault = {
      get: async (id) => values.get(id) ?? null,
      set: async (id, value) => {
        values.set(id, value);
      },
      delete: async (id) => {
        values.delete(id);
      },
    };
    const client = new ProtocolClient(() => [
      services.targets.relay,
      services.targets.grasp.replace('http:', 'ws:') + '/',
    ]);
    try {
      const owner = new Accounts('local', join(services.directory, 'owner'), vault);
      const contributor = new Accounts('local', join(services.directory, 'contributor'), vault);
      const alice = await owner.create(),
        bob = await contributor.create();
      const original = join(services.directory, 'original');
      await mkdir(original);
      const { contents } = await inspectProject(
        resolve(process.env.SPACE_TEST_WASM_PROJECT!),
        'local',
        '0'.repeat(64),
      );
      for (const [path, bytes] of contents) {
        await mkdir(dirname(join(original, path)), { recursive: true });
        await writeFile(join(original, path), bytes);
      }
      await checkpoint(original, 'Rust garden source', alice.pubkey);
      await writeBinding(original, {
        version: 1,
        project: {
          creator: { pubkey: alice.pubkey, network: 'local' },
          publish: { networks: { local: services.targets } },
        },
      });
      const first = await publishProject({
        directory: original,
        network: 'local',
        accounts: owner,
        check: checkPublication,
      });
      expect(first.status).toBe('announced_pending_index');
      const journal = new Journal(original, 'local');
      const published = await journal.load((await journal.index()).latest!);
      const loaded = await loadRemix(
        nip19.neventEncode({ id: published.current!.id, relays: [services.targets.relay] }),
        'local',
        AbortSignal.timeout(20000),
      );
      const remix = await createRemix(services.directory, 'remixed-garden', loaded);
      expect(remix.source).toBe('git');
      expect(await Bun.file(join(remix.directory, 'Cargo.lock')).text()).toBe(
        await Bun.file(join(original, 'Cargo.lock')).text(),
      );
      expect((await Bun.file(join(remix.directory, 'napplet.json')).json()).build.kind).toBe(
        'rust',
      );
      expect(
        (await sourceGit(remix.directory, ['ls-files']))
          .split('\n')
          .some((p) => p.startsWith('target/') || p.includes('.wasm')),
      ).toBe(false);
      const binding = (await readBinding(remix.directory))!;
      binding.project.creator = { pubkey: bob.pubkey, network: 'local' };
      binding.project.publish = { networks: { local: services.targets } };
      await writeBinding(remix.directory, binding);
      await setupProject(remix.directory);
      await Bun.write(
        join(remix.directory, 'index.html'),
        (await Bun.file(join(remix.directory, 'index.html')).text()).replaceAll(
          'Rust garden',
          'Our Rust garden',
        ),
      );
      await checkpoint(remix.directory, 'Give the garden a shared name', bob.pubkey);
      const proposed = await proposeFromProject({
        directory: remix.directory,
        network: 'local',
        accounts: contributor,
        description: 'A shared Rust garden',
        check: checkPublication,
      });
      const repo = await readRepository(client, binding.upstream!.address);
      const found = (await readProposals(client, repo)).find(
        (p) => p.root.id === proposed.proposal,
      )!;
      expect(found).toBeDefined();
      const preview = await validatePreview(
        await fetch(tag(found.revision, 'soy-preview')!).then((r) => r.bytes()),
        found.revision,
      );
      expect(preview.commit).toBe(await sourceGit(remix.directory, ['rev-parse', 'HEAD']));
      expect(await sourceGit(original, ['rev-parse', 'HEAD'])).toBe(published.commit);
      expect(await Bun.file(join(remix.directory, 'dist/index.html')).text()).toContain(
        'Our Rust garden',
      );
    } finally {
      client.close();
      await services.close();
    }
  },
  1200000,
);
