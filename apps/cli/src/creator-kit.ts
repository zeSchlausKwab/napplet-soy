import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import boilerplate from '../vendor/boilerplate.json';
import skills from '../vendor/skills.json';
import settingsSchema from '../templates/config.schema.json';
import settingsExample from '../templates/napplet-settings.ts.txt' with { type: 'text' };
import { AccountError } from '../../../packages/identity/src/signer';

export const upstream = { boilerplate: boilerplate.revision, skills: skills.revision };
const profile = `# napplet soyLI integration

This project includes the maintained napplet/boilerplate and unchanged upstream
napplet-* skills. Start with napplet-make. Protocol guidance stays upstream;
this note maps its local tooling commands to the installed napplet soyLI.

## Commands

- The project is already scaffolded. Do not run another creator CLI or re-scaffold it.
- Skills are already installed locally in .agents/skills and .claude/skills.
  The upstream npx skills command is an alternative for other environments.
- soyli setup prepares the pinned Node/pnpm toolchain and dependencies.
  Nothing is installed globally; ordinary pnpm commands also work if you have it.
- soyli run verify runs the upstream guidance/type/build checks.
- soyli run test:conformance runs the upstream reference-shell checks.
  Its pinned test browser is downloaded and cached on first use.
- soyli dev watches the Vite build inside the napplet.soy sandbox.
  Use its URL for preview. The upstream pnpm dev URL serves source without a host.
  Switch from Play to Listing to inspect the title, description, tags, creator,
  screenshot, license and publishing destinations. Use Capture screenshot after
  the final build; inspect the saved image in Listing before publishing. Captures
  select a new PNG in napplet.json and preserve previous images.
  The Settings button opens the same live configuration form as the website.
- soyli build makes dist/index.html. Edit index.html, src/main.ts and
  src/styles.css; keep the upstream Vite configuration and dependency lockfile.
- soyli config shows effective publishing targets without a signer or build.
  config init writes them into napplet.json for older projects.
- soyli check checks the existing built artifact in our host.
- soyli screenshot saves preview.png and selects it in napplet.json.
  Inspect the image: it should show a representative app state, not a blank canvas
  or loading screen. Use screenshot preview-2.png for another capture, or supply
  your own PNG with preview.image. Capture after the final build.
- soyli publish --dry-run inspects source and destinations;
  soyli publish publishes the existing build. Build after editing and
  before publishing. Publication and checks never execute project scripts.
- For older single-file projects whose napplet.json entry is index.html, edit
  that file directly and use dev/check/publish; no build toolchain is required.

## Metadata and host support

napplet.json owns this client's creator reference, name, identifier, topic labels,
relay/resource hints and publication destinations. It replaces the upstream
CLI's deployment configuration in this workflow; never put creator secrets in
the project. Read it before publishing and tell the creator the effective targets.

New projects expose publish.networks.public and publish.networks.local explicitly:
relay is the primary manifest/descriptor relay, blossom receives the HTML, source
archive and preview image, grasp is the NIP-34 Git service, and site displays the
result. The defaults use wss://relay.napplet.soy, https://blossom.napplet.soy,
https://git.napplet.soy and https://napplet.soy. Edit those fields to choose services.
CLI --relay/--blossom/--grasp/--site overrides apply only to that publication.
The optional mirrors array receives extra descriptor/manifest copies only after
our primary relay acknowledges publication; failures do not undo the primary
publication. Use mirrors: [] to disable extra copies. Never substitute a foreign
primary relay silently. relays and servers at the top level are runtime read and
resource hints, not publishing destinations. Git must provide NIP-34/GRASP support.

A new release may change Blossom, site and mirrors. Existing relay/Git history
requires explicit migration when moving those services; --resume always uses the
saved release destinations. Keep the publication journal to preserve that history.

Publishing automatically captures a 1200 × 750 PNG from the sandbox when no
preview.image is selected, using preview.delayMs (1500 by default, 250–10000).
It uploads the PNG to the selected Blossom server and publishes a linked signed
app descriptor so other clients can discover it. This fallback prevents accidental
imageless releases; an inspected screenshot is still the preferred finishing step.
For an interactive scene needing a start click, take a representative PNG during
manual/browser testing and select it with preview.image. Only PNG up to 5 MiB and
4096 × 4096 is currently accepted. Remove preview.image to resume automatic capture.
The local preview setting is authoring configuration, not a new Nostr manifest tag.

Readable routes are a one-time website claim, not an automatic publish step.
After publishing, open the napplet page, connect the same creator account and
choose Named link to claim /@your-handle/your-slug. The name follows later releases.
Existing published napplets can claim a name without republishing.

## Creator backup

Creating a local identity also saves its private key as an nsec file outside this
Git project. The CLI prints the path before installing dependencies. By default
it is \`~/.config/napplet-space/accounts/public/<public-key>.nsec\` (local-network
identities use accounts/local). The file has owner-only permissions. Preserve a
private copy: it is unencrypted and can recover the creator identity.

soyli account backup saves or locates that file for an existing local
creator. To restore it, use soyli account import --stdin < /path/to/key.nsec.
Signing continues to use the OS credential store; the project contains only the
public creator reference. Remote-signer identities are backed up in their signer.
Never copy the key into source, skills, browser code, or published assets.

## Runtime capabilities

Keep hard domain requirements in vite.config.ts; the publisher reads the build's
napplet-requires metadata and checks it against this host. Optional domains must
degrade gracefully, following upstream guidance. Use the injected namespace and
SDK; do not add a bootstrap or a private protocol extension to app code.

This host provides configuration, identity, storage, theme, resource, relay/outbox reads,
common reads, user-confirmed links and session files. Social writes, signer
operations, ContextVM and cross-napplet operations are not currently granted.
A domain's presence does not promise that every operation will be permitted.
Our host check complements upstream conformance; report each result separately.

## User-facing settings

config.schema.json declares the napplet's NAP-CONFIG settings. The upstream Vite
plugin embeds it as napplet-config-schema metadata inside the signed HTML build.
This is separate from napplet.json, which configures publication and infrastructure.
The starter's src/napplet-settings.ts uses the upstream SDK config.subscribe to
apply text size, control height and text selection live. Replace these example
properties with settings relevant to the creation. Keep sensible in-app fallbacks
when config is optional; declare requires: ['config'] in the existing Vite plugin
only if the core experience cannot work without it.

Use the NAP-CONFIG Core Subset: typed properties, literal defaults, enum choices,
numeric/string/list bounds and nested objects (at most four levels). No refs,
regex patterns, expressions or conditional schemas. x-napplet-section and
x-napplet-order organize the form. config.openSettings can open it from an app
control. For a static schema, do not also call config.registerSchema at startup.

The host validates edits and pushes values; a napplet cannot write configuration.
Space scopes values by verified creator/address/build and viewer. A new build
starts fresh. Non-secret settings persist on this browser; x-napplet-secret
string fields are masked, have no default, and last only for the running session.
Never use settings to request the creator's signing key. Check Settings in the
local preview, including defaults, live changes and a reload, before publishing.

## Upstream maintenance

Pinned boilerplate: ${boilerplate.repository}/tree/${boilerplate.revision}
Pinned skills: ${skills.repository}/tree/${skills.revision}

Upstream source, configuration, documentation and scripts are retained. Local
changes: package name, this integration note, agent entry pointers, private-state
gitignore entries, a static settings example and its single main.ts import, and
excluding installed skill folders from the boilerplate's repository-guidance scan.
The guidance check for a schema-free starter now checks our static settings example.
Skill bodies and licenses are unchanged. Run
soyli skills update to install the CLI's bundled skill revision; modified
files are reported as conflicts and preserved. Template/source changes are never
applied by that command.
`;

