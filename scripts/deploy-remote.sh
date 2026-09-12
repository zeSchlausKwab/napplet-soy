#!/usr/bin/env bash
set -Eeuo pipefail

# Dedicated Debian/Ubuntu VPS. All app state is scoped to this installation.
release_id=${1:?release id required}
domain=${2:?domain required}
[[ "$release_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ ]] || exit 2
[[ $EUID -eq 0 ]] || { echo 'Root or passwordless sudo is required.' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'This script supports Debian/Ubuntu VPS hosts.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'A running systemd host is required.' >&2; exit 1; }
exec 9>/var/lock/napplet-space-deploy.lock
flock -n 9 || { echo 'Another napplet deployment is running.' >&2; exit 1; }

app_root=/opt/napplet-space
state_root=/var/lib/napplet-space
release_dir="$app_root/releases/$release_id"
archive="/tmp/napplet-$release_id.tar.gz"
bun_version=1.3.11
caddy_version=2.10.2
pm2_version=7.0.4
go_version=1.25.0
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip tar xz-utils nodejs npm build-essential git
id napplet >/dev/null 2>&1 || useradd --system --create-home --home-dir "$state_root" --shell /usr/sbin/nologin napplet
install -d -m 755 "$app_root/bin" "$app_root/tools" "$app_root/releases" "$app_root/shared" /etc/napplet-space
install -d -o napplet -g napplet -m 750 "$state_root/pm2" "$state_root/caddy" "$state_root/relay"

case "$(uname -m)" in
  x86_64) bun_asset=bun-linux-x64-baseline.zip; caddy_arch=amd64; go_sha=2852af0cb20a13139b3448992e69b868e50ed0f8a1e5940ee1de9e19a123b613 ;;
  aarch64|arm64) bun_asset=bun-linux-aarch64.zip; caddy_arch=arm64; go_sha=05de75d6994a2783699815ee553bd5a9327d8b79991de36e38b66862782f54ae ;;
  *) echo 'Supported VPS architectures: x86_64 and arm64.' >&2; exit 1 ;;
esac
tool_staging=$(mktemp -d)
trap 'rm -rf "$tool_staging"' EXIT
if [[ ! -x "$app_root/bin/bun" ]] || [[ "$("$app_root/bin/bun" --version)" != "$bun_version" ]]; then
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/$bun_asset" -o "$tool_staging/$bun_asset"
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/SHASUMS256.txt" -o "$tool_staging/bun-checksums"
  (cd "$tool_staging"; awk -v asset="$bun_asset" '$2 == asset {print}' bun-checksums > bun-selected; test -s bun-selected; sha256sum -c bun-selected; unzip -q "$bun_asset")
  install -m 755 "$tool_staging/${bun_asset%.zip}/bun" "$app_root/bin/bun"
fi
caddy_asset="caddy_${caddy_version}_linux_${caddy_arch}.tar.gz"
if [[ ! -x "$app_root/bin/caddy" ]] || [[ "$("$app_root/bin/caddy" version)" != "v$caddy_version "* ]]; then
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/$caddy_asset" -o "$tool_staging/$caddy_asset"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/caddy_${caddy_version}_checksums.txt" -o "$tool_staging/caddy-checksums"
  (cd "$tool_staging"; awk -v asset="$caddy_asset" '$2 == asset {print}' caddy-checksums > caddy-selected; test -s caddy-selected; sha512sum -c caddy-selected; tar -xzf "$caddy_asset" caddy)
  install -m 755 "$tool_staging/caddy" "$app_root/bin/caddy"
fi
# Native LMDB uses cgo. Keep the same verified toolchain as local builds.
go_root="$app_root/tools/go$go_version"
if [[ ! -x "$go_root/go/bin/go" ]] || [[ "$("$go_root/go/bin/go" version)" != "go version go$go_version "* ]]; then
  go_asset="go$go_version.linux-$caddy_arch.tar.gz"
  curl -fsSL "https://go.dev/dl/$go_asset" -o "$tool_staging/$go_asset"
  (cd "$tool_staging"; printf '%s  %s\n' "$go_sha" "$go_asset" | sha256sum -c -)
  install -d "$go_root"
  tar -xzf "$tool_staging/$go_asset" -C "$go_root"
