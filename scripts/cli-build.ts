import { chmod, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { previewAssets } from '../apps/cli/src/preview/assets';
import boilerplate from '../apps/cli/vendor/boilerplate.json';
import skills from '../apps/cli/vendor/skills.json';
import toolchain from '../apps/cli/vendor/toolchain.json';
import { playwrightDirectory } from '../apps/cli/src/distribution';

const root = resolve(import.meta.dir, '..');
const version = (await Bun.file(join(root, 'apps/cli/distribution/version.json')).json())
  .version as string;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid CLI version');
if (Bun.version !== '1.3.11') throw new Error('Build releases with pinned Bun 1.3.11.');
const targets = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64-baseline',
};
const { values } = parseArgs({ options: { target: { type: 'string' } } });
const selected = values.target ? values.target.split(',') : Object.keys(targets);
if (selected.some((t) => !(t in targets)))
  throw new Error('Choose darwin-arm64,darwin-x64,linux-arm64,linux-x64.');
const output = join(root, '.local/cli', version);
await mkdir(output, { recursive: true });
const assets = await previewAssets();
const definitions = {
  NAPPLET_STANDALONE: 'true',
  NAPPLET_CLI_VERSION: JSON.stringify(version),
  NAPPLET_PREVIEW_ASSETS: JSON.stringify(assets),
};
for (const platform of selected) {
  const name = `napplet-space-${platform}`;
  const directory = join(output, name);
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, 'lib'), { recursive: true });
  const build = await Bun.build({
    entrypoints: [join(root, 'apps/cli/src/index.ts')],
    target: 'bun',
    minify: true,
    define: definitions,
    compile: {
      target: targets[platform as keyof typeof targets] as Bun.Build.CompileTarget,
      outfile: join(directory, 'napplet-space'),
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
  await chmod(join(directory, 'napplet-space'), 0o755);
  await cp(playwrightDirectory(), join(directory, 'lib/playwright-core'), {
    recursive: true,
    dereference: true,
  });
  await cp(dirname(Bun.resolveSync('ws/package.json', root)), join(directory, 'lib/ws'), {
    recursive: true,
    dereference: true,
  });
  // Include dependency license files, including runtime notices, in every distribution.
  await cp(join(root, 'apps/cli/distribution/NOTICE.txt'), join(directory, 'NOTICE.txt'));
  await cp(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  const licenses = join(directory, 'licenses');
  await mkdir(licenses);
  await writeFile(join(licenses, 'napplet-boilerplate-MIT.txt'), boilerplate.files.LICENSE);
  await writeFile(join(licenses, 'napplet-skills-MIT.txt'), skills.files.LICENSE);
  const store = join(root, 'node_modules/.bun');
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nm = join(store, entry.name, 'node_modules');
    for (const dep of await readdir(nm, { withFileTypes: true }).catch(() => [])) {
      if (!dep.isDirectory()) continue;
      const packagePaths = dep.name.startsWith('@')
        ? (await readdir(join(nm, dep.name), { withFileTypes: true }))
            .filter((e) => e.isDirectory())
            .map((e) => join(dep.name, e.name))
        : [dep.name];
      for (const pkg of packagePaths)
        for (const file of await readdir(join(nm, pkg))) {
          if (/^(license|licence|copying|notice)(\.|$)/i.test(file)) {
            const destination = join(
              licenses,
              `${entry.name}__${pkg.replaceAll('/', '__')}__${file}`,
            );
            await cp(join(nm, pkg, file), destination, { recursive: true });
          }
        }
    }
  }
  await cp(join(root, 'apps/cli/distribution/BUN-LICENSE.txt'), join(licenses, 'BUN-LICENSE.txt'));
  await writeFile(
    join(directory, 'release.json'),
    JSON.stringify(
      {
        version,
        platform,
        bun: Bun.version,
        playwright: '1.63.0',
        upstream: { boilerplate: boilerplate.revision, skills: skills.revision },
        toolchain: { node: toolchain.node.version, pnpm: toolchain.pnpm.version },
      },
      null,
      2,
    ) + '\n',
  );
  const archive = join(output, `${name}.tar.gz`);
  const tar = Bun.spawn(
    [
      'tar',
      ...(process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata'] : []),
      '-czf',
      archive,
      '-C',
      output,
      name,
    ],
    {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  if ((await tar.exited) !== 0) throw new Error('Archive failed');
  const checksum = new Bun.CryptoHasher('sha256')
    .update(await Bun.file(archive).bytes())
    .digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${name}.tar.gz\n`);
  console.log(`${platform}: ${Math.round(Bun.file(archive).size / 1024 / 1024)} MiB · ${checksum}`);
}
console.log(`CLI ${version} artifacts: ${output}`);
