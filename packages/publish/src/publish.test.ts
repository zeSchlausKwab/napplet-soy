import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, type Vault } from '../../identity/src/accounts';
import { sha256, validateRelease, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { sourceGit, sourceUrls } from '../../grasp/src/client';
import { publishProject, publicationStatus, type PublishOptions } from './index';
import { Journal } from './journal';
import { newer } from './relay';
import { appReferences, descriptorImages } from '../../protocol/src/preview';

const previewPng = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
    'base64',
  ),
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'napplet-publish-'));
  const project = join(root, 'project');
  const config = {
    schema: 'space-local-project/v1',
    name: 'first creation',
    previewId: crypto.randomUUID(),
    entry: 'index.html',
    license: 'MIT',
    topics: ['#Visual'],
    requires: [],
    relays: [],
    servers: [],
  };
  await Bun.write(join(project, 'napplet.json'), JSON.stringify(config));
  await Bun.write(join(project, 'index.html'), '<!doctype html><title>One</title><p>One</p>');
  await Bun.write(join(project, 'LICENSE'), 'MIT license');
  const secrets = new Map<string, string>();
  const vault: Vault = {
    get: async (id) => secrets.get(id) ?? null,
    set: async (id, value) => {
      secrets.set(id, value);
    },
    delete: async (id) => {
      secrets.delete(id);
    },
  };
  const accounts = new Accounts('local', join(root, 'accounts'), vault);
  const creator = await accounts.create();
  const events = new Map<string, SignedEvent[]>();
  const blobs = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const record = (url: string, input: SignedEvent) => {
    const event = verifiedEvent(input),
      rows = events.get(url) ?? [];
    if (!rows.some((e) => e.id === event.id)) {
      rows.push(event);
      writes.push(event.id);
    }
    events.set(url, rows);
  };
  const latest = async (url: string, pubkey: string, identifier: string, kind: number) =>
    (events.get(url) ?? [])
      .filter(
        (e) =>
          e.pubkey === pubkey &&
          e.kind === kind &&
          e.tags.some((t) => t[0] === 'd' && t[1] === identifier),
      )
      .reduce<SignedEvent | null>((best, e) => (!best || newer(e, best) ? e : best), null);
  const deps: NonNullable<PublishOptions['dependencies']> = {
    website: async () => ({ checkedAt: Date.now(), ready: false, reason: 'pending' }),
    relays: {
      latest,
      ensure: async (url, event) => {
        record(url, event);
      },
      close() {},
    },
    source: async (input) => {
      const urls = sourceUrls(
        input.origin,
        input.publication.state.pubkey,
        input.publication.state.tags.find((t) => t[0] === 'd')![1],
        input.local,
      );
      record(urls.relay, input.publication.announcement);
      record(urls.relay, input.publication.state);
      return {
        ...input.publication,
        ...urls,
        commit: input.publication.state.tags.find((t) => t[0] === 'refs/heads/main')![1],
        refs: [],
        changed: true,
      };
    },
    owned: async () => new Set(blobs.keys()),
    verified: async (_origin, hash, length) =>
      blobs.get(hash)?.length === length && (await sha256(blobs.get(hash)!)) === hash,
    upload: async ({ bytes, origin, type }) => {
      const hash = await sha256(bytes);
      blobs.set(hash, bytes);
      writes.push(hash);
      return {
        descriptor: {
          sha256: hash,
          size: bytes.length,
          type,
          uploaded: 1,
          url: `${origin}/${hash}.bin`,
        },
        created: true,
      };
    },
  };
  const options: PublishOptions = {
    directory: project,
    network: 'local',
    accounts,
    check: async () => ({ profile: 'test', browser: 'test' }),
    dependencies: deps,
  };
  const journal = new Journal(project, 'local');
  const load = async () => {
    const index = await journal.index();
    return journal.load((index.active ?? index.latest)!);
  };
  return {
    root,
    project,
    config,
    accounts,
    creator,
    events,
    blobs,
    writes,
    record,
    deps,
    options,
    journal,
    load,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test('preview upload and linked descriptor survive interruption with identical signatures and image bytes', async () => {
  const f = await fixture();
  try {
    f.options.requirePreview = true;
    f.options.check = async () => ({ profile: 'test', browser: 'test', preview: previewPng });
    f.deps.checkpoint = async (job) => {
      if (job.receipts.descriptor) throw new Error('Crash after descriptor acknowledgement');
    };
    await expect(publishProject(f.options)).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    const interrupted = await f.load();
    expect(interrupted.receipts).toMatchObject({
      preview: true,
      descriptor: true,
      snapshot: false,
    });
    expect(f.blobs.get(interrupted.preview!.hash)).toEqual(previewPng);
    const ref = appReferences(interrupted.current!)[0];
    expect(ref.kind).toBe(32267);
    expect(ref.relay).toBe(interrupted.plan.targets.relay);
    expect(ref.pubkey).toBe(f.creator.pubkey);
    expect(descriptorImages(interrupted.preview!.descriptor!)).toEqual([
      `${interrupted.plan.targets.blossom}/${await sha256(previewPng)}`,
    ]);
    delete f.deps.checkpoint;
    f.options.check = async () => {
      throw new Error('Resume must never recapture');
    };
    await publishProject({ ...f.options, resume: true });
    const resumed = await f.load();
    expect(resumed.preview).toEqual(interrupted.preview);
    expect(resumed.current).toEqual(interrupted.current);
    expect(resumed.snapshot).toEqual(interrupted.snapshot);
    expect(resumed.status).toBe('announced_pending_index');
    await Bun.write(join(f.journal.directory(resumed.id), 'preview.png'), 'tampered');
    const before = f.writes.length;
    await expect(publishProject({ ...f.options, resume: true })).rejects.toMatchObject({
      code: 'FROZEN_PREVIEW_CHANGED',
    });
    expect(f.writes.length).toBe(before);
  } finally {
    await f.close();
  }
});

test('older releases gain a preview without code edits; Blossom can change on a subsequent release', async () => {
  const f = await fixture();
  const publish = async () => {
    const result = await publishProject(f.options);
    if (result.status === 'dry_run') throw new Error('Expected publication');
    return result;
  };
  try {
    const old = await publish();
    f.options.requirePreview = true;
    f.options.check = async () => ({ profile: 'test', browser: 'test', preview: previewPng });
    const upgraded = await publish();
    expect(upgraded.artifactHash).toBe(old.artifactHash);
    expect(upgraded.currentId).not.toBe(old.currentId);
    expect(upgraded.preview!.hash).toBe(await sha256(previewPng));
    expect((await publish()).currentId).toBe(upgraded.currentId);
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({ ...f.config, publish: { blossom: 'http://127.0.0.1:9988' } }),
    );
    const moved = await publish();
    expect(moved.preview!.url).toStartWith('http://127.0.0.1:9988/');
    expect((await f.load()).current!.tags).toContainEqual(['server', 'http://127.0.0.1:9988']);
    expect(moved.creator).toBe(old.creator);
  } finally {
    await f.close();
  }
});

