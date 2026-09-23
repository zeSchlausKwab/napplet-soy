# soyLI releases and updates

GitHub Releases distribute the standalone CLI independently of the website/VPS.
The source version is **0.19.0**. A successful GitHub workflow run and published
release are separate acceptance steps.

Version 0.19.0 adds Rust/WASM build recipes and verified Bevy 2D/3D examples in
the existing single-HTML sandbox. See [WASM.md](WASM.md) for supported targets,
prerequisites and limits. Bunker connections now accept up to eight relay hints;
an unresponsive relay no longer delays a request already acknowledged elsewhere.

New NIP-46 sessions use owner-only files outside Git by default. Local private
keys remain in the OS vault. Existing remote sessions retain their storage until
`soyli account storage file` migrates them without re-pairing; use
`--session-storage keychain` to opt new sessions into native storage instead.

Publication follows your selected account. A running operation keeps its starting
account without resetting the shared selection, and each public key retains its
own releases and pending jobs in the same folder. Backend and local-manager
context follow that author. Switching signing methods for the same public key
keeps its listing; switching public keys creates a separate listing and repository.
The bundled agent guidance forbids switching accounts to bypass a publish error.

After updating, restart previews and run `soyli skills update` in existing projects,
reviewing conflicts with locally edited guidance. New account metadata and
multi-author journals are not readable by older CLI versions; use 0.19.0
consistently after migration. Original keys, sessions, source and releases are kept.

Version 0.18.2 fixes preview cleanup on terminal hangup and launcher exit, corrects
the bundled action guide's retired bootstrap instructions, and clarifies agent
preview ownership, mobile checks and reference-harness limitations. Release CI now
checks packaged preview cleanup and runs the assembled starter's complete `verify`
command. After updating, restart previews and run `soyli skills update` in existing
projects; review any reported conflicts without discarding your local edits.

For website deployment, use `bun run deploy` with the usual options, without the
old `bun run cli:release --host … &&` prefix. The optional legacy `cli:release`
uploads four locally built archives to a VPS mirror; it neither triggers GitHub CI
nor downloads CI artifacts. Missing local archives do not block website deployment.

The 0.18.1 installer resolves macOS CPU probes by their system path, including in
minimal environments without `/usr/sbin` on PATH. A failed probe reports the
system error separately from an unsupported processor. Packaged creation and
recording test failures include the CLI diagnostic, and artifact actions use
Node 24. The failed `soyli-v0.18.0` tag is retained; fixes use a new version.
Chromium/FFmpeg installation uses soyLI's checksum-verified managed Node runtime
instead of Bun's Node compatibility layer, which stalled downloads intermittently
on native CI. No separately installed Node is required. Browser availability and
playback still use the same pinned Playwright driver and browser cache.

## For creators

```sh
soyli doctor          # local prerequisites plus latest stable version
soyli update          # download, verify and switch the managed installation
soyli --version
# Restart running preview sessions, then inside an existing project:
soyli skills update
```

An older CLI needs the new installer once, after the first GitHub release exists:

```sh
curl -fsSL https://github.com/zeSchlausKwab/napplet-soy/releases/latest/download/install.sh | sh
```

The same script accepts `new my-napplet` or `remix <link> my-remix`. Inspect it before
executing it if preferred. `https://napplet.soy/install.sh` remains a version-pinned
copy which changes on website deployment; the GitHub URL follows the latest release.

