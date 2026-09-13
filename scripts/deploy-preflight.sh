#!/usr/bin/env bash
set -euo pipefail

# Read-only inventory before deciding how to share a VPS. Deliberately excludes
# environment values, credentials, app source, certificates and private keys.
printf 'Operating system: '
if [[ -r /etc/os-release ]]; then
  awk -F= '$1=="PRETTY_NAME" {gsub(/"/,"",$2);print $2}' /etc/os-release
else uname -s; fi
printf 'Architecture: '; uname -m
printf 'Login: '; id
printf '\nCapacity\n'
getconf _NPROCESSORS_ONLN
free -m || true
df -h / /tmp
printf '\nListening TCP ports\n'
ss -ltnp || true
printf '\nRelevant systemd services\n'
systemctl list-units --type=service --all --no-pager --plain \
  | awk '/caddy|nginx|apache|docker|containerd|pm2|napplet/ {print}' || true
printf '\nProxy service definitions (paths only)\n'
for service in caddy caddy-api nginx napplet-space-caddy; do
  systemctl show "$service" --property=LoadState,ActiveState,FragmentPath,User,Group --no-pager 2>/dev/null || true
done
printf '\nAvailable proxy binaries\n'
for binary in caddy nginx docker podman; do command -v "$binary" || true; done
if command -v caddy >/dev/null; then caddy version; fi
printf '\nExisting installation paths\n'
for item in /etc/caddy/Caddyfile /etc/nginx/nginx.conf /etc/napplet-space /opt/napplet-space /var/lib/napplet-space; do
  if [[ -e "$item" ]]; then ls -ld "$item"; fi
done
if command -v docker >/dev/null; then
  printf '\nContainers (names, images and exposed ports only)\n'
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || true
fi
