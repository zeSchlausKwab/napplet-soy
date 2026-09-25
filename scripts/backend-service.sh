#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Configure the CVM service as root.' >&2; exit 1; }
release=$1
bun_bin=$2
[[ "$release" == /opt/napplet-space/releases/* && -x "$bun_bin" ]] || exit 1
# Only this narrow configuration crosses into the CVM; never the whole server.env.
python3 - /opt/napplet-space/shared/cvm.env "$release" <<'PY'
import os,sys
fields=['SPACE_CVM_KEY_PATH','SPACE_CVM_DATA_PATH','SPACE_CVM_RELAYS','SPACE_CVM_PUBLIC_RELAYS','SPACE_CVM_ANNOUNCE','SPACE_CVM_MAX_PEERS','SPACE_TURN_URLS','SPACE_TURN_SECRET_PATH','SPACE_TURN_RELAY_ONLY','SPACE_DYNAMIC_CREATORS','SPACE_DYNAMIC_SOURCE_ORIGINS','SPACE_MODERATION_FILE']
values={key:os.environ.get(key,'') for key in fields}
values.update(SPACE_DYNAMIC_ENABLED='1',SPACE_DYNAMIC_BUNDLE_DIR=sys.argv[2]+'/bin/backend-workers')
with open(sys.argv[1],'w') as f:
    for key,value in values.items():
        if any(ord(c)<32 for c in value): raise SystemExit('Invalid CVM configuration: '+key)
        f.write(key+'="'+value.replace('\\','\\\\').replace('"','\\"')+'"\n')
os.chmod(sys.argv[1],0o600)
PY
cat > /etc/systemd/system/napplet-cvm.service <<UNIT
[Unit]
Description=Napplet CVM with bounded offline backend workers
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=napplet
Group=napplet
WorkingDirectory=$release
EnvironmentFile=/opt/napplet-space/shared/cvm.env
ExecStart=$bun_bin --no-env-file $release/apps/cvm/src/index.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=45
KillMode=control-group
Delegate=cpu memory pids
DelegateSubgroup=supervisor
OOMPolicy=continue
MemoryMax=1G
MemorySwapMax=0
TasksMax=128
CPUQuota=200%
LimitCORE=0
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/napplet-space/cvm /sys/fs/cgroup/system.slice/napplet-cvm.service
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable napplet-cvm.service
systemctl restart napplet-cvm.service
