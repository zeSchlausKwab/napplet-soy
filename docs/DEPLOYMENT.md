# VPS deployment with Caddy and PM2

Status: initial implementation, 2026-09-11. The user requested a simple deploy script including Caddy and PM2. Local production builds can exercise the same Bun server, PM2 ecosystem configuration, and Caddy version. A remote VPS deployment has not been performed.

## One command

```sh
bun run deploy --host root@your-vps --domain napplet.example
```

Use a dedicated Debian/Ubuntu host with systemd, x86_64 or arm64, DNS pointing to it, and inbound TCP 80/443 available. An SSH config alias works for `--host`, including its key/port settings. The SSH account must be root or have passwordless sudo. This script installs system dependencies and dedicated systemd services; it is not intended to silently replace another site's proxy on a shared VPS.

The command runs local checks, uploads an allowlisted archive of the working source tree, and invokes [deploy-remote.sh](../scripts/deploy-remote.sh). Uncommitted source changes are included; `.git`, dependencies, builds, local state, and `.env` files are excluded. The remote build uses `bun.lock` and does not reuse macOS native dependencies on Linux.

## Installed layout and service ownership

| Location | Purpose |
| --- | --- |
| `/opt/napplet-space/releases/<id>` | Source and production build for one release |
| `/opt/napplet-space/current` | Active release symlink |
| `/opt/napplet-space/bin` | Bun 1.3.11 and Caddy 2.10.2, verified against upstream checksums |
| `/opt/napplet-space/tools` | PM2 7.0.4 and its dependencies |
| `/opt/napplet-space/shared/server.env` | Optional operator-maintained runtime/public build configuration; never uploaded |
| `/var/lib/napplet-space/pm2` | Dedicated PM2 process list, logs, and PID state |
| `/var/lib/napplet-space/caddy` | Caddy certificate/account data |
| `/etc/napplet-space/Caddyfile` | This site's HTTPS/reverse-proxy configuration |

The `napplet` system account runs the application and Caddy. Bun listens on loopback port 3000. PM2 uses fork mode with one Bun process; Node is used to run PM2 itself. systemd units `napplet-space` and `napplet-space-caddy` persist the services across reboots. Caddy receives only the capability needed to bind low ports. Existing global PM2 state is not used.

## Activation and recovery

1. Take an exclusive deployment lock.
2. Install missing pinned tools, extract into a new release directory, install locked dependencies, typecheck/test, and build.
3. Start the candidate on port 3101 and verify `/api/health` reports the expected release ID.
4. Validate the proposed Caddy configuration.
5. Switch the active symlink, restart/reload the dedicated PM2 application, and verify the release ID on port 3000.
6. Save PM2 state and activate the Caddy configuration and reboot services.

The single Bun process may have a brief interruption during activation. This does not promise zero-downtime deployment. On activation failure, the error handler returns the active symlink and PM2 process to the previous release where available, and restores the prior Caddy configuration if it was changed. Candidate build failures leave the current process alone. Old releases remain on disk for inspection; automated retention is deferred.

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

The initial deploy scope is the web/runtime/CLI foundation. GRASP, Blossom, the relay, database, and index/preview workers have not been provisioned or tested. Add their shared local/production definitions during the next publishing slice. Docker's daemon was unavailable in the implementation environment, so no container integration is claimed.

## Share previews and optional ContextVM

Deployment sets `SPACE_SITE_ORIGIN=https://<domain>` for canonical and OG URLs and disables `publicdev`. Public dev caches remain outside the archive. The native resvg renderer and its bundled DM Sans font are installed/built for the VPS architecture with the rest of the locked dependencies.

The separate `infra/cvm.ecosystem.config.cjs` can run the ContextVM starter under PM2 with explicit relay URLs and a persistent key path. Automated activation of that optional service and provisioning its relay remain part of the next operator-services slice; the web deployment does not silently start or announce it.
