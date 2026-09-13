# VPS deployment with Caddy and PM2

Updated 2026-09-13. The deploy script includes Caddy and PM2. Local production builds exercise the same web, relay, Blossom and GRASP implementations and PM2 definitions. Dedicated hosts use the pinned local Caddy version; shared hosts retain their existing Caddy. The first live deployment is blocked by the VPS CPU profile; no Napplet release has been activated. See the deployment record below.

## One command

```sh
bun run deploy --host your-vps --domain napplet.soy --preflight
bun run deploy --host root@your-vps --domain napplet.example --admin-pubkey <npub-or-hex>
# On an inspected stock Caddy host:
bun run deploy --host root@your-vps --domain napplet.soy --shared-caddy --web-port 3040 --admin-pubkey <npub-or-hex>
```

`--preflight` is read-only: it reports OS, CPU compatibility, capacity, listening ports, proxy services and container names/images/ports without installing software or exposing environment values. Inventory continues when the CPU requirement fails so other diagnostics remain available. Actual deployment checks unattended access and CPU compatibility before local checks or uploads, and checks the CPU again before remote changes. SSH and SCP use batch mode and strict saved-host-key verification. Establish key access first; an SSH config alias can select a different login, port or identity. An existing proxy on ports 80/443 or occupied application ports stops a first dedicated-host deployment before package/service changes. Shared mode supports the stock `/usr/bin/caddy` systemd service with `/etc/caddy/Caddyfile`. It keeps the existing binary and service, validates the combined configuration, adds one import of Napplet’s fragment, then reloads gracefully. Custom unit overrides, conflicting hostnames and other proxies require explicit integration.

The first live target is `napplet.soy` at `159.198.46.2`, alongside another existing site. The app's public publication defaults and visible hostname now use `napplet.soy`; its DNS names are `napplet.soy`, `www.napplet.soy`, `blossom.napplet.soy` and `git.napplet.soy`. Inventory confirmed the existing Caddy 2.6.2 supports the required directives; port 3000 is occupied, so Napplet uses 3040 (candidate 3041).

