import { copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import release from '../apps/cli/distribution/version.json';
import { validateReleaseVersion } from './cli-release-check';

const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
export async function verifyReleaseArtifacts(directory: string) {
  const files: string[] = [];
  for (const platform of platforms) {
    const name = `soyli-${platform}.tar.gz`;
    const checksum = (await Bun.file(join(directory, `${name}.sha256`)).text()).trim();
    const actual = new Bun.CryptoHasher('sha256')
      .update(await Bun.file(join(directory, name)).bytes())
      .digest('hex');
    if (checksum !== `${actual}  ${name}`) throw new Error(`Release checksum mismatch: ${name}`);
    files.push(name, `${name}.sha256`);
  }
  return files;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const version = validateReleaseVersion(
    release.version,
    await Bun.file(join(root, 'apps/web/public/install.sh')).text(),
    process.env.GITHUB_REF,
  );
  const tag = `soyli-v${version}`;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || process.env.GITHUB_REF !== `refs/tags/${tag}`)
    throw new Error('Run publication from the matching GitHub release tag.');
  const directory = join(root, '.local/cli', version);
  const files = await verifyReleaseArtifacts(directory);
  await copyFile(join(root, 'apps/web/public/install.sh'), join(directory, 'install.sh'));
  files.push('install.sh');
  await writeFile(
    join(directory, 'release-manifest.json'),
    JSON.stringify(
      { version, tag, commit: process.env.GITHUB_SHA, bun: '1.3.11', nativeSmokeTested: platforms },
      null,
      2,
    ) + '\n',
  );
  files.push('release-manifest.json');
  const sums = await Promise.all(
    files
      .filter((file) => !file.endsWith('.sha256'))
      .map(
        async (name) =>
          `${new Bun.CryptoHasher('sha256').update(await Bun.file(join(directory, name)).bytes()).digest('hex')}  ${name}`,
      ),
  );
  await writeFile(join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
  files.push('SHA256SUMS');
  async function gh(args: string[]) {
    const child = Bun.spawn(['gh', ...args], {
      stdout: 'pipe',
      stderr: 'inherit',
      stdin: 'ignore',
    });
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    if (code !== 0)
      throw new Error(
        `GitHub release operation failed (exit ${code}). A draft may remain; published assets were not replaced.`,
      );
    return output;
  }
  // Listing succeeds independently of whether this is the repository's first release.
  const existing = JSON.parse(
    await gh([
      'release',
      'list',
      '--repo',
      repo,
      '--limit',
      '100',
      '--json',
      'tagName,isDraft,isPrerelease',
    ]),
  ) as { tagName: string; isDraft: boolean; isPrerelease: boolean }[];
  const same = existing.find((item) => item.tagName === tag);
  if (same && !same.isDraft)
    throw new Error(
      'This version is already public. Never replace published release assets; bump the version.',
    );
  const numeric = (v: string) => v.split('.').map(BigInt);
  const isNewer = (v: string) =>
    numeric(v).some(
      (part, i, all) =>
        all.slice(0, i).every((value, j) => value === numeric(version)[j]) &&
        part > numeric(version)[i],
    );
  if (
    existing.some(
      (item) =>
        !item.isDraft &&
        !item.isPrerelease &&
        /^soyli-v\d+\.\d+\.\d+$/.test(item.tagName) &&
        isNewer(item.tagName.slice(7)),
    )
  )
    throw new Error(
      'A newer stable soyLI release already exists. Refusing to move latest backwards.',
    );
  if (!same)
    await gh([
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--verify-tag',
      '--draft',
      '--title',
      `napplet soyLI ${version}`,
      '--generate-notes',
    ]);
  // Drafts are not offered by the updater. Retrying a failed draft upload is safe.
  await gh([
    'release',
    'upload',
    tag,
    '--repo',
    repo,
    '--clobber',
    ...files.map((file) => join(directory, file)),
  ]);
  await gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
}
