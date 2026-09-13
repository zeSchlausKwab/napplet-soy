import { mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import {
  graspOrigin,
  prepareSource,
  publishSource,
  sourceGit,
  type SourcePublication,
} from '../packages/grasp/src/client';
import { validateRelease, verifiedEvent, sha256 } from '../packages/protocol/src';
import { readBounded } from '../packages/blossom/src/client';

const root = resolve(import.meta.dir, '..');
export const localGraspOrigin = 'http://127.0.0.1:8082';
export const localGraspInstance = createHash('sha256').update(root).digest('hex').slice(0, 16);
export function graspEnvironment(input: {
  origin: string;
  directory: string;
  local: boolean;
  instance: string;
  bind?: string;
}) {
  const origin = graspOrigin(input.origin, input.local);
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    SPACE_GRASP_LOCAL_ONLY: input.local ? '1' : '0',
    NGIT_DOMAIN: new URL(origin).host,
    NGIT_BASE_PATH: '/',
    NGIT_BIND_ADDRESS: input.bind ?? '127.0.0.1:19349',
    NGIT_GIT_DATA_PATH: resolve(input.directory, 'git'),
    NGIT_RELAY_DATA_PATH: resolve(input.directory, 'relay'),
    NGIT_DATABASE_BACKEND: 'lmdb',
    NGIT_RELAY_NAME: `Napplet Space Git (${input.instance})`,
    NGIT_RELAY_DESCRIPTION: 'Open source napplet repositories, authorized by signed Nostr state.',
    NGIT_USER_INDEX_RELAYS: '',
    NGIT_SYNC_PLUS_FALLBACK_RELAYS: '',
    NGIT_SYNC_PLUS_ENABLED: 'false',
    NGIT_LOG_LEVEL: 'info',
    NGIT_MAX_CONNECTIONS: '256',
    NGIT_RELAY_MAX_SUBSCRIPTIONS: '50',
    NGIT_RELAY_FILTER_LIMIT: '200',
    // Applied by Git itself as well as the public Caddy body limit.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'receive.maxInputSize',
    GIT_CONFIG_VALUE_0: String(50 * 1024 * 1024),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
}
export async function graspHealth(origin: string) {
  try {
    const response = await fetch(`${origin}/`, {
      headers: { Accept: 'application/nostr+json' },
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok || Number(response.headers.get('content-length')) > 16384) return null;
    const result = JSON.parse(new TextDecoder().decode(await readBounded(response, 16384))) as {
      name: string;
      version: string;
      pubkey: string;
      supported_grasps: string[];
    };
    if (!result.supported_grasps?.includes('GRASP-01') || !/^[a-f0-9]{64}$/.test(result.pubkey))
      return null;
    return result;
  } catch {
    return null;
  }
}
/** Deterministic example source repositories; the retry journal contains signed public events only. */
export async function seedLocalGrasp(
  input = localGraspOrigin,
  directory = resolve(root, '.local/fixtures/source'),
) {
  const started = performance.now();
  const origin = graspOrigin(input, true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = new Uint8Array(32);
  key[31] = 1;
  const signer = new PrivateKeySigner(key);
  const pubkey = await signer.getPublicKey();
  const catalog = await Bun.file(resolve(root, 'packages/backend/data/catalog.json')).json();
  if (!Array.isArray(catalog) || catalog.length > 32) throw new Error('Invalid fixture catalog');
  let published = 0;
  for (const record of catalog) {
    const release = await validateRelease(record.current, record.snapshot);
    if (
      release.identity.pubkey !== pubkey ||
      record.artifactHash !== release.artifactHash ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.slug)
    )
      throw new Error('Invalid fixture source identity');
    const path = resolve(directory, record.slug);
    await mkdir(path, { recursive: true });
    if (!(await Bun.file(resolve(path, '.git/HEAD')).exists()))
      await sourceGit(path, ['init', '--initial-branch=main']);
    const html = await Bun.file(
      resolve(root, `packages/backend/data/artifacts/${release.artifactHash}.html`),
    ).text();
    if ((await sha256(html)) !== release.artifactHash)
      throw new Error('Fixture source hash mismatch');
    for (const [name, content] of Object.entries({
      'index.html': html,
      LICENSE: await Bun.file(resolve(root, 'LICENSE')).text(),
      'README.md': `# ${record.title}\n\n${record.description}\n\nOpen index.html in a browser, or edit it with your coding tool.\n\nThis repository is a local development fixture.\n`,
    })) {
      if (
        !(await Bun.file(resolve(path, name)).exists()) ||
        (await Bun.file(resolve(path, name)).text()) !== content
      )
        await Bun.write(resolve(path, name), content);
    }
    const existing = await sourceGit(path, ['rev-parse', '--verify', 'HEAD']).catch(() => '');
    if (!existing || (await sourceGit(path, ['status', '--porcelain']))) {
      await sourceGit(path, ['add', '--', 'index.html', 'LICENSE', 'README.md']);
      await sourceGit(path, ['commit', '-m', 'Seed napplet example source'], {
        GIT_AUTHOR_DATE: '2026-09-11T12:00:00Z',
        GIT_COMMITTER_DATE: '2026-09-11T12:00:00Z',
      });
    }
    const commit = await sourceGit(path, ['rev-parse', 'HEAD']);
    const journal = resolve(directory, `${record.slug}.json`);
    let publication: SourcePublication | undefined;
    let previousTime = 0;
    try {
      const saved = await Bun.file(journal).json();
      const announcement = verifiedEvent(saved.announcement);
      const state = verifiedEvent(saved.state);
      previousTime = Math.max(announcement.created_at, state.created_at);
      if (
        saved.origin === origin &&
        saved.commit === commit &&
        saved.title === record.title &&
        announcement.pubkey === pubkey &&
        state.pubkey === pubkey
      )
        publication = { announcement, state };
    } catch {
      /* Missing or damaged public journal is recreated. */
    }
    if (!publication) {
      publication = await prepareSource({
        directory: path,
        identifier: record.slug,
        title: record.title,
        signer,
        origin,
        local: true,
        createdAt: Math.max(Math.floor(Date.now() / 1000), previousTime + 1),
      });
      const temporary = `${journal}.${process.pid}.tmp`;
      await Bun.write(
        temporary,
        JSON.stringify({ origin, commit, title: record.title, ...publication }, null, 2),
      );
      await rename(temporary, journal);
    }
    const result = await publishSource({ directory: path, origin, local: true, publication });
    if (result.changed) published++;
  }
  return {
    repositories: catalog.length,
    published,
    milliseconds: Math.round(performance.now() - started),
  };
}
if (import.meta.main) console.log('Local source:', await seedLocalGrasp());