Use a Debian/Ubuntu host with systemd, x86_64 with SSE4.2 or arm64, DNS pointing to it, and inbound TCP 80/443 available. Bun requires SSE4.2 on x86_64 even with its baseline build; AVX is not required by this deployment. A legacy virtual CPU can hide the required instructions even when the physical host supports them. Ask the provider to expose an appropriate CPU model or host passthrough; this cannot be enabled by installing a package inside Ubuntu. See [Bun CPU requirements](https://bun.com/docs/installation#cpu-requirements).

All three hostnames—`napplet.example`, `blossom.napplet.example`, and `git.napplet.example`—must resolve to the VPS. Override the service names with `--blossom-domain files.example` and `--git-domain source.example`; all three must be different. An SSH config alias works for `--host`, including its key/port settings. The SSH account must be root or have passwordless sudo. The script installs missing build dependencies without upgrading existing packages, uses a separate PM2 home, and never replaces another site’s proxy binary or service. `--shared-caddy` must be explicit.

The command runs local checks, uploads an allowlisted archive of the working source tree, and invokes [deploy-remote.sh](../scripts/deploy-remote.sh). Uncommitted source changes are included; `.git`, dependencies, builds, local state, and `.env` files are excluded. The remote build uses `bun.lock` and does not reuse macOS native dependencies on Linux.

## Installed layout and service ownership

| Location | Purpose |
| --- | --- |
| `/opt/napplet-space/releases/<id>` | Source and production build for one release |
| `/opt/napplet-space/current` | Active release symlink |
| `/opt/napplet-space/bin` | Bun 1.3.11; Caddy 2.10.2 in dedicated mode only, verified against upstream checksums |
| `/opt/napplet-space/tools` | PM2 7.0.4 and checksum-pinned Go 1.25.0 and Rust 1.97.1 |
| `/var/lib/napplet-space/relay` | Durable signed relay events and rebuildable Bleve index |
| `/var/lib/napplet-space/blossom` | Content-addressed blob bytes and SQLite descriptors/ownership |
| `/var/lib/napplet-space/grasp` | Git objects, repository relay LMDB, private operator identity and migration state |
| `/var/lib/napplet-space/moderation/policy.json` | Durable admin rules, replay receipts and audit trail |
| `/var/lib/napplet-space/index` | SQLite website projections, cursors/deletions, verified artifacts and normalized previews |
| `/opt/napplet-space/shared/server.env` | Optional operator-maintained runtime/public build configuration; never uploaded |
| `/var/lib/napplet-space/pm2` | Dedicated PM2 process list, logs, and PID state |
| `/var/lib/napplet-space/caddy` | Dedicated-mode Caddy certificate/account data; shared mode keeps the existing service's storage |
| `/etc/napplet-space/Caddyfile` | This site's HTTPS/reverse-proxy configuration |

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

## Local parity and remaining services

`bun run dev:prod` uses the same PM2 ecosystem and Bun production entry as the VPS deployment and a checksum-verified Caddy 2.10.2. Its PM2 state and downloaded tools stay under `.local`. Default local HTTP avoids changing the OS trust store; local HTTPS can use Caddy's internal CA, which needs separate trust setup. Local PM2 starts both app and proxy; on the VPS systemd owns Caddy and PM2 owns Bun. The same actual server implementations handle requests in both environments.

Deployment includes the [managed relay](RELAY.md), [Blossom storage](BLOSSOM.md), [GRASP source hosting](GRASP.md), and [persistent index/preview worker](INDEXING.md), using the same implementations and PM2 definitions as local development. Managed service stores start empty; deployment does not publish the bundled development examples to Nostr. The index reads the managed relay internally and advertises its public WSS address; configure additional `SPACE_INDEX_RELAYS` and `SPACE_INDEX_HINTS` in `shared/server.env`. The worker's release heartbeat is checked during activation and its process is included in rollback. Services run natively. VPS installation has been attempted, but application execution, HTTPS activation and reboot recovery remain unverified because of the CPU blocker below.

## Deployment record: napplet.soy, 2026-09-13

- Passwordless SSH with strict host-key verification works. The website, www, Blossom and Git DNS names resolve to `159.198.46.2` from the VPS. The additional `relay.napplet.soy` DNS record is reserved; the configured relay endpoint remains `wss://napplet.soy/relay`.
- Gitea was stopped and its Docker restart policy disabled with operator authorization. Its data remains intact. A resource-heavy process inside that container exited with it. Stopping the container does not establish that the VPS is free of compromise.
- The existing `schlaustronics.com` site still returns HTTP 200, stock Caddy remains active, and `/etc/caddy/Caddyfile` retains its original checksum. No Napplet proxy import, release symlink or runtime services have been activated.
- The deployment created Napplet's dedicated system account/state directories and installed missing build dependencies plus isolated pinned toolchains. Failed release directories remain for inspection. The initial administrator's public key is saved for deployment; no personal private key was requested or installed.
- Locked dependency installation succeeded, but Bun's JavaScript runtime was killed by the deployment scope's memory limit before tests ran. The failure reproduced with only `bun -e 'console.log(...)'`, with no application imports, under a separate 768 MiB/20-second diagnostic limit. Disabling JIT did not resolve it. `bun --version` alone succeeds and is insufficient as a runtime check.
- `/proc/cpuinfo` reports `QEMU Virtual CPU version 2.5+` without `sse4_2`, below Bun's documented minimum. The new CPU guard was verified on this VPS: the deploy command now exits before builds, uploads or remote writes.

To resume, arrange a provider-side CPU profile exposing SSE4.2 and coordinate any required stop/start with the existing site's operator. Run preflight again, verify the installed Bun can execute a small JavaScript program under the diagnostic resource limits, then rerun the shared deployment command above. Complete external HTTPS, relay/Blossom/Git, admin-signature and reboot-recovery checks before calling the deployment finished. Increasing the memory limit or changing app code is not a substitute for a supported CPU.

## Share previews and optional ContextVM

Deployment sets `SPACE_SITE_ORIGIN=https://<domain>` for canonical and OG URLs and disables `publicdev`. Public dev caches remain outside the archive. The native resvg renderer and its bundled DM Sans font are installed/built for the VPS architecture with the rest of the locked dependencies.

The separate `infra/cvm.ecosystem.config.cjs` can run the ContextVM starter under PM2 with explicit relay URLs and a persistent key path. Automated activation of that optional service and provisioning its relay remain part of the next operator-services slice; the web deployment does not silently start or announce it.
