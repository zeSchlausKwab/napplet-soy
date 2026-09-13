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
napplet-space check
napplet-space publish
```

`new` initializes Git and writes HTML, configuration, license and coding-agent
instructions. It reuses the chosen creator or asks to create/connect/set up later.
The installer reconnects stdin to the controlling terminal so identity prompts
also work through `curl | sh`. Noninteractive users can pass `--identity later`.
`dev` opens the loopback preview and reloads edited HTML. `--no-open`, `--port`
and `--project` support existing workflows. The CLI supplies trusted preview code;
project scripts and generated runtime copies are never executed by dev/check/publish.

`check` validates the source selection and runs frozen HTML in the same restricted
sandbox as publication. It needs no identity and publishes nothing. The first
check/publication downloads a pinned Chromium headless shell. `browser install`
prepares it in advance. `doctor` reports Git/browser readiness and credential-store
requirements; `account check` verifies the selected signer.

## Requirements and storage

- macOS: Apple Silicon or modern Intel with AVX2; Git/Apple Command Line Tools;
  login Keychain. The installer selects native ARM64 even in a Rosetta terminal.
  Keychain access belongs to the executable; macOS may request authorization when
  changing executables. There is no plaintext fallback.
- Linux: glibc, ARM64 or x86-64 with SSE4.2; Git; an unlocked Secret Service keyring
  and D-Bus session for identity. Ubuntu 24.04 is the tested desktop baseline.
  Chromium system libraries are listed at `/cli`. The CLI never installs OS
  packages or invokes sudo. Alpine/musl and native Windows are not supported.
- Installer: curl, tar, SHA-256 utilities; HTTPS downloads with checksum verification.
- Binary/support files: `~/.local/share/napplet-space/releases/<version-platform-hash>`.
  Command symlink: `~/.local/bin/napplet-space`. `NAPPLET_INSTALL_DIR` and
  `NAPPLET_BIN_DIR` override these paths. Foreign existing commands are preserved.
  Shell profiles are left unchanged; a copyable PATH export is printed if needed.
- Credentials: OS store; public account index: `~/.config/napplet-space/accounts`.
  Existing `SPACE_ACCOUNT_HOME` / `XDG_CONFIG_HOME` configuration remains supported.
- Browser cache: `~/Library/Caches/napplet-space/browsers` on macOS or
  `~/.cache/napplet-space/browsers` on Linux; honors `PLAYWRIGHT_BROWSERS_PATH`.
  A browser download uses a reduced environment with no signing material.
- Project recovery state: `.napplet-space`, ignored by Git and excluded from
  published source. Preserve this directory for interrupted-publication recovery.

No dependency installation is needed for the HTML starters. Optional package.json
scripts simply invoke the CLI; creators may use their preferred package manager
if they later add their own build tooling. Publishing currently accepts a finished,
self-contained `index.html`, not arbitrary project build scripts.

## Building and releasing

Use the pinned Bun 1.3.11 toolchain for builds:

```sh
bun run cli:build                         # four macOS/Linux archives
bun run cli:build --target darwin-arm64   # one local target
SPACE_TEST_CLI="$PWD/.local/cli/0.1.0/napplet-space-darwin-arm64/napplet-space" \
  SPACE_TEST_NATIVE_KEYSTORE=1 bun test tests/services/cli-distribution.test.ts \
  tests/services/native-identity.test.ts tests/services/publish.test.ts
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
