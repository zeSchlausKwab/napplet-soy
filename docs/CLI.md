# Creator CLI

The public installer at `https://napplet.soy/install.sh` installs a standalone
`napplet-space` executable and its pinned Playwright support files. A separate
Bun, Node, npm, or platform checkout is not required. The executable embeds Bun;
this is not an alternative runtime implementation for users who reject Bun itself.

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet
# Follow the printed PATH instruction if ~/.local/bin is not already on PATH.
cd my-napplet
napplet-space dev
# After editing (or stopping dev):
napplet-space build
napplet-space run verify
napplet-space check
napplet-space publish
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
`napplet-space account backup` creates or locates it for an existing local identity.
Restore with `napplet-space account import --stdin < /path/to/key.nsec`.
For an encrypted copy, use `napplet-space account export /path/to/new.ncryptsec`.
Remote identities are backed up in the remote signer instead.

`dev` runs the upstream Vite build watcher and opens the loopback sandbox preview.
It reloads after each build. Legacy HTML examples reload on save without a build.
`--no-open`, `--port` and `--project` support existing workflows. `build` builds
once, `setup` installs with the frozen lockfile, and `run <script>` / `exec <tool>`
use the private toolchain from the current project. `dev`, `build`, and `run` execute
your project's tools. **Check and publish never execute project scripts**: build
your latest changes first; they inspect and run the finished HTML only.

`napplet-space run verify` uses the upstream guidance tests, TypeScript check and
build. `napplet-space run test:conformance` runs the reference harness and downloads
its own pinned Playwright browser on first use. This complements the Space host
check; skipped reference cases are reported by the upstream harness.

After upgrading the CLI, `napplet-space skills update [--project folder]` adds its
bundled skills to existing projects. It replaces only unchanged managed files,
leaves edited or foreign files alone, and reports conflicts. It does not migrate
source code, update dependencies, or fetch unreviewed skill changes from the web.

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
  Chromium system libraries are listed at `/cli`. The CLI never installs OS
  packages or invokes sudo. Alpine/musl and native Windows are not supported.
- Installer: curl, tar, tty, SHA-256 utilities; HTTPS downloads with checksum verification.
- Binary/support files: `~/.local/share/napplet-space/releases/<version-platform-hash>`.
  Command symlink: `~/.local/bin/napplet-space`. `NAPPLET_INSTALL_DIR` and
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
SPACE_TEST_CLI="$PWD/.local/cli/0.3.0/napplet-space-darwin-arm64/napplet-space" \
  SPACE_TEST_NATIVE_KEYSTORE=1 bun test tests/services/cli-distribution.test.ts \
  tests/services/cli-terminal.test.ts tests/services/native-identity.test.ts \
  tests/services/publish.test.ts
bun run cli:release --host root@your-vps
```

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
enter that project directory and run `~/.local/bin/napplet-space dev`. Creator
setup can follow with `napplet-space account create` or `napplet-space account connect`.

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
and excluding bundled skill directories/private state from the guidance scanner.
The scanner's actual assertions remain unchanged. See `creator-kit.ts` and its
fidelity test for the complete adaptation surface.

Review toolchain pins separately against Node's official release checksums and
pnpm's npm integrity value. Then validate a fresh scaffold, upstream verify and
conformance, the Space sandbox, source/artifact publication, live rebuilds and the
standalone installer before shipping a new immutable CLI version.
