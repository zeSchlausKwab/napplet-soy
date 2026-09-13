import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateTarget } from './deploy';
import release from '../apps/cli/distribution/version.json';

const { values } = parseArgs({ options: { host: { type: 'string' } } });
const { host } = validateTarget(values.host, 'napplet.soy');
const version = release.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const root = resolve(import.meta.dir, '../.local/cli');
const files: string[] = [];
for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
  const name = `napplet-space-${platform}.tar.gz`;
  const expected = (await Bun.file(join(root, version, `${name}.sha256`)).text()).trim();
  const actual = new Bun.CryptoHasher('sha256')
    .update(await Bun.file(join(root, version, name)).bytes())
    .digest('hex');
  if (expected !== `${actual}  ${name}`) throw new Error(`Checksum mismatch: ${name}`);
  files.push(`${version}/${name}`, `${version}/${name}.sha256`);
}
const staging = await mkdtemp(join(tmpdir(), 'napplet-cli-release-'));
const remote = `/tmp/napplet-cli-${version}-${crypto.randomUUID()}.tar`;
const archive = join(staging, 'release.tar');
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes'];
async function run(args: string[], input?: string | Blob) {
  const child = Bun.spawn(args, {
    stdin: input === undefined ? 'ignore' : typeof input === 'string' ? new Blob([input]) : input,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
}
try {
  await run([
    'tar',
    ...(process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata'] : []),
    '-cf',
    archive,
    '-C',
    root,
    ...files,
  ]);
  const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).bytes()).digest('hex');
  // Bounded parallel streams avoid SFTP round-trip overhead on high-latency links.
  // Reassemble and verify the whole archive before extracting anything.
  const size = Bun.file(archive).size;
  const partSize = Math.ceil(size / 4);
  const parts = [0, 1, 2, 3].map((index) => `${remote}.part${index}`);
  const uploads = await Promise.allSettled(
    parts.map(async (path, index) => {
      await run(
        ['ssh', ...ssh, host, `umask 077; cat > ${path}`],
        Bun.file(archive).slice(index * partSize, Math.min(size, (index + 1) * partSize)),
      );
      console.log(`Uploaded CLI archive part ${index + 1}/4`);
    }),
  );
  if (uploads.some((result) => result.status === 'rejected')) {
    await run(['ssh', ...ssh, host, `rm -f ${parts.join(' ')}`]);
    throw new Error('CLI archive upload failed; existing downloads were preserved.');
  }
  // Every interpolated value above has a fixed/allowlisted alphabet.
  await run(
    [
      'ssh',
      ...ssh,
      host,
      'if [ "$(id -u)" = 0 ]; then exec bash -s; else exec sudo -n bash -s; fi',
    ],
    `
set -euo pipefail
root=/opt/napplet-space/downloads/cli
mkdir -p "$root"
exec 9>"$root/.release-lock"
flock -n 9 || { echo 'Another CLI release is active.' >&2; exit 1; }
stage=$(mktemp -d "$root/.release.XXXXXXXX")
trap 'rm -rf "$stage"; rm -f ${remote} ${parts.join(' ')}' EXIT
cat ${parts.join(' ')} > ${remote}
printf '%s  %s\\n' '${hash}' '${remote}' | sha256sum --check --status
tar -xf ${remote} -C "$stage"
(cd "$stage/${version}"; sha256sum --check --status ./*.sha256)
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
if [[ -e "$root/${version}" ]]; then
  diff -qr "$root/${version}" "$stage/${version}" || { echo 'Version already published with different bytes. Bump the CLI version.' >&2; exit 1; }
else
  mv "$stage/${version}" "$root/${version}"
fi
printf 'CLI ${version} downloads are ready.\\n'
`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
