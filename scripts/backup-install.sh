#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || exit 1
install -d -m 700 /var/backups/napplet-space
cat > /etc/systemd/system/napplet-space-backup.service <<'UNIT'
[Unit]
Description=Verified Napplet state backup
After=network.target
[Service]
Type=oneshot
UMask=0077
ExecStart=/bin/bash /opt/napplet-space/current/scripts/backup.sh
TimeoutStartSec=30min
UNIT
cat > /etc/systemd/system/napplet-space-backup.timer <<'UNIT'
[Unit]
Description=Daily Napplet state backup
[Timer]
OnCalendar=*-*-* 03:15:00 UTC
RandomizedDelaySec=15min
Unit=napplet-space-backup.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now napplet-space-backup.timer