const pointer = `## napplet soyLI workspace\n\nRead [docs/napplet-space.md](docs/napplet-space.md) first for this project's CLI commands, installed skills and host capabilities. Use the upstream guidance below with those tooling mappings.\n\n`;

export function creatorSkills() {
  const files: Record<string, string> = {
    'docs/napplet-space.md': profile,
    'docs/napplet-skills-LICENSE.txt': skills.files.LICENSE,
    'CLAUDE.md':
      '@AGENTS.md\n\nThe upstream skills are installed in .claude/skills; begin with napplet-make.\n',
  };
  for (const [path, text] of Object.entries(skills.files)) {
    if (!path.startsWith('skills/')) continue;
    for (const agent of ['.agents', '.claude']) files[`${agent}/${path}`] = text;
  }
  return files;
}

export function boilerplateFiles(name: string) {
  const files: Record<string, string> = { ...boilerplate.files };
  files['package.json'] =
    JSON.stringify({ ...JSON.parse(files['package.json']), name }, null, 2) + '\n';
  files['AGENTS.md'] = pointer + files['AGENTS.md'];
  files['README.md'] = pointer + files['README.md'];
  files['config.schema.json'] = JSON.stringify(settingsSchema, null, 2) + '\n';
  files['src/napplet-settings.ts'] = settingsExample;
  files['src/main.ts'] = "import './napplet-settings.js';\n" + files['src/main.ts'];
  files['.gitignore'] +=
    '\n# Napplet Space private build/publication state\n.napplet-space/\n.nip5a-manifest.json\n';
  // Upstream scans all text, including negative examples in installed skills.
  // Keep its assertions intact; installed agent bundles are not template source.
  const original = "new Set(['.git', 'dist', 'node_modules'])";
  if (!files['tests/guidance.test.mjs'].includes(original))
    throw new Error('Upstream guidance scanner changed; review the adapter.');
  files['tests/guidance.test.mjs'] = files['tests/guidance.test.mjs'].replace(
    original,
    "new Set(['.git', 'dist', 'node_modules', '.agents', '.claude', '.napplet-space'])",
  );
  const schemaFree = "assert.equal(sources.has('config.schema.json'), false);";
  if (!files['tests/guidance.test.mjs'].includes(schemaFree))
    throw new Error('Upstream static-schema guidance changed; review the adapter.');
  files['tests/guidance.test.mjs'] = files['tests/guidance.test.mjs'].replace(
    schemaFree,
    "assert.equal(JSON.parse(sources.get('config.schema.json')).type, 'object');",
  );
  return files;
}