Updates only use stable `soyli-vX.Y.Z` releases from
[zeSchlausKwab/napplet-soy](https://github.com/zeSchlausKwab/napplet-soy/releases).
Prereleases, incomplete platform assets and downgrades are refused. Doctor checks
GitHub with a five-second deadline; no release, offline, malformed or rate-limited
responses are reported as unavailable alongside the working local diagnostics.
`--json` returns the structured release status and sanitized failure context.
There is no background updater, account requirement or credential-store access.

The updater executes the installer already bundled in the installed CLI. Downloads
use HTTPS, SHA-256 verification and an executable-version check before the command
symlink is switched. The whole distribution, including Playwright support files,
is updated together. A failed download/check keeps the working command. Old release
directories, accounts, recovery keys, caches, source and unfinished work are retained.
Checksums detect corrupt downloads; they do not provide an independent publisher
signature. Distribution trust is the GitHub repository/release and HTTPS.

Installer-managed custom paths are remembered. A source checkout should be updated
with Git; manually unpacked distributions must be replaced as a whole or migrated
through the installer. Unrelated commands are never overwritten. The legacy
`napplet-space` alias follows the upgrade only if it belongs to the same installation.
Updates take an installation lock; after an interrupted/killed installer, confirm no
installer is running before removing the reported `.install-lock` directory.

## Cut a release

1. Update `apps/cli/distribution/version.json` and the `version=` line in
   `apps/web/public/install.sh` together. Update relevant feature/release notes.
2. Commit the change and push the commit, then its matching tag:

   ```sh
   git tag -a soyli-v0.19.0 -m 'napplet soyLI 0.19.0'
   git push origin main
   git push origin soyli-v0.19.0
   ```

3. Watch **soyLI releases** in Actions. Publish only after all four native jobs pass.
   The workflow handles publication; no manual asset upload or VPS login is required.
4. Try the published installer and `soyli doctor` on a separate installation. Deploy
   the website separately when its pinned installer/docs should change.

[Workflow](../.github/workflows/soyli-release.yml) triggers on matching tags,
relevant pull requests and manual runs. PRs and manual branch runs only validate;
a manual run on a matching tag may publish/retry that tag. A different tag or
installer version fails before publication. No website deployment is triggered.

The read-only check job typechecks and runs repository tests. A matrix uses native
macOS ARM64/Intel and Ubuntu ARM64/x64 runners with pinned Bun 1.3.11. Each builds
one archive, exercises the real installer/updater, and runs account-free scaffold,
build and browser checks with fresh caches and no global Node/Bun on PATH.
Linux x64 keeps the SSE4.2 baseline runtime. CI does not certify older physical
Macs, mobile gameplay or interactive OS credential-store authorization.

Only the final job has `contents: write`, using the job's automatic `GITHUB_TOKEN`.
No custom token or server secret is needed. Actions are pinned to commit hashes;
checkout does not persist its token. The selected standard runner labels follow
[GitHub's runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The publisher verifies all four checksums before creating a draft. It uploads:

- Four `soyli-<platform>.tar.gz` archives and their `.sha256` files.
- `install.sh`, pinned to that release.
- `release-manifest.json` with source commit and native smoke-test matrix.
- `SHA256SUMS` covering archives, installer and manifest.

Only after the uploads succeed does it publish the draft and mark it latest.
A failed upload leaves a draft that the updater cannot discover; rerunning can
replace draft assets. Published versions cannot be overwritten by this workflow;
corrections need a new version. Release jobs are serialized and refuse to replace
a newer stable version with an older one. Protect release tags and repository write
access as appropriate for the maintainers.

## Local checks and alternate hosting

```sh
bun run check
bun run cli:build --target darwin-arm64
SPACE_TEST_CLI="$PWD/.local/cli/0.19.0/soyli-darwin-arm64/soyli" \
  bun test tests/services/cli-update.test.ts tests/services/cli-distribution.test.ts
```

Choose the matching native target on Linux/Intel. Full build and legacy VPS upload
instructions remain in [CLI.md](CLI.md#building-and-releasing). Existing immutable
VPS download URLs remain valid. An explicitly configured `NAPPLET_DOWNLOAD_BASE`
uses `<base>/<version>/<archive>`; it does not silently fall back to another host.
`NAPPLET_RELEASE_VERSION` pins the bundled installer for the updater; it is not a
CLI downgrade option. `SOYLI_RELEASE_API` is a loopback-only test hook, not an
alternate production update channel.