fi
if [[ ! -f "$app_root/tools/node_modules/pm2/package.json" ]] || [[ "$(node -p "require('$app_root/tools/node_modules/pm2/package.json').version")" != "$pm2_version" ]]; then
  npm install --prefix "$app_root/tools" --no-audit --no-fund "pm2@$pm2_version"
fi
pm2_bin="$app_root/tools/node_modules/pm2/bin/pm2"
pm2_run() { runuser -u napplet -- env PM2_HOME="$state_root/pm2" PATH="$app_root/bin:/usr/bin:/bin" node "$pm2_bin" "$@"; }

[[ ! -e "$release_dir" ]] || { echo 'Release directory already exists.' >&2; exit 1; }
install -d -o napplet -g napplet "$release_dir"
tar -xzf "$archive" -C "$release_dir" --no-same-owner
rm "$archive"
chown -R napplet:napplet "$release_dir"
# Runtime secrets belong in shared/server.env, outside the uploaded repository.
# VITE_* values are public build configuration and must never contain credentials.
if [[ -f "$app_root/shared/server.env" ]]; then
  set -a
  source "$app_root/shared/server.env"
  set +a
fi
export PATH="$go_root/go/bin:$app_root/bin:/usr/bin:/bin"
export SPACE_SITE_ORIGIN="https://$domain"
export SPACE_PUBLICDEV=0 SPACE_PUBLICDEV_DIR=''
runuser -u napplet -- bash -ec 'cd "$1"; "$2" install --frozen-lockfile; "$2" run check; "$2" run test:relay; "$2" scripts/relay.ts build "$1/bin/napplet-relay"; "$2" run build' -- "$release_dir" "$app_root/bin/bun"

start_relay() {
  local source_release=$1
  runuser -u napplet -- env PM2_HOME="$state_root/pm2" SPACE_RELEASE_DIR="$source_release" SPACE_SERVICE_PREFIX=napplet SPACE_RELAY_BIND=127.0.0.1:19347 SPACE_RELAY_BIN="$source_release/bin/napplet-relay" SPACE_RELAY_DATA="$state_root/relay" SPACE_RELAY_ORIGIN="https://$domain/relay" SPACE_RELAY_INSTANCE="$domain" PATH="$PATH" node "$pm2_bin" start "$source_release/infra/relay.ecosystem.config.cjs" --update-env
}
relay_ready() {
  local expected
  expected=$(cat "$1/bin/napplet-relay.build")
  for attempt in {1..60}; do
    if curl -fsS --max-time 2 http://127.0.0.1:19347/health 2>/dev/null | grep -Fq "\"build\":\"$expected\""; then return 0; fi
    sleep 1
  done
  return 1
}

previous=$(readlink -f "$app_root/current" 2>/dev/null || true)
smoke_pid=''
activated=0
caddy_changed=0
had_caddy_config=0
[[ -f /etc/napplet-space/Caddyfile ]] && had_caddy_config=1
rollback() {
  result=$?
  trap - ERR
  [[ -z "$smoke_pid" ]] || { kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true; }
  if [[ "$caddy_changed" == 1 ]]; then
    if [[ "$had_caddy_config" == 1 ]]; then
      cp "$app_root/shared/Caddyfile.previous" /etc/napplet-space/Caddyfile
      systemctl reload napplet-space-caddy || true
    else
      systemctl stop napplet-space-caddy || true
      rm -f /etc/napplet-space/Caddyfile
    fi
  fi
  if [[ "$activated" == 1 ]]; then
    if [[ -n "$previous" ]]; then
      ln -sfn "$previous" "$app_root/current.rollback"
      mv -Tf "$app_root/current.rollback" "$app_root/current"
      pm2_run delete napplet-relay || true
      if [[ -f "$previous/infra/relay.ecosystem.config.cjs" ]]; then start_relay "$previous" || true; fi
      pm2_run delete napplet-web || true
      runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$app_root/bin/bun" SPACE_RELEASE_DIR="$previous" SPACE_RELEASE_ID="$(basename "$previous")" PATH="$PATH" node "$pm2_bin" start "$previous/infra/ecosystem.config.cjs" --update-env || true
    else
      pm2_run delete napplet-web || true
      pm2_run delete napplet-relay || true
      rm -f "$app_root/current"
    fi
    pm2_run save --force || true
  fi
  echo 'Deployment failed. Previous application/configuration was restored where available.' >&2
  exit "$result"
}
trap rollback ERR