const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');
async function safeParent(root: string, path: string) {
  if (
    !/^[a-zA-Z0-9._/-]+$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((p) => p === '..' || !p)
  )
    throw new AccountError('SKILLS_PATH', 'Invalid managed skill path.');
  let current = root;
  for (const part of path.split('/').slice(0, -1)) {
    current = join(current, part);
    await mkdir(current, { mode: part === '.napplet-space' ? 0o700 : 0o755 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new AccountError('SKILLS_PATH', 'Skill directories must not be symlinks.');
  }
  return join(root, path);
}

/** Add/update only our recorded bundle; a creator edit is never an overwrite target. */
export async function installCreatorSkills(directory: string) {
  const root = resolve(directory);
  const statePath = await safeParent(root, '.napplet-space/skills.json');
  const stateStat = await lstat(statePath).catch(() => null);
  if (stateStat && (!stateStat.isFile() || stateStat.isSymbolicLink() || stateStat.size > 65536))
    throw new AccountError('SKILLS_STATE', 'Invalid skill update record; it was not overwritten.');
  const previous: Record<string, string> = stateStat
    ? JSON.parse(await readFile(statePath, 'utf8')).files
    : {};
  if (!previous || typeof previous !== 'object')
    throw new AccountError('SKILLS_STATE', 'Invalid skill update record.');
  const files: Record<string, string> = {},
    updated: string[] = [],
    conflicts: string[] = [];
  for (const [path, text] of Object.entries(creatorSkills())) {
    const target = await safeParent(root, path);
    const stat = await lstat(target).catch(() => null);
    const existing =
      stat?.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024
        ? await readFile(target, 'utf8')
        : undefined;
    if (
      stat &&
      existing !== text &&
      (existing === undefined || previous[path] !== hash(existing))
    ) {
      conflicts.push(path);
      if (previous[path]) files[path] = previous[path];
      continue;
    }
    if (existing !== text) {
      const temporary = join(dirname(target), `.skill-${crypto.randomUUID()}`);
      await writeFile(temporary, text, { flag: 'wx' });
      await rename(temporary, target);
      updated.push(path);
    }
    files[path] = hash(text);
  }
  const temporary = `${statePath}.${crypto.randomUUID()}`;
  await writeFile(temporary, JSON.stringify({ version: 1, upstream, files }, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporary, statePath);
  return { upstream, updated, conflicts };
}
