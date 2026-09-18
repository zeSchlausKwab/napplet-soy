import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ipaddr from 'ipaddr.js';
import { sourceGit } from '../../grasp/src/client';
import { commitPattern, type Repository } from './protocol';
import { committedSource, inspectHistory } from '../../publish/src/git-source';

export function cloneUrl(value: string, local = false) {
  const u = new URL(value),
    host = u.hostname.replace(/^\[|\]$/g, '');
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    (local
      ? u.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(host)
      : u.protocol !== 'https:' ||
        host === 'localhost' ||
        host.endsWith('.local') ||
        host.endsWith('.localhost') ||
        (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast'))
  )
    throw new Error('Use a public HTTPS Git URL, or loopback HTTP in the local network.');
  return u.href;
}
export async function fetchCommit(
  directory: string,
  clones: string[],
  commit: string,
  local = false,
) {
  if (!commitPattern.test(commit)) throw new Error('Proposal needs an exact Git commit.');
  for (const input of clones.slice(0, 4)) {
    try {
      const url = cloneUrl(input, local);
      await sourceGit(directory, [
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        'fetch',
        '--no-tags',
        url,
        commit,
      ]);
      if ((await sourceGit(directory, ['rev-parse', 'FETCH_HEAD'])) !== commit)
        throw new Error('Git tip mismatch.');
      await sourceGit(directory, ['cat-file', '-e', `${commit}^{commit}`]);
      return url;
    } catch {}
  }
  throw new Error('The exact proposed Git commit is unavailable from its clone servers.');
}
export async function cloneRevision(
  directory: string,
  repo: Repository,
  commit: string,
  local = false,
) {
  await sourceGit(directory, ['init', '--initial-branch=main']);
  const clone = await fetchCommit(directory, repo.clones, commit, local);
  if (repo.euc) await sourceGit(directory, ['merge-base', '--is-ancestor', repo.euc, commit]);
  await inspectHistory(directory, commit);
  await sourceGit(directory, ['checkout', '-b', 'pr/my-changes', commit]);
  await sourceGit(directory, ['remote', 'add', 'upstream', clone]);
  await sourceGit(directory, [
    'remote',
    'add',
    'nostr',
    `nostr://${repo.address.startsWith('30617:') ? (await import('nostr-tools')).nip19.naddrEncode({ kind: 30617, pubkey: repo.pubkey, identifier: repo.identifier, relays: repo.relays }) : ''}`,
  ]);
  return clone;
}
export async function mergeReviewed(
  directory: string,
  input: {
    head: string;
    target: string;
    revision: string;
    clones: string[];
    local?: boolean;
    author?: string;
  },
) {
  const current = await committedSource(directory);
  if (current !== input.target)
    throw new Error('The target branch changed since review. Refresh and review the new target.');
  await fetchCommit(directory, input.clones, input.head, input.local);
  await inspectHistory(directory, input.head);
  // Preflight in the object database. A conflict never leaves the working tree half-merged.
  await sourceGit(directory, ['merge-tree', '--write-tree', current, input.head]).catch(() => {
    throw new Error('Merge conflicts need local resolution. Your working tree is unchanged.');
  });
  if ((await committedSource(directory)) !== current)
    throw new Error('The target changed during preparation.');
  await sourceGit(
    directory,
    [
      '-c',
      'core.fsmonitor=false',
      'merge',
      '--no-ff',
      '--no-edit',
      '-m',
      `Merge proposal ${input.revision}`,
      input.head,
    ],
    input.author
      ? {
          GIT_AUTHOR_NAME: input.author,
          GIT_AUTHOR_EMAIL: `${input.author}@nostr`,
          GIT_COMMITTER_NAME: input.author,
          GIT_COMMITTER_EMAIL: `${input.author}@nostr`,
        }
      : {},
  );
  return {
    state: 'merged_locally' as const,
    commit: await committedSource(directory),
    head: input.head,
    revision: input.revision,
    released: false,
    pushed: false,
  };
}
