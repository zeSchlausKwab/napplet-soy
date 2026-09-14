import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { nip19, matchFilters, type Filter } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';
import { take, takeUntil, takeWhile, timer } from 'rxjs';
import {
  sha256,
  decodeAddress,
  identityAddress,
  verifiedEvent,
  type SignedEvent,
} from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { remixLineage } from '../../protocol/src/remix';
import { manifestTopics } from '../../protocol/src/topics';
import { fetchPublicBytes } from '../../backend/src/blossom';
import { PreviewWebSocket, previewRelayUrl } from '../../backend/src/preview-relay';
import { projectSchema } from '../../publish/src/config';
import { sourceGit } from '../../grasp/src/client';
import { sourceArchive } from './archive';
import type { Network } from '../../identity/src/signer';
import { AccountError } from '../../identity/src/signer';
import discoveryRelays from '../../nostr/discovery-relays.json';

export async function remixBytes(url: URL, local: boolean, signal: AbortSignal, limit: number) {
  if (!local) return fetchPublicBytes(url, signal, limit);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Local remixes use loopback HTTP only');
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit)
    throw new Error('Download unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Download too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function loadRemix(reference: string, network: Network, signal: AbortSignal) {
  let site = network === 'local' ? 'http://localhost:8080' : 'https://napplet.soy';
  let ref = reference.replace(/^nostr:/, ''),
    hints: string[] = [];
  if (/^https?:/.test(reference)) {
    const url = new URL(reference);
    const match = /^\/(?:n\/(naddr1[^/]+)|r\/([a-f0-9]{64}))\/?$/.exec(url.pathname);
    if (!match || url.username || url.password || url.search || url.hash)
      throw new Error('Use the portable or pinned napplet link');
    ref = match[1] ?? match[2];
    site = url.origin;
  }
  let filter: Filter;
  if (ref.startsWith('naddr1')) {
    const identity = decodeAddress(ref);
    identityAddress(identity);
    const decoded = nip19.decode(ref);
    if (decoded.type === 'naddr') hints = decoded.data.relays ?? [];
    filter = {
      kinds: [identity.kind],
      authors: [identity.pubkey],
      ...(identity.kind === 35129 ? { '#d': [identity.identifier] } : {}),
      limit: 3,
    };
  } else {
    if (/^(nevent|note)1/.test(ref)) {
      const decoded = nip19.decode(ref);
      if (decoded.type === 'nevent') {
        ref = decoded.data.id;
        hints = decoded.data.relays ?? [];
      } else if (decoded.type === 'note') ref = decoded.data;
    }
    if (!/^[a-f0-9]{64}$/.test(ref))
      throw new Error('Use a napplet naddr, event identifier, or pinned link');
    filter = { ids: [ref], kinds: [35129, 15129, 5129], limit: 1 };
  }
  const api = new URL('/api/manifest', site);
  api.searchParams.set('reference', ref);
  let manifest: SignedEvent | undefined;
  try {
    const result = JSON.parse(
      new TextDecoder().decode(await remixBytes(api, network === 'local', signal, 150000)),
    );
    const event = verifiedEvent(result.manifest);
    if (!matchFilters([filter], event)) throw new Error('Wrong manifest');
    await validateManifest(event);
    manifest = event;
  } catch {
    /* An independent client can resolve the same Nostr identity directly. */
  }
  if (!manifest) {
    const destinations =
      network === 'local'
        ? ['ws://127.0.0.1:19347/relay']
        : [...new Set([...hints, 'wss://napplet.soy/relay', ...discoveryRelays])]
            .filter((r) => {
              try {
                previewRelayUrl(r);
                return true;
              } catch {
                return false;
              }
            })
            .slice(0, 8);
    const pool = new RelayPool(network === 'local' ? {} : { WebSocket: PreviewWebSocket as any });
    const events: SignedEvent[] = [];
    try {
      await Promise.all(
        destinations.map(
          (relay) =>
            new Promise<void>((done) => {
              pool
                .req([relay], [filter], { reconnect: false, waitForAuth: false })
                .pipe(
                  takeWhile((m) => m.type !== 'EOSE' && m.type !== 'CLOSED', true),
                  take(12),
                  takeUntil(timer(5000)),
                )
                .subscribe({
                  next: (m) => {
                    if (m.type === 'EVENT')
                      try {
                        const e = verifiedEvent(m.event);
                        if (matchFilters([filter], e) && e.created_at <= Date.now() / 1000 + 60)
                          events.push(e);
                      } catch {}
                  },
                  error: () => done(),
                  complete: done,
                });
            }),
        ),
      );
    } finally {
      pool.close();
    }
    manifest = events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  }
  if (!manifest) throw new Error('The napplet could not be found on its relays');
  const release = await validateManifest(manifest);
  let artifact: Uint8Array | undefined;
  for (const url of [
    new URL(`/api/artifacts/${release.artifactHash}`, site).href,
    ...release.servers.map((s) => `${s.replace(/\/$/, '')}/${release.artifactHash}`),
  ]) {
    try {
      const bytes = await remixBytes(new URL(url), network === 'local', signal, 10 * 1024 * 1024);
      if ((await sha256(bytes)) === release.artifactHash) {
        artifact = bytes;
        break;
      }
    } catch {}
  }
  if (!artifact) throw new Error('No verified download is available for this version');
  let files: Map<string, Uint8Array> | undefined;
  const archive = manifest.tags.find((t) => t[0] === 'source-archive')?.[1];
  if (archive) {
    const url = new URL(archive),
      hash = /\/([a-f0-9]{64})(?:\.tar)?$/.exec(url.pathname)?.[1];
    if (!hash) throw new Error('The signed source archive needs a content hash');
    const bytes = await remixBytes(url, network === 'local', signal, 50 * 1024 * 1024);
    if ((await sha256(bytes)) !== hash) throw new Error('Source archive hash mismatch');
    files = sourceArchive(bytes);
  }
  return { manifest, artifact, files };
}