test('required preview cannot be silently omitted and a selected missing image fails before publication', async () => {
  const f = await fixture();
  try {
    await expect(publishProject({ ...f.options, requirePreview: true })).rejects.toMatchObject({
      code: 'PREVIEW_REQUIRED',
    });
    expect(f.writes).toHaveLength(0);
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({ ...f.config, preview: { image: 'missing.png' } }),
    );
    await expect(publishProject(f.options)).rejects.toBeDefined();
    expect(f.writes).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('dry-run inspects explicit source and targets without signing, contacting services or creating a journal', async () => {
  const f = await fixture();
  try {
    f.options.accounts = {
      current: () => f.accounts.current(),
      signer: async () => {
        throw new Error('must not open');
      },
    };
    f.options.check = async () => {
      throw new Error('must not execute');
    };
    f.deps.relays!.latest = async () => {
      throw new Error('must not contact');
    };
    await Bun.write(join(f.project, '.env'), 'PRIVATE=not public');
    const result = await publishProject({ ...f.options, dryRun: true });
    expect(result.status).toBe('dry_run');
    if (result.status !== 'dry_run') throw new Error();
    expect(result.plan.files.map((f) => f.path)).toEqual(['LICENSE', 'index.html', 'napplet.json']);
    expect(result.plan.topics).toEqual(['visual']);
    expect(f.writes).toHaveLength(0);
    expect(await Bun.file(join(f.project, '.napplet-space/local/index.json')).exists()).toBe(false);
    expect(await publicationStatus(f.project, 'local')).toEqual({ status: 'not_started' });
  } finally {
    await f.close();
  }
});
test('remix publication preserves standard ancestry while snapshots reference their own napplet', async () => {
  const f = await fixture();
  try {
    const remix = {
      parent: `35129:${'a'.repeat(64)}:parent`,
      origin: `15129:${'b'.repeat(64)}:`,
      revision: 'c'.repeat(64),
    };
    await Bun.write(join(f.project, 'napplet.json'), JSON.stringify({ ...f.config, remix }));
    await publishProject(f.options);
    const job = await f.load();
    expect(job.current!.tags.filter((t) => t[0] === 'a')).toEqual([['a', remix.parent]]);
    expect(job.current!.tags.filter((t) => t[0] === 'A')).toEqual([['A', remix.origin]]);
    expect(job.snapshot!.tags.filter((t) => t[0] === 'a')).toEqual([
      ['a', `35129:${f.creator.pubkey}:${job.plan.identifier}`],
    ]);
    expect(job.snapshot!.tags.filter((t) => t[0] === 'A')).toEqual([['A', remix.origin]]);
    expect((await publishProject(f.options)).status).toBe('announced_pending_index');
  } finally {
    await f.close();
  }
});
test('confirmed website readiness is journaled after relay receipts, and local status does not contact services', async () => {
  const f = await fixture();
  try {
    f.deps.website = async (job) => {
      expect(Object.values((await f.load()).receipts).every(Boolean)).toBe(true);
      expect(job.current?.id).toBeTruthy();
      expect(job.snapshot?.id).toBeTruthy();
      return { checkedAt: Date.now(), ready: true, reason: 'ready' };
    };
    const published = await publishProject(f.options);
    expect(published.status).toBe('indexed');
    expect(published).toMatchObject({ websiteReady: true, websiteStatus: 'ready' });
    f.deps.website = async () => {
      throw new Error('status must remain local');
    };
    expect(await publicationStatus(f.project, 'local')).toMatchObject({
      status: 'indexed',
      websiteReady: true,
    });
    expect((await f.load()).website?.checkedAt).toBeGreaterThan(0);
  } finally {
    await f.close();
  }
});
test('first publish is standard and retry preserves every signed event, artifact and source commit', async () => {
  const f = await fixture();
  try {
    await sourceGit(f.project, ['init', '--initial-branch=main']);
    await Bun.write(join(f.project, 'unrelated-private.txt'), 'private old history');
    await sourceGit(f.project, ['add', '--', 'unrelated-private.txt']);
    await sourceGit(f.project, ['commit', '-m', 'Private work']);
    const first = await publishProject(f.options);
    expect(first.status).toBe('announced_pending_index');
    const job = await f.load();
    const release = await validateRelease(job.current, job.snapshot);
    expect(release.identity.pubkey).toBe(f.creator.pubkey);
    expect(job.current!.tags.filter((t) => t[0] === 't')).toEqual([['t', 'visual']]);
    expect(job.snapshot!.tags.some((t) => t[0] === 'd')).toBe(false);
    expect(job.current!.tags.find((t) => t[0] === 'source')![1]).toStartWith('nostr://');
    const repo = join(f.journal.directory(job.id), 'source');
    expect(await sourceGit(repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(await sourceGit(repo, ['ls-tree', '-r', '--name-only', 'HEAD'])).not.toContain(
      'private',
    );
    const writes = [...f.writes];
    const second = await publishProject(f.options);
    expect(second).toMatchObject({
      unchanged: true,
      sourceCommit: job.commit,
      currentId: job.current!.id,
      snapshotId: job.snapshot!.id,
      websiteReady: false,
    });
    expect(f.writes).toEqual(writes);
  } finally {
    await f.close();
  }
});
test('a built project uploads compiled HTML and publishes editable source with standard capability metadata', async () => {
  const f = await fixture();
  try {
    await sourceGit(f.project, ['init', '--initial-branch=main']);
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({ ...f.config, entry: 'dist/index.html' }),
    );
    await Bun.write(join(f.project, '.gitignore'), 'dist/\nnode_modules/\n.napplet-space/\n');
    await Bun.write(join(f.project, 'src/main.ts'), 'export const message: string = "compiled";');
    await Bun.write(
      join(f.project, 'index.html'),
      '<script type="module" src="/src/main.ts"></script>',
    );
    const html =
      '<!doctype html><meta name="napplet-requires" content="storage,theme"><p>compiled</p>';
    await Bun.write(join(f.project, 'dist/index.html'), html);
    const first = await publishProject(f.options);
    const job = await f.load();
    expect(first.status).toBe('announced_pending_index');
    expect(job.plan.artifactHash).toBe(await sha256(html));
    expect(new TextDecoder().decode(f.blobs.get(job.plan.artifactHash))).toBe(html);
    const release = await validateRelease(job.current, job.snapshot);
    expect(release.current.tags.filter((t) => t[0] === 'requires')).toEqual([
      ['requires', 'storage'],
      ['requires', 'theme'],
    ]);
    const source = join(f.journal.directory(job.id), 'source');
    expect(await sourceGit(source, ['show', 'HEAD:src/main.ts'])).toContain('export const message');
    expect(await sourceGit(source, ['show', 'HEAD:dist/index.html'])).toBe(html);
    expect(await sourceGit(source, ['show', 'HEAD:index.html'])).toContain('/src/main.ts');
    const writes = [...f.writes];
    expect(await publishProject(f.options)).toMatchObject({
      unchanged: true,
      sourceCommit: job.commit,
    });
    expect(f.writes).toEqual(writes);
  } finally {
    await f.close();
  }
});
test('uncertain upload and relay acknowledgement resume the exact saved events without a second snapshot', async () => {
  const f = await fixture();
  try {
    const upload = f.deps.upload!;
    f.deps.upload = async (input) => {
      await upload(input);
      f.deps.upload = upload;
      throw new Error('Connection lost after upload');
    };
    await expect(publishProject(f.options)).rejects.toMatchObject({
      code: 'PUBLISH_FAILED',
      stage: 'upload',
      retryable: true,
    });
    const prepared = await f.load();
    const firstHash = [...f.blobs.keys()][0];
    const ensure = f.deps.relays!.ensure;
    f.deps.relays!.ensure = async (url, event) => {
      await ensure(url, event);
      if (event.kind === 5129) {
        f.deps.relays!.ensure = ensure;
        throw new Error('Connection lost after event');
      }
    };
    await expect(publishProject({ ...f.options, resume: true })).rejects.toMatchObject({
      stage: 'snapshot',
    });
    expect(f.writes.filter((id) => id === firstHash)).toHaveLength(1);
    expect((await f.load()).snapshot!.id).toBe(prepared.snapshot!.id);
    const final = await publishProject({ ...f.options, resume: true });
    expect(final).toMatchObject({
      status: 'announced_pending_index',
      snapshotId: prepared.snapshot!.id,
      sourceCommit: prepared.commit,
    });
    expect(f.writes.filter((id) => id === prepared.snapshot!.id)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('pending source stays frozen across editor changes; the next release retains history and release refs', async () => {
  const f = await fixture();
  try {
    f.deps.checkpoint = async (job) => {
      if (job.current) {
        delete f.deps.checkpoint;
        throw new Error('Interrupted');
      }
    };
    await expect(publishProject(f.options)).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    const old = await f.load();
    await Bun.write(join(f.project, 'index.html'), '<!doctype html><title>Two</title>Two');
    await expect(publishProject(f.options)).rejects.toMatchObject({ code: 'PUBLISH_PENDING' });
    await publishProject({ ...f.options, resume: true });
    const next = await publishProject(f.options);
    const latest = await f.load();
    expect(latest.current!.created_at).toBeGreaterThan(old.current!.created_at);
    expect(latest.id).not.toBe(old.id);
    expect(latest.source!.state.tags.filter((t) => t[0].startsWith('refs/tags/'))).toHaveLength(2);
    expect(
      await sourceGit(join(f.journal.directory(latest.id), 'source'), ['rev-parse', 'HEAD^']),
    ).toBe(old.commit);
    expect(next).toMatchObject({
      artifactHash: await sha256(await Bun.file(join(f.project, 'index.html')).bytes()),
    });
    expect(await sha256(f.blobs.get(old.plan.artifactHash)!)).toBe(old.plan.artifactHash);
  } finally {
    await f.close();
  }
});
test('metadata-only changes create a new release with the same artifact and stable identity', async () => {
  const f = await fixture();
  try {
    await publishProject(f.options);
    const first = await f.load();
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({ ...f.config, title: 'New title' }),
    );
    await publishProject(f.options);
    const second = await f.load();
    expect(second.plan.identifier).toBe(first.plan.identifier);
    expect(second.plan.artifactHash).toBe(first.plan.artifactHash);
    expect(second.snapshot!.id).not.toBe(first.snapshot!.id);
    expect(f.writes.filter((id) => id === first.plan.artifactHash)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('competing remote current events prevent stale writes, including retries of an already published job', async () => {
  const f = await fixture();
  try {
    await publishProject(f.options);
    const job = await f.load();
    const signer = await f.accounts.signer();
    try {
      f.record(
        job.plan.targets.relay,
        await signer.signEvent({
          kind: 35129,
          created_at: job.createdAt + 5,
          content: 'another machine',
          tags: [['d', job.plan.identifier]],
        }),
      );
    } finally {
      await signer.close();
    }
    const writes = [...f.writes];
    await expect(publishProject({ ...f.options, resume: true })).rejects.toMatchObject({
      code: 'REMOTE_CONFLICT',
    });
    expect(f.writes).toEqual(writes);
  } finally {
    await f.close();
  }
});
test('source changing during validation stops before signing or service mutations', async () => {
  const f = await fixture();
  try {
    f.options.check = async () => {
      await Bun.write(join(f.project, 'index.html'), 'changed');
      return { profile: 'test', browser: 'test' };
    };
    await expect(publishProject(f.options)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    expect(f.writes).toHaveLength(0);
    expect((await f.journal.index()).active).toBeNull();
  } finally {
    await f.close();
  }
});
test('concurrent publishers are excluded and release the lock after interruption', async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const wait = new Promise<void>((r) => {
    release = r;
  });
  try {
    f.options.check = async () => {
      entered();
      await wait;
      return { profile: 'test', browser: 'test' };
    };
    const running = publishProject(f.options);
    await started;
    await expect(publishProject(f.options)).rejects.toMatchObject({ code: 'PUBLISH_BUSY' });
    release();
    await running;
    expect((await publishProject(f.options)).status).toBe('announced_pending_index');
  } finally {
    release();
    await f.close();
  }
});
test('symlinks, credentials, private filenames, mismatched creators and malformed state are rejected', async () => {
  const f = await fixture();
  try {
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({ ...f.config, creator: { pubkey: 'a'.repeat(64), network: 'local' } }),
    );
    await expect(publishProject({ ...f.options, dryRun: true })).rejects.toMatchObject({
      code: 'CREATOR_MISMATCH',
    });
    await Bun.write(
      join(f.project, 'napplet.json'),
      JSON.stringify({
        ...f.config,
        publish: { files: ['index.html', 'napplet.json', 'LICENSE', '.env'] },
      }),
    );
    await Bun.write(join(f.project, '.env'), 'private');
    await expect(publishProject({ ...f.options, dryRun: true })).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
    });
    await Bun.write(join(f.project, 'napplet.json'), JSON.stringify(f.config));
    await Bun.write(join(f.project, 'index.html'), '-----BEGIN OPENSSH PRIVATE KEY-----');
    await expect(publishProject({ ...f.options, dryRun: true })).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
    });
    await rm(join(f.project, 'index.html'));
    await symlink(join(f.project, 'LICENSE'), join(f.project, 'index.html'));
    await expect(publishProject({ ...f.options, dryRun: true })).rejects.toMatchObject({
      code: 'SOURCE_PATH',
    });
    await Bun.write(join(f.project, '.napplet-space/local/index.json'), '{bad');
    await expect(publicationStatus(f.project, 'local')).rejects.toMatchObject({
      code: 'JOURNAL_INVALID',
    });
    expect(f.writes).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('frozen bytes and saved signatures are checked before a resumed publication can write', async () => {
  const f = await fixture();
  try {
    f.deps.checkpoint = async (job) => {
      if (job.current) {
        delete f.deps.checkpoint;
        throw new Error('Interrupted');
      }
    };
    await expect(publishProject(f.options)).rejects.toThrow();
    const job = await f.load();
    job.current!.tags.push(['title', 'forged']);
    await f.journal.save(job);
    await expect(publishProject({ ...f.options, resume: true })).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
    await Bun.write(join(f.journal.directory(job.id), 'source/index.html'), 'modified');
    await expect(publishProject({ ...f.options, resume: true })).rejects.toMatchObject({
      code: 'FROZEN_SOURCE_CHANGED',
    });
  } finally {
    await f.close();
  }
});

test('a repeated publication repairs missing relay events/blobs and retries failed mirrors without signing another release', async () => {
  const f = await fixture();
  try {
    const mirror = 'ws://127.0.0.1:4567/';
    f.options.targets = { mirrors: [mirror] };
    const ensure = f.deps.relays!.ensure;
    f.deps.relays!.ensure = async (url, event) => {
      if (url === mirror) throw new Error('offline mirror');
      await ensure(url, event);
    };
    await publishProject(f.options);
    const first = await f.load();
    expect(first.mirrors[mirror]).toBe(false);
    f.deps.relays!.ensure = ensure;
    f.events.set(first.plan.targets.relay, []);
    f.blobs.delete(first.plan.artifactHash);
    const repaired = await publishProject(f.options);
    expect(repaired).toMatchObject({
      currentId: first.current!.id,
      snapshotId: first.snapshot!.id,
      mirrors: { [mirror]: true },
    });
    expect(f.events.get(first.plan.targets.relay)).toHaveLength(2);
    expect(f.events.get(mirror)).toHaveLength(2);
    expect(await sha256(f.blobs.get(first.plan.artifactHash)!)).toBe(first.plan.artifactHash);
  } finally {
    await f.close();
  }
});

test('public and local endpoints cannot be mixed and saved targets cannot change during resume', async () => {
  const f = await fixture();
  try {
    for (const target of [
      'wss://relay.example',
      'ws://localhost:8080',
      'ws://127.0.0.1.evil.example',
    ])
      await expect(
        publishProject({ ...f.options, dryRun: true, targets: { relay: target } }),
      ).rejects.toMatchObject({ code: 'PUBLISH_TARGET' });
    for (const target of ['https://127.0.0.1', 'https://192.168.1.1', 'https://localhost'])
      await expect(
        publishProject({
          ...f.options,
          network: 'public',
          dryRun: true,
          targets: { blossom: target },
        }),
      ).rejects.toMatchObject({ code: 'PUBLISH_TARGET' });
    f.deps.checkpoint = async () => {
      delete f.deps.checkpoint;
      throw new Error('Interrupted');
    };
    await expect(publishProject(f.options)).rejects.toThrow();
    await expect(
      publishProject({ ...f.options, resume: true, targets: { blossom: 'http://127.0.0.1:9999' } }),
    ).rejects.toMatchObject({ code: 'PUBLISH_TARGET' });
    expect(f.writes).toHaveLength(0);
  } finally {
    await f.close();
  }
});
