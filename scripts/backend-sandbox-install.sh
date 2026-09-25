#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Install backend sandbox prerequisites as root.' >&2; exit 1; }
apt-get install -y bubblewrap
install -d -m 755 /opt/napplet-space/tools
# A dedicated, root-owned executable gives Ubuntu a narrow userns exception.
# Do not disable apparmor_restrict_unprivileged_userns globally.
install -o root -g root -m 755 /usr/bin/bwrap /opt/napplet-space/tools/soy-bwrap
if [[ -f /sys/module/apparmor/parameters/enabled ]] && grep -q Y /sys/module/apparmor/parameters/enabled; then
  cat > /etc/apparmor.d/napplet-bwrap <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
/opt/napplet-space/tools/soy-bwrap flags=(unconfined) {
  userns,
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/napplet-bwrap
fi