export async function createRemix(
  parent: string,
  name: string,
  input: Awaited<ReturnType<typeof loadRemix>>,
) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
    throw new AccountError('REMIX_FOLDER', 'Choose a new lowercase folder name.');
  const lineage = await remixLineage(input.manifest);
  const files = input.files ?? new Map<string, Uint8Array>();
  const decode = (path: string) =>
    new TextDecoder('utf-8', { fatal: true }).decode(files.get(path));
  let previous = files.has('napplet.json')
    ? projectSchema.parse(JSON.parse(decode('napplet.json')))
    : undefined;
  const entry = previous?.entry ?? 'index.html';
  if (files.has(entry) && (await sha256(files.get(entry)!)) !== (await sha256(input.artifact)))
    throw new Error('Source archive does not contain this version’s artifact');
  const target = resolve(parent, name);
  await mkdir(target); // Refuse overwrite before writing any source.
  try {
    for (const [path, bytes] of files) {
      if (path === 'napplet.json') continue;
      await mkdir(dirname(join(target, path)), { recursive: true });
      await writeFile(join(target, path), bytes, { flag: 'wx' });
    }
    await mkdir(dirname(join(target, entry)), { recursive: true });
    if (!files.has(entry)) await writeFile(join(target, entry), input.artifact, { flag: 'wx' });
    const previewId = crypto.randomUUID();
    const config = {
      ...(previous ?? {}),
      schema: 'space-local-project/v1',
      name,
      title:
        `${previous?.title ?? previous?.name ?? input.manifest.tags.find((t) => t[0] === 'title')?.[1] ?? 'Napplet'} remix`.slice(
          0,
          160,
        ),
      entry,
      previewId,
      identifier: `n-${previewId.replaceAll('-', '').slice(0, 11)}`,
      description: previous?.description ?? '',
      license: previous?.license ?? 'UNLICENSED',
      requires:
        previous?.requires ??
        input.manifest.tags.filter((t) => t[0] === 'requires').map((t) => t[1]),
      topics: previous?.topics ?? manifestTopics(input.manifest),
      relays: previous?.relays ?? [],
      servers:
        previous?.servers ??
        input.manifest.tags
          .filter((t) => t[0] === 'server')
          .map((t) => t[1])
          .slice(0, 8),
      remix: lineage,
    };
    delete (config as Record<string, unknown>).creator;
    delete (config as Record<string, unknown>).publish;
    await writeFile(join(target, 'napplet.json'), JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx',
    });
    if (!files.has('AGENTS.md'))
      await writeFile(
        join(target, 'AGENTS.md'),
        '# Remix workspace\n\nRead docs/napplet-space.md for the installed upstream creator skills and CLI commands. Preserve original license notices and the remix lineage in napplet.json. Use the host-mediated NAP APIs and keep the playable build self-contained. Never put private signing keys in this repository.\n',
      );
    if (!files.has('LICENSE'))
      await writeFile(
        join(target, 'LICENSE'),
        'No source license was supplied with this manifest. Check the original source before distributing changes.\n',
      );
    if (!files.has('package.json'))
      await writeFile(
        join(target, 'package.json'),
        JSON.stringify(
          {
            name,
            private: true,
            scripts: {
              dev: 'napplet-space dev',
              check: 'napplet-space check',
              publish: 'napplet-space publish',
            },
          },
          null,
          2,
        ) + '\n',
      );
    const notice = `\n\nRemixed from Nostr event ${input.manifest.id}.\nOriginal napplet: ${lineage.parent}\nOriginal creator: ${input.manifest.pubkey}\nSource: ${files.size ? 'hash-verified author-published source archive' : 'verified self-contained HTML'}${lineage.sourceCommit ? `\nAuthor-recorded source commit: ${lineage.sourceCommit}` : ''}\n`;
    await writeFile(
      join(target, 'README.md'),
      (files.has('README.md') ? decode('README.md') : `# ${name}`) + notice,
    );
    await writeFile(
      join(target, '.gitignore'),
      (files.has('.gitignore') ? decode('.gitignore') : '') +
        '\n.napplet-space/\nnode_modules/\n.env\n.env.*\n*.nsec\n',
    );
    await sourceGit(target, ['init', '--initial-branch=main']);
    return {
      directory: target,
      lineage,
      source: files.size ? 'archive' : 'html',
      needsSetup: entry === 'dist/index.html',
    };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
