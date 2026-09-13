# VPS deployment with Caddy and PM2

Updated 2026-09-13. The user requested a simple deploy script including Caddy and PM2. Local production builds exercise the same web, relay, Blossom and GRASP implementations, PM2 definitions, and Caddy version. A remote VPS deployment has not been performed.

## One command

```sh
bun run deploy --host root@your-vps --domain napplet.example
```

Use a dedicated Debian/Ubuntu host with systemd, x86_64 or arm64, DNS pointing to it, and inbound TCP 80/443 available. All three hostnames—`napplet.example`, `blossom.napplet.example`, and `git.napplet.example`—must resolve to the VPS. Override the service names with `--blossom-domain files.example` and `--git-domain source.example`; all three must be different. An SSH config alias works for `--host`, including its key/port settings. The SSH account must be root or have passwordless sudo. This script installs system dependencies and dedicated systemd services; it is not intended to silently replace another site's proxy on a shared VPS.

The command runs local checks, uploads an allowlisted archive of the working source tree, and invokes [deploy-remote.sh](../scripts/deploy-remote.sh). Uncommitted source changes are included; `.git`, dependencies, builds, local state, and `.env` files are excluded. The remote build uses `bun.lock` and does not reuse macOS native dependencies on Linux.

## Installed layout and service ownership

| Location | Purpose |
| --- | --- |
| `/opt/napplet-space/releases/<id>` | Source and production build for one release |
| `/opt/napplet-space/current` | Active release symlink |
| `/opt/napplet-space/bin` | Bun 1.3.11 and Caddy 2.10.2, verified against upstream checksums |
| `/opt/napplet-space/tools` | PM2 7.0.4 and checksum-pinned Go 1.25.0 and Rust 1.97.1 |
| `/var/lib/napplet-space/relay` | Durable signed relay events and rebuildable Bleve index |
| `/var/lib/napplet-space/blossom` | Content-addressed blob bytes and SQLite descriptors/ownership |
| `/var/lib/napplet-space/grasp` | Git objects, repository relay LMDB, private operator identity and migration state |
| `/var/lib/napplet-space/index` | SQLite website projections, cursors/deletions, verified artifacts and normalized previews |
| `/opt/napplet-space/shared/server.env` | Optional operator-maintained runtime/public build configuration; never uploaded |
| `/var/lib/napplet-space/pm2` | Dedicated PM2 process list, logs, and PID state |
| `/var/lib/napplet-space/caddy` | Caddy certificate/account data |
| `/etc/napplet-space/Caddyfile` | This site's HTTPS/reverse-proxy configuration |

The `napplet` system account runs the application and Caddy. The web server listens on loopback port 3000; the native Khatru relay listens on loopback 19347 and Caddy exposes it at `wss://<domain>/relay`. A separate Bun Blossom process listens on loopback 19348; Caddy exposes its root endpoints at `https://<blossom-domain>`. Native ngit-grasp listens on loopback 19349; Caddy exposes both its repository relay and Git smart HTTP endpoints at `https://<git-domain>`. Git HTTP bodies and receive-pack input are limited to 50 MiB; this does not bound total disk use. Public `/metrics` access is blocked. PM2 uses one fork process per service; Node runs PM2 itself and the short-lived linked-preview metadata worker when a catalog refresh contains supported app references. The ordinary deployed profile still disables publicdev imports. systemd units `napplet-space` and `napplet-space-caddy` persist the services across reboots. Caddy receives only the capability needed to bind low ports. Existing global PM2 state is not used.

## Activation and recovery

1. Take an exclusive deployment lock.
2. Install missing pinned tools, extract into a new release directory, install locked dependencies, typecheck/test, run Go race, relay/Blossom/GRASP process tests, and build web, relay, Blossom and GRASP. The GRASP build uses the pinned standalone Rust distribution and system Git/OpenSSL, with four Cargo build jobs. Allow several GiB of disk for toolchains and per-release build caches.
3. Start the candidate on port 3101 and verify `/api/health` reports the expected release ID.
4. Validate the proposed Caddy configuration.
5. Switch the active symlink, recreate the dedicated PM2 services, and verify relay/Blossom/GRASP build fingerprints and the web release ID on port 3000.
6. Save PM2 state and activate the Caddy configuration and reboot services.

Services may have a brief interruption during activation. This does not promise zero-downtime deployment. On activation failure, the error handler returns the active symlink and PM2 web/relay/Blossom/GRASP processes to the previous release where available, and restores the prior Caddy configuration if it was changed. Persistent relay, blob and Git data stay outside release directories. Code rollback does not roll back data. A persistent `grasp/upstream.commit` guard rejects automatic upstream GRASP pin changes, including downgrades. Rehearse a separate full-state migration/restore procedure before changing this guard; see [GRASP operations](GRASP.md). Candidate build failures leave the current processes alone. Old releases remain on disk for inspection; automated retention is deferred.

First-deploy HTTPS issuance depends on public DNS and network reachability. The script validates configuration and checks local application health; it does not certify external DNS, certificate issuance, reboot recovery, or provider firewalls. No firewall or DNS records are modified automatically.

## Operator commands

```sh
sudo systemctl status napplet-space-caddy
sudo journalctl -u napplet-space-caddy -n 100
sudo -u napplet env PM2_HOME=/var/lib/napplet-space/pm2 \
  node /opt/napplet-space/tools/node_modules/pm2/bin/pm2 list
```

Protect `shared/server.env` as operator configuration. It is sourced by the deploy script; only administrators should be able to edit it. Values beginning with `VITE_` are compiled into the browser and must be public. Set `VITE_NOSTR_RELAYS` explicitly; there are no default public relays. The web server has no creator private keys. The separate ContextVM starter stores its service key outside source; see [CONTEXTVM.md](CONTEXTVM.md).

## Local parity and remaining services

`bun run dev:prod` uses the same PM2 ecosystem and Bun production entry as the VPS deployment and a checksum-verified Caddy 2.10.2. Its PM2 state and downloaded tools stay under `.local`. Default local HTTP avoids changing the OS trust store; local HTTPS can use Caddy's internal CA, which needs separate trust setup. Local PM2 starts both app and proxy; on the VPS systemd owns Caddy and PM2 owns Bun. The same actual server implementations handle requests in both environments.

Deployment includes the [managed relay](RELAY.md), [Blossom storage](BLOSSOM.md), [GRASP source hosting](GRASP.md), and [persistent index/preview worker](INDEXING.md), using the same implementations and PM2 definitions as local development. All start with no fixtures. The index reads the managed relay internally and advertises its public WSS address; configure additional `SPACE_INDEX_RELAYS` and `SPACE_INDEX_HINTS` in `shared/server.env`. The worker's release heartbeat is checked during activation and its process is included in rollback. Services run natively. VPS execution and reboot recovery for this slice have not been tested.

## Share previews and optional ContextVM

Deployment sets `SPACE_SITE_ORIGIN=https://<domain>` for canonical and OG URLs and disables `publicdev`. Public dev caches remain outside the archive. The native resvg renderer and its bundled DM Sans font are installed/built for the VPS architecture with the rest of the locked dependencies.

The separate `infra/cvm.ecosystem.config.cjs` can run the ContextVM starter under PM2 with explicit relay URLs and a persistent key path. Automated activation of that optional service and provisioning its relay remain part of the next operator-services slice; the web deployment does not silently start or announce it.
