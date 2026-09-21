import { sourceGit } from '../../grasp/src/client';
import { PublishError } from './config';

export async function committedSource(directory: string) {
  const commit = await sourceGit(directory, ['rev-parse', '--verify', 'HEAD']).catch((cause) => {
    throw new PublishError(
      'COMMIT_REQUIRED',
      'Could not read a committed source revision. Check the Git error below; for a new project, save a checkpoint with soyli checkpoint "Describe your changes".',
      'check',
      false,
      cause,
    );
  });
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new PublishError(
      'COMMIT_REQUIRED',
      'Save a source checkpoint first: soyli checkpoint "Describe your changes".',
    );
  const changed = await sourceGit(directory, [
    '-c',
    'core.fsmonitor=false',
    'status',
    '--porcelain',
    '--untracked-files=normal',
  ]);
  if (changed)
    throw new PublishError(
      'SOURCE_DIRTY',
      'Commit your changes before sharing: soyli checkpoint "Describe your changes".',
    );
  return commit;
}

/** Reachable history is published too. Inspect blobs even if deleted from the current tree. */
export async function inspectHistory(directory: string, commit: string) {
  const tree = (await sourceGit(directory, ['ls-tree', '-r', '-z', commit]))
    .split('\0')
    .filter(Boolean);
  if (tree.length > 128)
    throw new PublishError(
      'SOURCE_LIMIT',
      'This creator profile supports up to 128 tracked source files.',
    );
  for (const entry of tree) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(entry);
    if (!match || match[2].length > 200 || /[\\\s\u0000-\u001f\u007f]/.test(match[2]))
      throw new PublishError(
        'SOURCE_PATH',
        'Git source must contain regular files with supported relative paths, without symlinks or submodules.',
      );
  }
  const objects = (await sourceGit(directory, ['rev-list', '--objects', commit])).split('\n');
  if (objects.length > 10000)
    throw new PublishError(
      'HISTORY_LIMIT',
      'This publisher supports up to 10,000 reachable Git objects. Use ordinary Git for larger histories.',
    );
  let total = 0;
  for (const object of objects) {
    const [id, ...parts] = object.split(' '),
      path = parts.join(' ');
    if (!path) continue;
    if ((await sourceGit(directory, ['cat-file', '-t', id])) !== 'blob') continue;
    const size = Number(await sourceGit(directory, ['cat-file', '-s', id]));
    total += size;
    if (total > 40 * 1024 * 1024)
      throw new PublishError(
        'HISTORY_LIMIT',
        'Public Git history exceeds the supported 40 MiB total. Keep large assets in Blossom.',
      );
    const { checkSource } = await import('./project');
    checkSource(
      path,
      new TextEncoder().encode(
        await sourceGit(directory, ['cat-file', 'blob', id], {}, 40 * 1024 * 1024),
      ),
    );
  }
}

export async function checkpoint(directory: string, message: string, author?: string) {
  if (!message.trim() || message.length > 1000)
    throw new Error('Provide a short checkpoint description.');
  await sourceGit(directory, ['rev-parse', '--git-dir']).catch(async () => {
    await sourceGit(directory, ['init']);
    await sourceGit(directory, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  });
  // Never auto-stage or commit as a side effect of publish/propose. This is explicit.
  const files = (
    await sourceGit(directory, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  )
    .split('\0')
    .filter(Boolean);
  const { regularFile, checkSource } = await import('./project');
  for (const path of files) {
    try {
      checkSource(path, await regularFile(directory, path, 40 * 1024 * 1024));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await sourceGit(directory, ['add', '--all', '--', '.']);
  await sourceGit(
    directory,
    ['commit', '-m', message],
    author
      ? {
          GIT_AUTHOR_NAME: author,
          GIT_AUTHOR_EMAIL: `${author}@nostr`,
          GIT_COMMITTER_NAME: author,
          GIT_COMMITTER_EMAIL: `${author}@nostr`,
        }
      : {},
  );
  return { commit: await committedSource(directory), publicHistory: true };
}
