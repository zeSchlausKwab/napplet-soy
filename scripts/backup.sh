#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run this backup as root.' >&2; exit 1; }
exec 9>/var/lock/napplet-space-deploy.lock
flock -n 9 || { echo 'A deployment or backup is already running.' >&2; exit 1; }
app_root=/opt/napplet-space
state_root=/var/lib/napplet-space
backup_root=/var/backups/napplet-space
release=$(readlink -f "$app_root/current")
[[ -f "$release/scripts/backup-data.py" ]] || exit 1
pm2_bin="$app_root/tools/node_modules/pm2/bin/pm2"
[[ -f "$pm2_bin" ]] || { echo 'PM2 installation not found.' >&2; exit 1; }
pm2_run() { runuser -u napplet -- env PM2_HOME="$state_root/pm2" node "$pm2_bin" "$@"; }
install -d -m 700 "$backup_root"
work=$(mktemp -d "$backup_root/.snapshot-XXXXXXXX")
stopped=0
cvm_systemd=0
if [[ -f "$release/dynamic-backends-enabled" ]] || systemctl is-active --quiet napplet-cvm.service; then
  cvm_systemd=1
fi
apps=(napplet-relay napplet-blossom napplet-grasp napplet-indexer napplet-web)
[[ "$cvm_systemd" == 1 ]] || apps+=(napplet-cvm)
restart_apps() {
  pm2_run restart "${apps[@]}"
  [[ "$cvm_systemd" != 1 ]] || systemctl start napplet-cvm.service
}
recover() {
  code=$?
  trap - EXIT
  if [[ "$stopped" == 1 ]]; then restart_apps || code=1; fi
  rm -rf "$work"
  exit "$code"
}
trap recover EXIT
# Quiesce only this installation. Caddy and other sites keep running.
stopped=1
# Stop CVM first: drain bounded calls/builds and checkpoint SQLite before copying.
[[ "$cvm_systemd" != 1 ]] || systemctl stop napplet-cvm.service
pm2_run stop "${apps[@]}"
python3 "$release/scripts/backup-data.py" snapshot --state "$state_root" --shared "$app_root/shared" --destination "$work/snapshot" --release "$(basename "$release")"
restart_apps
stopped=0
name="napplet-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
python3 "$release/scripts/backup-data.py" pack --snapshot "$work/snapshot" --archive "$work/$name"
python3 "$release/scripts/backup-data.py" verify --archive "$work/$name"
mv "$work/$name" "$work/$name.sha256" "$backup_root/"
# Retain fourteen successful daily archives; incomplete staging directories never count.
python3 - "$backup_root" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
for archive in sorted(root.glob('napplet-????????T??????Z.tar.gz'), reverse=True)[14:]:
    archive.unlink()
    archive.with_name(archive.name+'.sha256').unlink(missing_ok=True)
PY
printf 'Verified backup: %s/%s\n' "$backup_root" "$name"