# Test the new production build before touching the active process.
runuser -u napplet -- env NODE_ENV=production PORT=3101 HOST=127.0.0.1 SPACE_RELEASE_ID="$release_id" "$app_root/bin/bun" "$release_dir/apps/web/server.ts" > "$release_dir/smoke.log" 2>&1 &
smoke_pid=$!
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3101/api/health 2>/dev/null | grep -Fq "\"release\":\"$release_id\""; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
kill "$smoke_pid"
wait "$smoke_pid" 2>/dev/null || true
smoke_pid=''

cat > "$app_root/shared/Caddyfile.next" <<CADDY
$domain {
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
  @relay path /relay /relay/
  reverse_proxy @relay 127.0.0.1:19347
  reverse_proxy 127.0.0.1:3000
}
CADDY
"$app_root/bin/caddy" validate --config "$app_root/shared/Caddyfile.next" --adapter caddyfile
ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"
activated=1
pm2_run delete napplet-relay || true
start_relay "$release_dir"
relay_ready "$release_dir"
pm2_run delete napplet-web || true
runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$app_root/bin/bun" SPACE_RELEASE_DIR="$release_dir" SPACE_RELEASE_ID="$release_id" PATH="$PATH" node "$pm2_bin" start "$release_dir/infra/ecosystem.config.cjs" --update-env
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/api/health 2>/dev/null | grep -Fq "\"release\":\"$release_id\""; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
pm2_run save

cat > /etc/systemd/system/napplet-space.service <<UNIT
[Unit]
Description=napplet.space PM2 processes
After=network.target
[Service]
Type=forking
User=napplet
Environment=PM2_HOME=$state_root/pm2
Environment=PATH=$app_root/bin:/usr/bin:/bin
PIDFile=$state_root/pm2/pm2.pid
ExecStart=/usr/bin/node $pm2_bin resurrect
ExecStop=/usr/bin/node $pm2_bin kill
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/napplet-space-caddy.service <<UNIT
[Unit]
Description=napplet.space Caddy HTTPS proxy
After=network-online.target
Wants=network-online.target
[Service]
User=napplet
Group=napplet
Environment=HOME=$state_root
Environment=XDG_DATA_HOME=$state_root/caddy
ExecStart=$app_root/bin/caddy run --config /etc/napplet-space/Caddyfile --adapter caddyfile
ExecReload=$app_root/bin/caddy reload --config /etc/napplet-space/Caddyfile --adapter caddyfile
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
if [[ "$had_caddy_config" == 1 ]]; then cp /etc/napplet-space/Caddyfile "$app_root/shared/Caddyfile.previous"; fi
install -m 644 "$app_root/shared/Caddyfile.next" /etc/napplet-space/Caddyfile
caddy_changed=1
systemctl daemon-reload
systemctl enable napplet-space napplet-space-caddy
if systemctl is-active --quiet napplet-space-caddy; then systemctl reload napplet-space-caddy; else systemctl start napplet-space-caddy; fi
systemctl is-active --quiet napplet-space-caddy
trap - ERR
echo "Activated $release_id for https://$domain. Caddy will obtain a certificate when DNS resolves and ports 80/443 are reachable."
