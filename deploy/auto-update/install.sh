#!/bin/bash
# install.sh — install the OpenWidgets GitHub auto-updater on a host that runs
# the app from a tarball deploy (VM or LXC). Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/damessner/openwidgets/main/deploy/auto-update/install.sh | bash
#
# Inside a Proxmox LXC from the host:
#   pct exec <vmid> -- bash -c "curl -fsSL https://raw.githubusercontent.com/damessner/openwidgets/main/deploy/auto-update/install.sh | bash"
#
# What it installs:
#   /usr/local/sbin/openwidgets-update          the updater script
#   /etc/systemd/system/openwidgets-update.service   oneshot runner
#   /etc/systemd/system/openwidgets-update.timer     every 10 min + 3 min after boot
#   /etc/openwidgets/update.env                 config (repo, branch, paths)
set -euo pipefail

REPO="${OW_REPO:-damessner/openwidgets}"
BRANCH="${OW_BRANCH:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}/deploy/auto-update"

echo "[install] fetching updater files from ${RAW}"
tmp="$(mktemp -d)"
fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --max-time 60 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q --timeout=60 -O "$2" "$1"
  else echo "[install] need curl or wget" >&2; exit 1; fi
}
fetch "$RAW/openwidgets-update.sh" "$tmp/openwidgets-update.sh"
fetch "$RAW/openwidgets-update.service" "$tmp/openwidgets-update.service"
fetch "$RAW/openwidgets-update.timer" "$tmp/openwidgets-update.timer"

install -m 0755 "$tmp/openwidgets-update.sh" /usr/local/sbin/openwidgets-update
install -m 0644 "$tmp/openwidgets-update.service" /etc/systemd/system/openwidgets-update.service
install -m 0644 "$tmp/openwidgets-update.timer" /etc/systemd/system/openwidgets-update.timer
rm -rf "$tmp"

mkdir -p /etc/openwidgets
ENV_FILE=/etc/openwidgets/update.env
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
if ! grep -q '^OW_REPO=' "$ENV_FILE"; then
  cat >> "$ENV_FILE" <<EOF
# OpenWidgets auto-update configuration (sourced by openwidgets-update)
OW_REPO=${REPO}
OW_BRANCH=${BRANCH}
OW_APP_DIR=/opt/openwidgets
OW_SERVICE=openwidgets
OW_STATE_FILE=/var/lib/openwidgets/.deployed-sha
OW_BACKUP_DIR=/var/backups/openwidgets
OW_HEALTH_PORT=3000
EOF
fi

systemctl daemon-reload
systemctl enable openwidgets-update.timer
systemctl restart openwidgets-update.timer
echo "[install] timer enabled; running one update pass now"
systemctl start openwidgets-update.service || true
systemctl list-timers openwidgets-update.timer --no-pager || true
echo "[install] done. Logs: journalctl -u openwidgets-update.service -f"
