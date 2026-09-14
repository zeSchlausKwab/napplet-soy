import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256, MAX_ARTIFACT_BYTES } from '../../protocol/src';
import { missingDomains } from '../../runtime/src/capabilities';
import { sourceGit } from '../../grasp/src/client';
import {
  projectSchema,
  projectIdentity,
  projectTopics,
  sourceDefaults,
  resolveTargets,
  PublishError,
  type Targets,
} from './config';
import type { Network } from '../../identity/src/signer';
import { builtRequirements } from './artifact';

export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export type SourceFile = { path: string; hash: string; size: number };
export async function regularFile(root: string, path: string, limit: number) {
  if (
    !path ||
    path.length > 200 ||
    path.startsWith('/') ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    /[\\\s\u0000-\u001f\u007f]/.test(path)
  )
    throw new PublishError(
      'SOURCE_PATH',
      'Source paths must be relative regular files without traversal, whitespace or symlinks.',
    );
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new PublishError('SOURCE_PATH', 'Source symlinks are not supported.');
  }
  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new PublishError(
        'SOURCE_LIMIT',
        'A source file exceeds the supported size or is not a regular file.',
      );
    const bytes = await file.readFile();
    if (bytes.length > limit)
      throw new PublishError('SOURCE_LIMIT', 'Source changed beyond its size limit while reading.');
    return new Uint8Array(bytes);
  } finally {
    await file.close();
  }
}
function checkSource(path: string, bytes: Uint8Array) {
  if (
    path
      .split('/')
      .some((p) =>
        /^(?:\.git|\.gitattributes|\.gitmodules|\.napplet-space|node_modules|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|ncryptsec))$/i.test(
          p,
        ),
      ) ||
    /(?:^|\/)(?:accounts\.json|id_rsa|id_ed25519)$/.test(path)
  )
    throw new PublishError(
      'SOURCE_SECRET',
      'The source selection contains a private or generated file. Remove it from publish.files.',
    );
  const text = new TextDecoder().decode(bytes);
  if (
    /nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}|ncryptsec1[023456789acdefghjklmnpqrstuvwxyz]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|bunker:\/\/[^\s"'<>]+[?&]secret=|(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,})/.test(
      text,
    )
  )
    throw new PublishError(
      'SOURCE_SECRET',
      'A selected source file contains a likely credential. Remove it before publishing. Secret values are never printed.',
    );
}
export async function inspectProject(
  directory: string,
  network: Network,
  pubkey: string,
  overrides: Partial<Targets> = {},
) {
  const root = await realpath(directory);
  const configBytes = await regularFile(root, 'napplet.json', 16384);
  let project;
  try {
    project = projectSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(configBytes)),
    );
  } catch {
    throw new PublishError(
      'PROJECT_CONFIG',
      'Invalid napplet.json. Choose index.html or the upstream dist/index.html artifact.',
    );
  }
  if (project.creator && (project.creator.pubkey !== pubkey || project.creator.network !== network))
    throw new PublishError(
      'CREATOR_MISMATCH',
      'The project belongs to a different creator or network. Select its saved account, or explicitly change the project creator and identifier for a remix.',
    );
  const targets = resolveTargets(project, network, overrides);
  const built = project.entry === 'dist/index.html';
  const defaults = built
    ? (
        await sourceGit(root, [
          '-c',
          'core.fsmonitor=false',
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
        ])
      )
        .split('\0')
        .filter(Boolean)
    : sourceDefaults;
  const selected = [
    ...new Set([...(project.publish?.files ?? defaults), ...(built ? [project.entry] : [])]),
  ].sort();
  if (selected.length > 128)
    throw new PublishError(
      'SOURCE_LIMIT',
      'Select at most 128 public source files with publish.files.',
    );
  if (!['index.html', 'napplet.json', 'LICENSE'].every((p) => selected.includes(p)))
    throw new PublishError(
      'SOURCE_REQUIRED',
      'publish.files must include index.html, napplet.json and LICENSE.',
    );
  const files: SourceFile[] = [],
    contents = new Map<string, Uint8Array>();
  let total = 0;
  for (const path of selected) {
    let bytes: Uint8Array;
    try {
      bytes =
        path === 'napplet.json'
          ? configBytes
          : await regularFile(
              root,
              path,
              path === project.entry ? MAX_ARTIFACT_BYTES : MAX_SOURCE_BYTES,
            );
    } catch (error) {
      if (path === project.entry && (error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new PublishError(
          'ARTIFACT_MISSING',
          'Build the project before checking or publishing: napplet-space build.',
        );
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        !project.publish?.files &&
        !['index.html', 'LICENSE'].includes(path)
      )
        continue;
      throw error;
    }
    total += bytes.length;
    if (total > MAX_SOURCE_BYTES)
      throw new PublishError('SOURCE_LIMIT', 'Keep the selected source under 40 MiB.');
    checkSource(path, bytes);
    contents.set(path, bytes);
    files.push({ path, hash: await sha256(bytes), size: bytes.length });
  }
  if (!contents.get('LICENSE')?.length)
    throw new PublishError('SOURCE_LICENSE', 'Provide a nonempty LICENSE file before publishing.');
  const html = contents.get(project.entry)!;
  try {
    if (!new TextDecoder('utf-8', { fatal: true }).decode(html).trim()) throw new Error();
  } catch {
    throw new PublishError('ARTIFACT_INVALID', 'index.html must be nonempty UTF-8 HTML.');
  }
  const requires = [
    ...new Set([...project.requires, ...(built ? await builtRequirements(html) : [])]),
  ];
  const missing = missingDomains(requires);
  if (missing.length)
    throw new PublishError(
      'PROJECT_CAPABILITY',
      `Unsupported required domains: ${missing.join(', ')}.`,
    );
  const plan = {
    network,
    pubkey,
    identifier: projectIdentity(project),
    title: project.title ?? project.name,
    description: project.description,
    license: project.license,
    requires,
    topics: projectTopics(project),
    servers: [...new Set([targets.blossom, ...project.servers])],
    targets,
    files,
    artifactHash: await sha256(html),
    sourceBytes: total,
    ...(project.remix ? { remix: project.remix } : {}),
  };
  return { root, plan, contents, fingerprint: await sha256(JSON.stringify(plan)) };
}
export type PublishPlan = Awaited<ReturnType<typeof inspectProject>>['plan'];
export async function durableFile(path: string, bytes: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
/** Build only the explicit public file set. User Git history/config/hooks never enter this repository. */
export async function freezeSource(
  directory: string,
  contents: Map<string, Uint8Array>,
  createdAt: number,
  parent?: { directory: string; commit: string },
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const repo = join(directory, 'source');
  // A preparation interrupted before a journal is activated has not published anything.
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo);
  await sourceGit(repo, ['init', '--initial-branch=main']);
  if (parent) {
    await sourceGit(repo, [
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--no-tags',
      parent.directory,
      parent.commit,
    ]);
    await sourceGit(repo, ['update-ref', 'refs/heads/main', parent.commit]);
  }
  for (const [path, bytes] of contents) await durableFile(join(repo, path), bytes);
  // Stage exactly the explicit file list, with no inherited filters or Git configuration.
  await sourceGit(repo, ['add', '--force', '--', ...contents.keys()]);
  await sourceGit(repo, ['commit', '--allow-empty', '-m', 'Publish napplet source'], {
    GIT_AUTHOR_DATE: `${createdAt} +0000`,
    GIT_COMMITTER_DATE: `${createdAt} +0000`,
  });
  const commit = await sourceGit(repo, ['rev-parse', 'HEAD']);
  const archive = join(directory, 'source.tar');
  await sourceGit(repo, ['archive', '--format=tar', `--output=${archive}`, commit]);
  const bytes = await regularFile(directory, 'source.tar', 50 * 1024 * 1024);
  // fsync the archive before the active journal can reference it.
  const file = await open(archive, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  return { commit, archiveHash: await sha256(bytes), archiveBytes: bytes.length };
}
