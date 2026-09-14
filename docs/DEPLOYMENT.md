# VPS deployment with Caddy and PM2

Deployment is operator-run. Routine changes are verified and committed locally;
do not deploy or upload releases unless the user explicitly requests deployment.

Updated 2026-09-14. **[napplet.soy](https://napplet.soy) is live**, using the temporary legacy CPU profile on the existing Namecheap VPS. Caddy issued valid Let's Encrypt certificates for the website, www, Blossom and Git; the other site remains available. The deploy script includes Caddy and PM2. Local production builds exercise the same web, relay, Blossom and GRASP implementations and PM2 definitions. Dedicated hosts use the pinned local Caddy version; shared hosts retain their existing Caddy. See the deployment record below for verification and the compatibility workaround.

## One command

```sh
bun run deploy --host your-vps --domain napplet.soy --preflight
bun run deploy --host root@your-vps --domain napplet.example --admin-pubkey <npub-or-hex>
# On an inspected stock Caddy host:
bun run deploy --host root@your-vps --domain napplet.soy --shared-caddy --web-port 3040 --admin-pubkey <npub-or-hex>
# Temporary compatibility profile for the existing Namecheap VPS:
bun run deploy --host root@your-vps --domain napplet.soy --shared-caddy --web-port 3040 --legacy-cpu --admin-pubkey <npub-or-hex>
```

`--preflight` is read-only: it reports OS, CPU compatibility, capacity, listening ports, proxy services and container names/images/ports without installing software or exposing environment values. Inventory continues when the CPU requirement fails so other diagnostics remain available. Actual deployment checks unattended access and CPU compatibility before local checks or uploads, and checks the CPU again before remote changes. SSH and SCP use batch mode and strict saved-host-key verification. Establish key access first; an SSH config alias can select a different login, port or identity. An existing proxy on ports 80/443 or occupied application ports stops a first dedicated-host deployment before package/service changes. Shared mode supports the stock `/usr/bin/caddy` systemd service with `/etc/caddy/Caddyfile`. It keeps the existing binary and service, validates the combined configuration, adds one import of Napplet’s fragment, then reloads gracefully. Custom unit overrides, conflicting hostnames and other proxies require explicit integration.

The first live target is `napplet.soy` at `159.198.46.2`, alongside another existing site. The app's public publication defaults and visible hostname now use `napplet.soy`; its DNS names are `napplet.soy`, `www.napplet.soy`, `blossom.napplet.soy` and `git.napplet.soy`. Inventory confirmed the existing Caddy 2.6.2 supports the required directives; port 3000 is occupied, so Napplet uses 3040 (candidate 3041).

Use a Debian/Ubuntu host with systemd, x86_64 with a modern baseline CPU profile (x86-64-v2, including SSE4.2) or arm64, DNS pointing to it, and inbound TCP 80/443 available. Bun's documented x86_64 support requires SSE4.2 even with its baseline build; Sharp's prebuilt Linux image-processing library also requires SSE4.2 and reports a v2 microarchitecture requirement when its CPU check fails. AVX is not required by this deployment. A legacy virtual CPU can hide the required instructions even when the physical host supports them. Ask the provider to expose an appropriate CPU model or host passthrough; this cannot be enabled by installing a package inside Ubuntu. See [Bun CPU requirements](https://bun.com/docs/installation#cpu-requirements) and [Sharp prebuilt requirements](https://sharp.pixelplumbing.com/install/#prebuilt-binaries). The deployment's early SSE4.2 guard catches this known incompatible profile; it does not replace execution checks for the complete runtime and native dependencies.

All three hostnames—`napplet.example`, `blossom.napplet.example`, and `git.napplet.example`—must resolve to the VPS. Override the service names with `--blossom-domain files.example` and `--git-domain source.example`; all three must be different. An SSH config alias works for `--host`, including its key/port settings. The SSH account must be root or have passwordless sudo. The script installs missing build dependencies without upgrading existing packages, uses a separate PM2 home, and never replaces another site’s proxy binary or service. `--shared-caddy` must be explicit.

The command runs local checks, uploads an allowlisted archive of the working source tree, and invokes [deploy-remote.sh](../scripts/deploy-remote.sh). Uncommitted source changes are included; `.git`, dependencies, builds, local state, and `.env` files are excluded. The remote build uses `bun.lock` and does not reuse macOS native dependencies on Linux.

## Installed layout and service ownership

| Location                                        | Purpose                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/opt/napplet-space/releases/<id>`              | Source and production build for one release                                                                           |
| `/opt/napplet-space/current`                    | Active release symlink                                                                                                |
| `/opt/napplet-space/bin`                        | Caddy 2.10.2 in dedicated mode only, verified against upstream checksums; may retain an unused Bun from older deploys |
| `/opt/napplet-space/tools`                      | PM2 7.0.4 and checksum-pinned Go 1.25.0 and Rust 1.97.1                                                               |
| `/opt/napplet-space/tools/bun<version>/bin/bun` | Checksum-verified runtime; each release's `bin/bun` symlink retains its selected version for rollback                 |
| `/opt/napplet-space/tools/legacy-images`        | Compatibility libvips builds, stored by version and build-script fingerprint                                          |
| `/var/lib/napplet-space/relay`                  | Durable signed relay events and rebuildable Bleve index                                                               |
| `/var/lib/napplet-space/blossom`                | Content-addressed blob bytes and SQLite descriptors/ownership                                                         |
| `/var/lib/napplet-space/grasp`                  | Git objects, repository relay LMDB, private operator identity and migration state                                     |
| `/var/lib/napplet-space/moderation/policy.json` | Durable admin rules, replay receipts and audit trail                                                                  |
| `/var/lib/napplet-space/index`                  | SQLite website projections, cursors/deletions, verified artifacts and normalized previews                             |
| `/opt/napplet-space/shared/server.env`          | Optional operator-maintained runtime/public build configuration; never uploaded                                       |
| `/var/lib/napplet-space/pm2`                    | Dedicated PM2 process list, logs, and PID state                                                                       |
| `/var/lib/napplet-space/caddy`                  | Dedicated-mode Caddy certificate/account data; shared mode keeps the existing service's storage                       |
| `/etc/napplet-space/Caddyfile`                  | This site's HTTPS/reverse-proxy configuration                                                                         |

The `napplet` system account runs the application and, in dedicated mode, Caddy. Shared mode retains the existing Caddy account/service. The web server listens on the selected loopback port (3000 dedicated, 3040 shared by default); the native Khatru relay listens on loopback 19347 and Caddy exposes it at `wss://<domain>/relay`. A separate Bun Blossom process listens on loopback 19348; Caddy exposes its root endpoints at `https://<blossom-domain>`. Native ngit-grasp listens on loopback 19349; Caddy exposes both its repository relay and Git smart HTTP endpoints at `https://<git-domain>`. Git HTTP bodies and receive-pack input are limited to 50 MiB; this does not bound total disk use. Public `/metrics` access is blocked. PM2 uses one fork process per service; Node runs PM2 itself and the short-lived linked-preview metadata worker when a catalog refresh contains supported app references. The ordinary deployed profile still disables publicdev imports. systemd units `napplet-space` and `napplet-space-caddy` persist the services across reboots. Caddy receives only the capability needed to bind low ports. Existing global PM2 state is not used.

## Activation and recovery

1. Require a supported CPU and take an exclusive deployment lock.
2. Install missing pinned tools, extract into a new release directory, install locked dependencies, typecheck/test, run Go race, relay/Blossom/GRASP process tests, and build web, relay, Blossom and GRASP. The GRASP build uses the pinned standalone Rust distribution and system Git/OpenSSL, with two Cargo build jobs. The remote build runs at lower scheduling priority in a systemd scope limited to 3 GiB memory and two CPU cores. Allow several GiB of disk for toolchains and per-release build caches.
3. Start the candidate on the next port after the selected web port and verify `/api/health` reports the expected release ID.
4. Validate the proposed Caddy configuration.
5. Switch the active symlink, recreate the dedicated PM2 services, and verify relay/Blossom/GRASP build fingerprints and the web release ID on the selected port.
6. Save PM2 state, activate the Caddy configuration, and enable service startup on reboot. Deployment does not reboot the host.

Services may have a brief interruption during activation. This does not promise zero-downtime deployment. On activation failure, the error handler returns the active symlink and PM2 web/relay/Blossom/GRASP processes to the previous release where available, and restores the prior Caddy configuration if it was changed. Shared mode checks that the parent config has not changed before replacing it and preserves detected concurrent operator edits. Persistent relay, blob and Git data stay outside release directories. Code rollback does not roll back data. A persistent `grasp/upstream.commit` guard rejects automatic upstream GRASP pin changes, including downgrades. Rehearse a separate full-state migration/restore procedure before changing this guard; see [GRASP operations](GRASP.md). Candidate build failures leave the current processes alone. Old releases remain on disk for inspection; automated retention is deferred.

First-deploy HTTPS issuance depends on public DNS and network reachability. The script validates configuration and checks local application health; it does not certify external DNS, certificate issuance, reboot recovery, or provider firewalls. No firewall or DNS records are modified automatically.

## Operator commands

```sh
sudo systemctl status caddy # shared mode; napplet-space-caddy on a dedicated host
sudo journalctl -u caddy -n 100
sudo -u napplet env PM2_HOME=/var/lib/napplet-space/pm2 \
  node /opt/napplet-space/tools/node_modules/pm2/bin/pm2 list
```

Protect `shared/server.env` as operator configuration. It is sourced by the deploy script; only administrators should be able to edit it. Values beginning with `VITE_` are compiled into the browser and must be public. Deployment defaults `VITE_NOSTR_RELAYS` to this instance’s managed relay. `SPACE_ADMIN_PUBKEYS` in `shared/server.env` overrides the deploy flag; otherwise the supplied public key is used. Admin setup and scope are documented in [MODERATION.md](MODERATION.md). The web server has no creator private keys. The separate ContextVM starter stores its service key outside source; see [CONTEXTVM.md](CONTEXTVM.md).

## Temporary legacy CPU profile

`--legacy-cpu` is an explicit Linux x86_64 deployment profile. It selects the verified Bun 1.3.8 baseline runtime and builds the current Sharp 0.35.4 against checksum-pinned libvips 8.18.6 using generic x86_64 compiler flags. It does not downgrade image-library source versions, remove screenshots or bypass image byte/pixel limits. The documented upstream Bun CPU support requirement still exceeds this VPS's advertised flags, so the profile is a tested workaround for this host rather than an upstream support guarantee.

The build enables PNG, JPEG, WebP and GIF decoding plus EXIF/color support. Optional libvips integrations are disabled; the app still rejects non-raster input before invoking the decoder. libvips and Sharp are installed in Napplet's own directories, without changing system library paths or another application's runtime. Builds stay within the existing 3 GiB/two-CPU deployment scope. Expect slower first-time builds and potentially slower image normalization; normalized previews are cached.

Bun 1.3.8 also loses the original TLS hostname when `node:https` uses a custom DNS lookup. On that pinned runtime, guarded public HTTPS downloads run in a short-lived Node worker using the same DNS, certificate, redirect and byte-limit checks. This applies to artifacts, resources and preview images; SHA-256 verification remains in the caller. Newer Bun and the standalone CLI keep their existing transport. No TLS verification is disabled.

All ordinary checks still run, plus libvips's own test suite and a codec smoke check. Bun executes a small JavaScript program under a separate 768 MiB/15-second limit before further toolchain installation or builds. A release retains its own runtime symlink, so selecting the normal profile later does not change the runtime used by a rollback release. To return to the standard profile after the CPU is fixed, rerun deployment without `--legacy-cpu`; keep the prior release and its compatibility library directory while it remains a rollback candidate.

## Local parity and remaining services

`bun run dev:prod` uses the same PM2 ecosystem and Bun production entry as the VPS deployment and a checksum-verified Caddy 2.10.2. Its PM2 state and downloaded tools stay under `.local`. Default local HTTP avoids changing the OS trust store; local HTTPS can use Caddy's internal CA, which needs separate trust setup. Local PM2 starts both app and proxy; on the VPS systemd owns Caddy and PM2 owns Bun. The same actual server implementations handle requests in both environments.

Deployment includes the [managed relay](RELAY.md), [Blossom storage](BLOSSOM.md), [GRASP source hosting](GRASP.md), and [persistent index/preview worker](INDEXING.md), using the same implementations and PM2 definitions as local development. Managed service stores start empty; deployment does not publish the bundled development examples to Nostr. The index reads the managed relay internally plus the shared public discovery defaults (Damus, nos.lol and Primal), while portable hints advertise the managed relay’s public WSS address. Override `SPACE_INDEX_RELAYS` and optionally `SPACE_INDEX_HINTS` in `shared/server.env`; see [indexing configuration](INDEXING.md). Production discovery stays enabled with `publicdev` disabled. The worker's release heartbeat is checked during activation and its process is included in rollback. Services run natively. Application execution and public HTTPS/service access are verified on the VPS. Startup registration is enabled; an actual whole-VPS reboot has not been performed because the host also runs another site.

## Deployment record: napplet.soy, 2026-09-13

### Live deployment

- Active release: `20260913181640977-29742`, application source through commit `b776b76`. Runtime: isolated Bun 1.3.8, Sharp 0.35.4 and source-built libvips 8.18.6. Previous release `20260913175521306-89539` remains available for code rollback.
- Website: [napplet.soy](https://napplet.soy). Administration: [/admin](https://napplet.soy/admin), using the operator's configured NIP-07 public key. No personal private key is installed. Unauthenticated admin API requests return 401; policy permissions and active process configuration were verified. The operator's own extension-signing session remains a manual check.
- Public relay: `wss://napplet.soy/relay`. Blossom: [blossom.napplet.soy](https://blossom.napplet.soy). Git/GRASP: [git.napplet.soy](https://git.napplet.soy), with its repository relay at `wss://git.napplet.soy/`. Both relays answered read-only subscriptions with EOSE. Public Git metrics return 404.
- Caddy automatically obtained Let's Encrypt certificates for all four HTTPS hostnames, valid until 2026-12-12, and is configured to renew them. `www` permanently redirects to the apex. External HTTPS checks use normal certificate verification. No DNS or firewall changes were needed during activation.
- Five isolated PM2 processes run the web server, indexer, relay, Blossom and GRASP. PM2 state is saved and `napplet-space.service` is enabled for boot. Persistent service data and moderation state are outside the release. The existing Caddy configuration was preserved byte-for-byte with only Napplet's managed comment/import appended, and `schlaustronics.com` still returns HTTP 200.
- The Linux build passed typechecking, 114 application tests (including the two deployment regressions added during activation), Go race tests, relay/Blossom/GRASP process tests, upstream libvips tests and PNG/JPEG/WebP/GIF checks. Native services were retained for the final web-only stylesheet correction after source checksums/build fingerprints were verified.
- All seven Chromium checks passed against public HTTPS: desktop navigation/filtering/history, sandbox playback, tampered artifact rejection, portable/pinned/source routes, styled responsive rendering without JavaScript, mobile layout and signer guidance, and server-rendered OG metadata with 1200×630 PNG previews. No test publications or moderation writes were sent to the public instance.

### Initial attempts, before compatibility activation

- Passwordless SSH with strict host-key verification works. The website, www, Blossom and Git DNS names resolve to `159.198.46.2` from the VPS. The additional `relay.napplet.soy` DNS record is reserved; the configured relay endpoint remains `wss://napplet.soy/relay`.
- Gitea was stopped and its Docker restart policy disabled with operator authorization. Its data remains intact. A resource-heavy process inside that container exited with it. Stopping the container does not establish that the VPS is free of compromise.
- At this stage, the existing `schlaustronics.com` site still returned HTTP 200, stock Caddy remained active, and `/etc/caddy/Caddyfile` retained its original checksum. No Napplet proxy import, release symlink or runtime services had been activated.
- The deployment created Napplet's dedicated system account/state directories and installed missing build dependencies plus isolated pinned toolchains. Failed release directories remain for inspection. The initial administrator's public key is saved for deployment; no personal private key was requested or installed.
- Locked dependency installation succeeded, but Bun's JavaScript runtime was killed by the deployment scope's memory limit before tests ran. The failure reproduced with only `bun -e 'console.log(...)'`, with no application imports, under a separate 768 MiB/20-second diagnostic limit. Disabling JIT did not resolve it. `bun --version` alone succeeds and is insufficient as a runtime check.
- `/proc/cpuinfo` reports `QEMU Virtual CPU version 2.5+` without `sse4_2`, below Bun's documented minimum. The new CPU guard was verified on this VPS: the deploy command now exits before builds, uploads or remote writes.

### Follow-up: comparison with the existing applications

The operator identified the provider as Namecheap and noted that similar apps already run there. A controlled comparison confirmed that the original blanket conclusion, "this VPS cannot run Bun", was too broad:

| Probe on the same VPS                                                           | Observed result                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Existing `/root/.bun/bin/bun`, version 1.3.8, minimal JavaScript                | Pass                                                                                                                          |
| Napplet's isolated Bun 1.3.11, identical JavaScript/environment/resource limits | OOM kill at 768 MiB, before output                                                                                            |
| Fresh upstream checksum-verified Bun 1.3.8 baseline, as the `napplet` user      | Pass; binary hash matches the existing runtime                                                                                |
| Inactive release checks using the isolated 1.3.8 copy                           | Typecheck passes; 97 tests pass, 5 fail and one module-load error is reported, with Sharp failing its CPU compatibility check |

The side-by-side probes used clean environments and separate systemd services limited to 768 MiB, one CPU, 12 seconds and no core dumps. The project check used 1536 MiB, two CPUs and a 90-second ceiling. The minimal command was `bun -e 'console.log("NAPPLET RUNTIME OK")'`. No active runtime was replaced and no existing application was restarted. The temporary diagnostic binary and PATH symlink were removed after the comparison.

This establishes a version-specific Bun startup failure on this host, but does not isolate its internal cause. Separately, Sharp explicitly reports `Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture`. Therefore, downgrading Bun alone does not make this release deployable. A successful older Bun process is not evidence that the full pinned dependency set supports the same CPU profile. The CPU guard remains justified for the current deployment; it should not be described as proof that every Bun version fails.

Namecheap documents KVM/QEMU virtualization and its customer-facing SolusVM controls, but the published panel guide does not list CPU-model selection. Ask hosting support about availability rather than promising a self-service setting: [virtualization](https://www.namecheap.com/support/knowledgebase/article.aspx/909/48/what-virtualization-technology-is-set-up-on-vps/), [VPS panel guide](https://www.namecheap.com/support/knowledgebase/article.aspx/9974/48/how-to-manage-your-vps-with-solusvm-for-kvm/).

Suggested support request (prepared only; not sent):

> My VPS at 159.198.46.2 exposes "QEMU Virtual CPU version 2.5+" and lacks SSE4.2, SSE4.1, SSSE3 and POPCNT in /proc/cpuinfo. Our current Sharp image-processing library rejects this CPU profile. Can you expose an x86-64-v2-capable CPU model or host passthrough, or migrate the VPS to a host/profile that provides these features? Please confirm availability and any downtime before making changes; existing sites and all server data must be preserved.

Once the provider offers an appropriate CPU profile, coordinate any required stop/start with the existing site's operator, run standard preflight again and redeploy without `--legacy-cpu`. The runtime execution check and full build/tests must pass before activation. The compatibility profile below allows deployment while that support request is pending. External HTTPS and service checks follow activation; personal administrator signing and an actual VPS reboot remain separate operator checks.

### Compatibility build and launcher diagnosis

The explicit legacy profile subsequently passed the complete 112-test application suite, Go race tests and relay/Blossom/GRASP process tests on the VPS. Sharp's WebAssembly alternative was tested first but could not run with either this Bun runtime or the host's Node WebAssembly SIMD support. The deployed compatibility approach therefore builds current native image-library sources with generic x86_64 compiler flags.

The first successful compatibility build stopped at candidate startup, before service activation. Bun 1.3.8 exposed an empty `process.env` when `runuser` inherited `/root`, which the `napplet` account cannot traverse. Consequently the web process ignored `PORT=3041` and tried its default 3000. Controlled launches of the identical production entry and environment reproduced the failure from `/root` and succeeded from the service-owned release directory. The remote helper now changes into that directory immediately after extraction, before any application command. This protects all runtime configuration, including moderation settings, rather than merely overriding the web port. Existing applications stayed available during the failed candidate check.

Activation then exposed two deployment-check defects: GRASP returns formatted NIP-11 JSON, so compact-string matching rejected the correct name/version; and GNU `readlink -f` returned a nonexistent `current` path, incorrectly making first-deploy rollback create a self-referencing link. `deploy-state.ts` now parses JSON and resolves only an actual directory symlink, treating a missing current release as no rollback candidate and rejecting malformed existing links. Regression tests cover both cases. Recovery removed only Napplet's self-referencing link, verified 201 source checksums and the retained native build fingerprints, reran application checks, and used the corrected deployment's activation/rollback section without repeating native compilation.

The first live browser run also caught an SSR stylesheet URL that returned 404 until hydration replaced it. The source archive excludes `.gitignore`; automatic Tailwind discovery could therefore scan the generated client bundle during the subsequent SSR build and produce a different stylesheet hash. `styles.css` now explicitly scopes discovery to `apps/web/src`, following [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files). The Linux rebuild verified that the SSR stylesheet exists in the client output. A JavaScript-disabled browser regression covers stylesheet availability and responsive gallery layout.

## Share previews and optional ContextVM

Deployment sets `SPACE_SITE_ORIGIN=https://<domain>` for canonical and OG URLs and disables `publicdev`. Public dev caches remain outside the archive. The native resvg renderer and its bundled DM Sans font are installed/built for the VPS architecture with the rest of the locked dependencies.

The separate `infra/cvm.ecosystem.config.cjs` can run the ContextVM starter under PM2 with explicit relay URLs and a persistent key path. Automated activation of that optional service and provisioning its relay remain part of the next operator-services slice; the web deployment does not silently start or announce it.

## Creator CLI downloads

The standalone installer and `/cli` guide are served by the web application.
Build and test the creator packages with `bun run cli:build`, then upload them
with `bun run cli:release --host root@your-vps` before deploying a website version
that advertises that CLI version. The upload script verifies all four archives
locally and remotely, preserves immutable prior versions, and requires no web
service restart. The same HTTP download handler serves `.local/cli` in local dev
and `/opt/napplet-space/downloads/cli` in production. Set
`SPACE_CLI_DOWNLOAD_DIR` to override the store. It contains only public versioned
archives/checksums and remains outside application release/rollback directories.
See [CLI guide](CLI.md) for native platform checks and requirements.

### Standalone CLI launch — 2026-09-13

Active release: `20260913190543119-13840`. Rollback release:
`20260913181640977-29742`. Application and release-tool source through `7db71ed`.
Unchanged native services, dependencies and image codecs were reused in an
isolated copy; all 218 deployed source files were checked against local SHA-256
values, the web build was rebuilt with the existing private Bun 1.3.8 runtime,
and all 116 application tests passed on the VPS before activation. Candidate
checks verified the installer and all four download/checksum routes before the
existing rollback-capable Caddy/PM2 activation procedure switched the site.

CLI 0.1.0 archives live in `/opt/napplet-space/downloads/cli/0.1.0`. Their sizes
and SHA-256 values are recorded in `apps/cli/distribution/release-0.1.0.json`.
The release uploader now transfers small verified chunks over four SSH streams,
retries interrupted connections and reuses completed chunks on another invocation.
This was needed after a slow SSH transfer dropped; the old site remained active
throughout transfer and staging.

Post-deploy verification passed:

- Eight live Chromium checks, including mobile layout, SSR styles, OG metadata,
  sandbox restrictions, onboarding and all download links.
- Actual public HTTPS installer into a temporary prefix with no Bun or Node on
  PATH: verified archive → new Git project → frozen browser check → CLI preview.
- Main/admin endpoints, unauthorized administration rejection, www redirect,
  Blossom health, relay/GRASP NIP-11 and WebSocket EOSE, Git metrics protection,
  and the existing `schlaustronics.com` site.
- Native Apple Silicon checks included identity reuse, encrypted recovery,
  publication against isolated local services, idempotent retries and crash
  recovery. Linux ARM64 and x86-64 packages passed fresh browser downloads,
  Secret Service identity checks and sandbox startup in isolated Ubuntu 24.04
  containers. Intel macOS startup and sandbox checks passed under Rosetta;
  the Intel package requires AVX2 on physical Intel Macs.

Temporary test identities were removed. No test creations were published to
public relays. Windows and musl Linux distributions remain unsupported.

## Public relay discovery — 2026-09-13

Active release: `20260913202705982-26454`, application source through `2d2ec24`.
Rollback release: `20260913200901614-97707`; the earlier CLI release remains on disk.

The original deployment read only its managed relay. It now queries that relay plus
Damus, nos.lol and Primal through the persistent indexer; `publicdev` remains disabled.
The first catch-up admitted 114 signed records, producing 91 distinct creations after
validation, replacement/deletion handling and snapshot deduplication (97 gallery cards
including the six examples). This is a current observation, not a fixed catalog size.

Deployment exposed two related compatibility issues: deletion batches exceeded the
managed relay's 64-value tag-filter limit, and Bun 1.3.8's custom DNS path lost the
TLS hostname. The initial activation rolled back; the corrected release uses bounded
deletion batches and the same guarded HTTPS transport in short-lived Node workers.
A valid 9,246,415-byte napplet also exceeded the old three-second mirror deadline;
mirror attempts now have eight seconds within the worker's twelve-second deadline.
Signature, SHA-256, UTF-8, certificate, private-network and size checks remain enforced.

The release reused verified unchanged native binaries and locked dependencies, then
rebuilt the web application. Both Caddy configuration checksums stayed unchanged;
the other VPS site, HTTPS, relay, Blossom and Git endpoints remained healthy.

Verification: 119 application tests and typechecking passed on the VPS; the local
native relay → worker → production SSR → sandbox integration passed. Both opt-in
HTTPS tests passed on Bun 1.3.8, including the 9.2 MB artifact and rejection of
invalid certificates, private addresses and oversized responses. The eight existing
app/onboarding browser checks passed with dynamic-catalog fixture assertions.
Live Rubik Cube playback, OG metadata and responsive rendering passed, followed by
Random Sticker loading/changing/exporting images through the production resource
endpoint. All 225 deployed source checksums matched; PM2 saved the four-relay
configuration for reboot recovery. No test events were published to public relays.

### Installer terminal hotfix, 2026-09-14

Commit `806c6d6` fixes macOS creator prompts that froze after the user paused to
read them. The installer now reopens the actual terminal device instead of the
`/dev/tty` alias. CLI 0.1.0 binaries and their immutable archives are unchanged.

Only `apps/web/public/install.sh` and its served `apps/web/dist/client/install.sh`
copy were atomically updated in active release `20260913202705982-26454`, under the
deployment lock, with automatic rollback on verification failure. Their new
SHA-256 is `69c91010027c6e3416f2c0fd748ecf316bef37a994e71591e2c9227261e6ce58`.
Original copies and the activation record are retained at
`/opt/napplet-space/shared/hotfixes/806c6d6`. This is an explicitly recorded static
hotfix to that release; no services were restarted or proxy configuration changed.

Typechecking, shell syntax, and five installer/distribution integration tests
passed, including delayed input, hidden input cancellation, terminal restoration,
and noninteractive setup. A fresh macOS pseudo-terminal then fetched the actual
HTTPS installer and archive, waited at the creator prompt, and completed setup
with `3` followed by Return. Both hosted websites remained reachable. No creator
keys or public events were created by verification.

## Upstream starter release — 2026-09-14

Active release: `20260914071744622-83832`. Rollback release:
`20260913202705982-26454`. Source: `7f8618d` (CLI/upstream integration) plus
`aba78dd` (indexer readiness). CLI 0.2.0's immutable archives and exact upstream /
toolchain pins are recorded in `apps/cli/distribution/release-0.2.0.json`.
The public installer SHA-256 is
`e6527867fba73f705134adb93ef7ea38e59f93edcd240f89b09e0833c0c8ad7e`.
Older CLI 0.1.0 archives remain available.

The release reuses unchanged native service binaries and dependencies, builds the
website with the existing Bun 1.3.8 legacy CPU profile, and passes all 124 checks
on the VPS before activation. The Caddy parent and Napplet fragment hashes remain
`be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f` and
`e5da7681ad68641e0e6d18c77463cb94a403615b5bcfe4b8ca01e3858736bfba`.

An initial activation rolled back because the old readiness script demanded zero
errors from every discovery relay. Readiness now requires an enabled, fresh
indexer report bearing the candidate release ID; unavailable public relays remain
visible in health reporting and do not prevent website deployment. Missing, stale
or previous-release reports still fail. Native services retain their own readiness
checks. Damus query timeouts were present during verification; other discovery
relays remained configured and the index report was fresh.

Verified the public HTTPS installer end to end with isolated account/install paths
and global runtimes removed from PATH: checksum-verified CLI 0.2.0, default upstream
scaffold, embedded skills, dependency install/build, sandbox check and preview.
The packaged Mac CLI also passed delayed terminal input/cancellation and corrupt
archive tests, upstream verification/conformance, storage and live rebuild checks.
Linux ARM64/x64 created and verified the upstream starter in disposable Ubuntu
containers without global runtimes; the macOS Intel binary started under Rosetta.
Upstream conformance reported 5 pass / 0 fail / 5 documented skips.

Live checks covered the default create command and CLI guide, HTTP/HTTPS and www
redirects, admin authentication, both relay WebSockets/NIP-11 endpoints, Blossom,
blocked Git metrics, and the existing `schlaustronics.com` site. No test creations
were published to public relays.

## Prepared locally: community features and CLI 0.3.0

This checkout adds signed permanent `/@handle/slug` claims, pinned-source remixes,
Nostr comments/replies, likes/unlikes and the LNURL zap flow. Community state lives
in the persistent `community` directory; it must survive application rollbacks.

CLI 0.3.0 archives have been built locally for macOS/Linux on ARM64 and x64. Their
source revision, sizes and checksums are in
`apps/cli/distribution/release-0.3.0.json`. The archives remain in `.local/cli/0.3.0`.
The native macOS package and piped installer passed their local tests. Linux and
Intel macOS targets were built but were not executed on those operating systems.

No artifacts have been uploaded and no VPS deployment was performed for this
change. Because the website installer now advertises 0.3.0, release the CLI first:

```sh
bun run cli:release --host root@159.198.46.2
```

Then run your normal website deployment command. Existing installed CLI users
rerun the website installer to receive 0.3.0. See [community behavior and limits](COMMUNITY.md)
and [remix provenance](REMIXING.md) before rollout. Zap invoice validation uses
signed fixtures, and the browser wallet was simulated; no Lightning payment was
sent during these checks.
