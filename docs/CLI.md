# napplet soyLI — creator CLI

The installer at `https://napplet.soy/install.sh` installs **napplet soyLI** as the
standalone `soyli` executable, with its pinned Playwright support files. A separate
Bun, Node, npm, or platform checkout is not required. The executable embeds Bun;
this is not an alternative runtime implementation for users who reject Bun itself.

## Rename and upgrade — 2026-09-15

CLI **0.7.0 is published**, including the 0.6.0 rename and preview recording.
All four archives were verified and uploaded before the installer was activated in
website release `20260915084016730-23084`. The website remains napplet.soy; this is
only a CLI rename, with no change to Nostr manifests or infrastructure.

**0.8.0 is prepared locally, not yet published.** It adds shared-host audio playback
and updated checkpoint/resume guidance. Its [release record](../apps/cli/distribution/release-0.8.0.json)
lists verified archive hashes and platform coverage. Upload the CLI archives before
deploying the matching website installer; see [deployment preparation](DEPLOYMENT.md#shared-audio-and-soyli-080-preparation--2026-09-15).

Rerun the installer without arguments to upgrade in place:

```sh
curl -fsSL https://napplet.soy/install.sh | sh
soyli --version
# Inside an existing project:
soyli skills update
```

The installer creates `~/.local/bin/soyli` and keeps a managed `napplet-space`
compatibility alias so old project scripts continue working. Archives also include
that alias. An unrelated existing `soyli` blocks installation; an unrelated
`napplet-space` is left alone while installing `soyli`. Checksums are verified before
switching commands, and old release directories remain available.

Accounts, OS vault service names, private backups, toolchain/browser caches,
`.napplet-space` journals and `docs/napplet-space.md` stay at their existing paths.
There is no identity migration or regenerated key. As with previous executable
updates, macOS may ask for Keychain authorization. New projects receive `soyli`
commands; skills update refreshes unedited managed guidance in existing projects.
Upstream boilerplate/skill pins and bodies are unchanged.

## Create and publish

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet
# Follow the printed PATH instruction if ~/.local/bin is not already on PATH.
cd my-napplet
soyli dev
# After editing (or stopping dev):
soyli build
soyli run verify
soyli check
soyli publish
```

`new` starts from the pinned creator-maintained `napplet/boilerplate`, initializes
Git, installs its locked dependencies with a private Node/pnpm toolchain, and builds
`dist/index.html`. TypeScript source, upstream scripts, the SDK, Vite plugin,
lockfile and documentation remain intact. It installs the eight upstream Napplet
skills in `.agents/skills` and `.claude/skills`; AGENTS.md and CLAUDE.md point to the
integration notes in `docs/napplet-space.md`. These are ordinary project files, not
background global installations. `napplet.upstream.json` records the exact commits.
Explicit `--template soft-orbit` (and the other five examples) still creates a
single-file project and includes the same skills.

`new` reuses the chosen creator or asks to create/connect/set up later. The installer
reconnects stdin to the terminal's actual device so identity prompts also work
through `curl | sh`. Opening the `/dev/tty` alias stalls delayed input in the macOS
bundled runtime. Redirecting stderr makes installation noninteractive; users can
also explicitly pass `--identity later`. `--no-install` writes the complete scaffold
and skills without downloading dependencies; follow with `setup` and `build`.

For a local creator, onboarding also saves a private-key backup and prints its
absolute path before dependency installation. By default this is
`~/.config/napplet-space/accounts/public/<public-key>.nsec`, outside the project
and Git. It is an **unencrypted nsec**, mode 0600 inside the private account
directory; preserve a private copy. The same creator reuses the same file.
`soyli account backup` creates or locates it for an existing local identity.
Restore with `soyli account import --stdin < /path/to/key.nsec`.
For an encrypted copy, use `soyli account export /path/to/new.ncryptsec`.
Remote identities are backed up in the remote signer instead.

`dev` runs the upstream Vite build watcher and opens the loopback sandbox preview.
It reloads after each build. Legacy HTML examples reload on save without a build.
`--no-open`, `--port` and `--project` support existing workflows. `build` builds
once, `setup` installs with the frozen lockfile, and `run <script>` / `exec <tool>`
use the private toolchain from the current project. `dev`, `build`, and `run` execute
your project's tools. **Check and publish never execute project scripts**: build
your latest changes first; they inspect and run the finished HTML only.

`soyli run verify` uses the upstream guidance tests, TypeScript check and
build. `soyli run test:conformance` runs the reference harness and downloads
its own pinned Playwright browser on first use. This complements the Space host
check; skipped reference cases are reported by the upstream harness.

After upgrading the CLI, `soyli skills update [--project folder]` adds its
bundled skills to existing projects. It replaces only unchanged managed files,
leaves edited or foreign files alone, and reports conflicts. It does not migrate
source code, update dependencies, or fetch unreviewed skill changes from the web.

### Local history, pausing and upgrading

`new` initializes Git but makes **no initial commit**. The developer or their coding
agent should review the scaffold, make the first commit, and commit coherent changes
after relevant checks. Checkpoint unfinished work before pausing, recording known
failures honestly. The managed `docs/napplet-space.md` now gives agents this workflow;
it is guidance, not automatic background commits. Inspect status, diffs and new files
before staging; keep private notes ignored and credentials outside the project.

Publishing does not require a clean working tree. For built projects, the default
source selection includes tracked and unignored untracked files, using their current
bytes. `publish.files` can narrow that selection. Review `soyli publish --dry-run`:
an uncommitted file can become public. Publication makes a separate release repository
under `.napplet-space` and pushes its release history to GRASP; it does not push the
working repository's commits or branches. Local Git checkpoints preserve development
history; GRASP preserves published source snapshots. Neither is a remote backup of
unpublished work. See [source publication](PUBLISHING.md#local-git-and-grasp-release-history).

To pause, preserve the whole project folder including `.git`, `napplet.json` and
`.napplet-space`, plus the creator's separate identity backup. A private, ignored
`.napplet-space/RESUME.md` can record goals, pending work, checks, host limitations
and next steps for a new AI session. Do not include secrets.

After a new CLI release, stop the old preview process and use the upgrade command
above. In the **existing** project, run `soyli skills update`, review any conflicts,
then `soyli dev`. This uses the newly installed host without scaffolding a new
project or changing the creator/napplet identifier. Source/dependency migrations,
if any, need their own explicit release instructions. `publish --resume` is unrelated
to authoring: it continues uploading a frozen release, even when newer edits exist.

Runtime capability support comes from the host, not from the presence of an SDK
export. The prepared **0.8.0** CLI adds NAP-MEDIA shell-owned audio; the currently
published 0.7.0 does not include it. The website needs the matching deployment.
Embedded audio is distinct from host-owned radio streaming; see
[audio and media sessions](MEDIA.md) for the supported subset and verification.

`check` validates the source selection and runs frozen HTML in the same restricted
sandbox as publication. It needs no identity and publishes nothing. The first
check/publication downloads a pinned Chromium headless shell. `browser install`
prepares it in advance. `doctor` reports Git/browser readiness and credential-store
requirements; `account check` verifies the selected signer.

## Requirements and storage

- macOS: Apple Silicon or modern Intel with AVX2; Git/Apple Command Line Tools;
  login Keychain. The installer selects native ARM64 even in a Rosetta terminal.
  Keychain access belongs to the executable; macOS may request authorization when
  changing executables. Signing has no file fallback; the nsec file is for recovery.
- Linux: glibc, ARM64 or x86-64 with SSE4.2; Git; an unlocked Secret Service keyring
  and D-Bus session for identity. Ubuntu 24.04 is the tested desktop baseline.
  Chromium system libraries are listed at `/create#platforms` (`/cli` redirects to the same guide). The CLI never installs OS
  packages or invokes sudo. Alpine/musl and native Windows are not supported.
- Installer: curl, tar, tty, SHA-256 utilities; HTTPS downloads with checksum verification.
- Binary/support files: `~/.local/share/napplet-space/releases/<version-platform-hash>`.
  Command symlinks: `~/.local/bin/soyli` and managed legacy `~/.local/bin/napplet-space`. `NAPPLET_INSTALL_DIR` and
  `NAPPLET_BIN_DIR` override these paths. Foreign existing commands are preserved.
  Shell profiles are left unchanged; a copyable PATH export is printed if needed.
- Credentials: OS store; public account index and private nsec backups:
  `~/.config/napplet-space/accounts/<network>`.
  Existing `SPACE_ACCOUNT_HOME` / `XDG_CONFIG_HOME` configuration remains supported.
- Browser cache: `~/Library/Caches/napplet-space/browsers` on macOS or
  `~/.cache/napplet-space/browsers` on Linux; honors `PLAYWRIGHT_BROWSERS_PATH`.
  A browser download uses a reduced environment with no signing material.
- Project recovery state: `.napplet-space`, ignored by Git and excluded from
  published source. Preserve this directory for interrupted-publication recovery.

The private Node 24.21.0 and pnpm 10.8.0 toolchain is verified against pinned release
checksums and reused across projects. Its cache is
`~/Library/Caches/napplet-space/toolchains` (macOS) or
`~/.cache/napplet-space/toolchains` (Linux); `SPACE_TOOLCHAIN_CACHE` overrides it.
No global runtime or package manager is installed. Dependency installation uses
`--frozen-lockfile --ignore-scripts`. Creators can explicitly run their own package
manager if additional dependencies need installation scripts.

Publishing accepts a finished self-contained `index.html` or `dist/index.html`.
For the upstream profile it selects Git-visible source files plus the built HTML,
excluding ignored dependencies and private state. Existing byte limits, regular-file
checks and credential detection apply; use `publish.files` to narrow selection.
The source repository includes editable source and the exact built artifact.
Required domains combine `napplet.json` with standard `napplet-requires` build
metadata. The artifact and NIP-5D publication format are the same for both profiles.

## Building and releasing

Use the pinned Bun 1.3.11 toolchain for builds:

```sh
bun run cli:build                         # four macOS/Linux archives
bun run cli:build --target darwin-arm64   # one local target
SPACE_TEST_CLI="$PWD/.local/cli/0.6.0/soyli-darwin-arm64/soyli" \
  SPACE_TEST_NATIVE_KEYSTORE=1 bun test tests/services/cli-distribution.test.ts \
  tests/services/cli-terminal.test.ts tests/services/native-identity.test.ts \
  tests/services/publish.test.ts
bun run cli:release --host root@your-vps
```

Archives are named `soyli-<platform>.tar.gz` with matching SHA-256 files. Old
`napplet-space-<platform>.tar.gz` URLs remain served for immutable earlier releases.
The build embeds the shared preview and disables project `.env`/bunfig autoload.
It packages the exact locked Playwright core (including its dynamic worker files)
and dependency notices alongside the executable. Keep the `lib` directory with
manual downloads. Chromium remains a separate, cached official Playwright download.

The release command checks all four archives, uploads them over SSH, verifies
checksums on the VPS and atomically installs the version under
`/opt/napplet-space/downloads/cli`. Existing versions are immutable; different
bytes require a version bump. Archives live outside application releases so a
website rollback does not break existing download links. The server exposes only
versioned archives/checksums, never build directories. `SPACE_CLI_DOWNLOAD_DIR`
selects another download store; local dev uses `.local/cli` through the same route.

For a new CLI release, bump `apps/cli/distribution/version.json` and the installer
version together, build/test/upload the artifacts, then deploy the website with
its updated installer and documentation. Source-only website changes can use
already-published downloads. Keep older archives for reproducibility and rollback.

The terminal regression runs the real piped installer and packaged CLI under a
pseudo-terminal, pauses before choosing an identity option, and checks hidden
input, cancellation and terminal restoration. It uses temporary projects and
does not create creator keys or publish events.

If an older installer stopped at the identity prompt, open a fresh terminal if
Ctrl+C does not respond. The CLI is already installed and the project was created:
enter that project directory and run `~/.local/bin/soyli dev` after upgrading. Creator
setup can follow with `soyli account create` or `soyli account connect`.

## Updating the upstream pins

The scaffold and skill bodies are embedded snapshots, so creation does not depend
on GitHub availability. Maintainers review clean checkouts and run:

```sh
bun scripts/creator-sync.ts --boilerplate /path/to/boilerplate --skills /path/to/napplet
```

This records tracked files at the exact HEAD commits. Never run a fetched installer
as part of this update. The snapshot preserves the upstream MIT license; skills
include their own license copy. The only boilerplate adaptations are package name,
Space configuration/provenance, agent-entry-point preambles, ignored private state,
excluding bundled skill directories/private state from the guidance scanner, and
the static NAP-CONFIG example with one main.ts import. The former schema-free-starter
assertion now checks that example is an object; all other guidance assertions remain.
See `creator-kit.ts` and its
fidelity test for the complete adaptation surface.

Review toolchain pins separately against Node's official release checksums and
pnpm's npm integrity value. Then validate a fresh scaffold, upstream verify and
conformance, the Space sandbox, source/artifact publication, live rebuilds and the
standalone installer before shipping a new immutable CLI version.

### Project destinations and screenshots (CLI 0.3.1)

`soyli config` prints the effective public targets without reading a key
or contacting services. `config init` writes those values into older projects.
New projects include editable `publish.networks.public` and `.local` profiles.
Use `--network local` to inspect the dev stack. CLI publication flags override
project settings. See [configuration precedence and destinations](PUBLISHING.md#visible-project-destinations-and-previews).

`soyli screenshot` captures the current built app, writes `preview.png`
and selects it in `napplet.json`. Inspect that PNG before publishing. A named
capture (`screenshot preview-2.png`) preserves an existing file. Set
`preview.delayMs` for startup timing, or select a different PNG with
`preview.image`. Without an explicit image, publication captures one automatically
and publishes linked standard metadata. Existing projects need not be re-scaffolded:
update the CLI, run `skills update`, then `config init` and `screenshot` as needed.

CLI 0.3.1 is required for these configuration fields and commands. Deploy the
versioned CLI downloads before deploying the installer that advertises them;
older installed binaries remain unchanged until the creator reruns the installer.

## Local listing preview (CLI 0.4.0)

Run `soyli dev` in a project, then select **Listing** beside **Play**. This draft
shows the title, description, tags, creator public key, selected screenshot, license,
identifier, built artifact and effective destinations for the selected network. Use
`--network local` for local services; the default is public. Publication flags can
still override these destinations.

**Capture screenshot** runs the existing sandboxed build check and saves a new PNG,
then selects it as `preview.image` in `napplet.json`. It preserves previous images and
does not publish or sign anything. First use may download the cached Chromium browser.
Review the image after the final build; it may need an interactive scene or custom PNG
for a representative state. Configuration and image changes refresh in Listing.

Missing metadata or a build appears as a draft warning. The listing preview complements
`soyli check`; it does not assert that the artifact passed all publication checks.
Only public configuration and selected, bounded preview media are served by loopback.
Capturing requires an explicit same-origin action.

Existing projects get this view by updating the CLI and restarting `soyli dev`.
Run `soyli skills update` to refresh the separate Space integration guidance;
upstream boilerplate and skill bodies stay unchanged.

Readable links require a one-time claim on the website: connect the publishing account,
choose **Named link**, and claim `/@your-handle/your-slug`. Existing releases can do this
now. Republish does not claim a name; a claimed name follows later releases automatically.

## Napplet settings (CLI 0.5.0)

New boilerplates include `config.schema.json` and an optional SDK settings example.
The maintained Vite plugin embeds the schema in the built HTML. **Settings** in
the preview opens the same live form used on the website; Listing also reports
the schema's property count/version. These are user preferences, separate from
publication targets in `napplet.json`. See [CONFIGURATION.md](CONFIGURATION.md) for
the authoring flow, supported subset, storage behavior and verification.

These settings are included in CLI 0.5.0. Existing projects are
not modified by updating skills. They can adopt the documented schema/SDK pattern
after updating to a CLI release that contains this host. The upstream conformance
runner currently checks boot/degradation only; it does not exercise configuration.

## Connect a remote creator (CLI 0.5.0)

Use `soyli account pair` to display a connection link and QR for your
NIP-46 signer. `--open` also opens the link in a registered signer app. Use
`account connect` instead to paste a signer-provided `bunker://` link at a hidden
prompt. Pairing defaults to our relay and supports a separate `--signer-relay`
override; publishing targets in `napplet.json` are unchanged. Both flows store the
approved client credential in the OS vault. See [identity](IDENTITY.md) for timeout,
cancellation, permissions, recovery and the memory-only website sign-in choices.

## Preview clips (soyLI 0.7.0)

`soyli record [preview.webm]` records and selects a short silent clip from the current
build. The local **Listing** view offers **Record clip**, start-delay and duration
controls, and playback beside the cover image. Existing files are preserved.
Edit `preview.recording.actions` for a timed click/key recipe; see the
[capture example and limits](PREVIEWS.md#short-video-previews--soyli-070).
A later build invalidates the selected clip for publishing until you record again
or remove `preview.video`. The static screenshot remains available for ordinary
clients and OG. Run `soyli skills update` to bring this guidance into an existing
project without replacing upstream skills or re-scaffolding.
