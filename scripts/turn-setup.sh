#!/usr/bin/env bash
set -Eeuo pipefail
# Dedicated service/config: never replaces an existing site's coturn configuration.
domain=${1:?domain}
state=${2:?state directory}
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ ]] || exit 2
[[ $EUID == 0 && "$state" == /var/lib/napplet-space ]] || exit 2
if ! systemctl is-active --quiet napplet-turn; then
  if [[ -n "$(ss -H -lntu 'sport = :3478')" ]]; then
    echo 'TURN port 3478 is already in use. Configure an external provider in shared/server.env with SPACE_MANAGED_TURN=0.' >&2
    exit 1
  fi
fi
if ! command -v turnserver >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
  # Debian may enable its default empty configuration on installation.
  systemctl disable --now coturn
fi
install -d -o napplet -g napplet -m 700 "$state/cvm"
if [[ ! -f "$state/cvm/turn-secret" ]]; then
  (umask 077; openssl rand -hex 32 > "$state/cvm/turn-secret")
  chown napplet:napplet "$state/cvm/turn-secret"
fi
secret=$(cat "$state/cvm/turn-secret")
[[ "$secret" =~ ^[a-f0-9]{64}$ ]] || exit 2
install -d -o root -g turnserver -m 750 /etc/napplet-turn
umask 077
cat > /etc/napplet-turn/turnserver.conf.next <<TURN
listening-port=3478
listening-ip=0.0.0.0
min-port=49160
max-port=49200
realm=$domain
server-name=$domain
fingerprint
use-auth-secret
static-auth-secret=$secret
stale-nonce=600
max-allocate-lifetime=600
total-quota=128
user-quota=8
max-bps=262144
bps-capacity=8388608
no-cli
no-tls
no-dtls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
pidfile=/run/napplet-turn/turnserver.pid
TURN
if [[ -n "${SPACE_TURN_EXTERNAL_IP:-}" ]]; then
  [[ "$SPACE_TURN_EXTERNAL_IP" =~ ^[0-9./]+$ ]] || exit 2
  printf 'external-ip=%s\n' "$SPACE_TURN_EXTERNAL_IP" >> /etc/napplet-turn/turnserver.conf.next
fi
chown root:turnserver /etc/napplet-turn/turnserver.conf.next
chmod 640 /etc/napplet-turn/turnserver.conf.next
changed=1
if cmp -s /etc/napplet-turn/turnserver.conf.next /etc/napplet-turn/turnserver.conf; then changed=0; fi
mv /etc/napplet-turn/turnserver.conf.next /etc/napplet-turn/turnserver.conf
cat > /etc/systemd/system/napplet-turn.service <<'UNIT'
[Unit]
Description=Napplet TURN connectivity
After=network-online.target
Wants=network-online.target
[Service]
User=turnserver
Group=turnserver
ExecStart=/usr/bin/turnserver -c /etc/napplet-turn/turnserver.conf
RuntimeDirectory=napplet-turn
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=256M
TasksMax=128
LimitNOFILE=4096
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable napplet-turn
if [[ "$changed" == 1 ]]; then systemctl restart napplet-turn; else systemctl start napplet-turn; fi
systemctl is-active --quiet napplet-turn
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 3478/udp comment 'Napplet TURN'
  ufw allow 3478/tcp comment 'Napplet TURN'
  ufw allow 49160:49200/udp comment 'Napplet TURN relay'
fi
echo 'TURN configured. Upstream firewalls must also allow TCP/UDP 3478 and UDP 49160–49200.'
