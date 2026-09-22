import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateTarget } from './deploy';
import { DiagnosticError, diagnose, formatDiagnostic } from '../packages/diagnostics/src';
import release from '../apps/cli/distribution/version.json';

const { values } = parseArgs({
  options: { host: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(`Usage: bun run cli:release --host <ssh-host>

Optional legacy VPS mirror upload. Requires all four local CLI archives and checksums.
Build them first with bun run cli:build (without --target).

GitHub Releases is the primary CLI distribution channel; CI builds and publishes it.
Website deployment does not require cli:release. Use bun run deploy with your usual
--host, --domain and other deployment options instead.`);
  process.exit(0);
}
const { host } = validateTarget(values.host, 'napplet.soy');
const version = release.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const root = resolve(import.meta.dir, '../.local/cli');
const files: string[] = [];
try {
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
    const name = `soyli-${platform}.tar.gz`;
    const expected = (await Bun.file(join(root, version, `${name}.sha256`)).text()).trim();
    const actual = new Bun.CryptoHasher('sha256')
      .update(await Bun.file(join(root, version, name)).bytes())
      .digest('hex');
    if (expected !== `${actual}  ${name}`) throw new Error(`Checksum mismatch: ${name}`);
    files.push(`${version}/${name}`, `${version}/${name}.sha256`);
  }
} catch (cause) {
  console.error(
    formatDiagnostic(
      diagnose(
        new DiagnosticError(
          'CLI_RELEASE_ARTIFACTS',
          'Cannot verify all four local CLI packages for the legacy VPS mirror. Normal CLI distribution uses GitHub Releases.',
          {
            operation: 'verify local CLI release artifacts',
            target: join(root, version),
            cause,
            recovery:
              'For website deployment, omit cli:release and use bun run deploy with your usual options. For an explicit VPS mirror, run bun run cli:build without --target to build all four packages, then retry cli:release.',
          },
        ),
      ),
    ),
  );
  process.exit(1);
}
const staging = await mkdtemp(join(tmpdir(), 'napplet-cli-release-'));
const archive = join(staging, 'release.tar');
const ssh = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ServerAliveInterval=10',
  '-o',
  'ServerAliveCountMax=3',
];
async function run(args: string[], input?: string | Blob) {
  const child = Bun.spawn(args, {
    stdin: input === undefined ? 'ignore' : typeof input === 'string' ? new Blob([input]) : input,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  try {
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    if (code !== 0) throw new Error(`${args[0]} failed`);
    return output;
  } finally {
    clearTimeout(timer);
  }
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
  const remote = `/tmp/napplet-cli-${version}-${hash}.tar`;
  // Small verified chunks survive connection drops and repeat invocations.
  const size = Bun.file(archive).size;
  const partSize = 2 * 1024 * 1024;
  const parts = Array.from(
    { length: Math.ceil(size / partSize) },
    (_, index) => `${remote}.part${String(index).padStart(3, '0')}`,
  );
  const saved = await run([
    'ssh',
    ...ssh,
    host,
    `sha256sum ${remote}.part[0-9][0-9][0-9] 2>/dev/null || true`,
  ]);
  const known = new Map(
    saved
      .trim()
      .split('\n')
      .map((line) => line.split(/  +/))
      .map(([hash, path]) => [path, hash]),
  );
  let next = 0,
    completed = 0;
  const upload = async () => {
    while (next < parts.length) {
      const index = next++;
      const path = parts[index];
      const bytes = await Bun.file(archive)
        .slice(index * partSize, Math.min(size, (index + 1) * partSize))
        .bytes();
      const partHash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      if (known.get(path) !== partHash) {
        for (let attempt = 0; ; attempt++) {
          try {
            await run(
              [
                'ssh',
                ...ssh,
                host,
                `set -e; umask 077; cat > ${path}.upload; printf '%s  %s\\n' '${partHash}' '${path}.upload' | sha256sum --check --status; mv ${path}.upload ${path}`,
              ],
              new Blob([bytes]),
            );
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await Bun.sleep(1000 * (attempt + 1));
          }
        }
      }
      console.log(`Verified CLI upload ${++completed}/${parts.length}`);
    }
  };
  const uploads = await Promise.allSettled(Array.from({ length: 4 }, upload));
  if (uploads.some((result) => result.status === 'rejected'))
    throw new Error(
      'CLI archive upload interrupted. Rerun cli:release to reuse the verified chunks. Existing downloads were preserved.',
    );
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
trap 'rm -rf "$stage"; rm -f ${remote}' EXIT
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
rm -f ${parts.join(' ')}
printf 'CLI ${version} downloads are ready.\\n'
`,
  );
  console.log(`CLI ${version} downloads are ready on ${host}.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
