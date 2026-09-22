import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import release from '../apps/cli/distribution/version.json';

export function validateReleaseVersion(version: string, installer: string, ref?: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Invalid stable CLI version.');
  if (!installer.split('\n').includes(`version=${version}`))
    throw new Error('Installer and CLI versions must match.');
  if (ref?.startsWith('refs/tags/') && ref !== `refs/tags/soyli-v${version}`)
    throw new Error(
      `Release tag must be soyli-v${version}, matching apps/cli/distribution/version.json.`,
    );
  return version;
}
if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const version = validateReleaseVersion(
    release.version,
    await Bun.file(join(root, 'apps/web/public/install.sh')).text(),
    process.env.GITHUB_REF,
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Validated soyLI ${version}`);
}
