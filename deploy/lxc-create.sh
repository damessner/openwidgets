#!/usr/bin/env bash
# deploy/lxc-create.sh — create an unprivileged Debian 12 LXC for OpenWidgets.
#
# RUNS ON THE PROXMOX VE HOST (as root), NOT inside the container.
# Idempotent in the sense that it refuses to touch an existing CT/VM id;
# re-running with the same --ctid fails loudly instead of overwriting.
#
# Examples:
#   ./lxc-create.sh --ctid 210 --ip 10.10.20.15/24 --gw 10.10.20.1
#   ./lxc-create.sh --ctid 211 --mode docker        # adds nesting=1,keyctl=1
#   ./lxc-create.sh --help
#
# After it finishes, copy the repo into the container and run
# deploy/provision.sh INSIDE it (the script prints the exact commands).

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_NAME="$(basename -- "$0")"
CTID="${CTID:-210}"
CT_HOSTNAME="${CT_HOSTNAME:-openwidgets}"
STORAGE="${STORAGE:-local-zfs}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-}"
DISK_GB="${DISK_GB:-16}"
CORES="${CORES:-2}"
MEMORY_MB="${MEMORY_MB:-2048}"
SWAP_MB="${SWAP_MB:-512}"
BRIDGE="${BRIDGE:-vmbr0}"
IP_CIDR="${IP_CIDR:-dhcp}"
GATEWAY="${GATEWAY:-}"
DNS_SERVER="${DNS_SERVER:-}"
MODE="${MODE:-native}"
SSH_KEY_FILE="${SSH_KEY_FILE:-}"
START_CT=1

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: lxc-create.sh [options]

Create an unprivileged Debian 12 LXC for OpenWidgets on a Proxmox VE host.

Required/identity:
  --ctid N              container id (default: 210)
  --hostname NAME       container hostname (default: openwidgets)
  --mode native|docker  deployment mode inside the CT (default: native).
                        docker adds features nesting=1,keyctl=1.
Network:
  --ip ADDR[/CIDR]|dhcp container IPv4 (default: dhcp)
  --gw ADDR             gateway (required for a static IP)
  --dns ADDR            nameserver inside the container
  --bridge NAME         bridge (default: vmbr0)
Resources/storage:
  --storage NAME        rootfs storage (default: local-zfs); must exist (pvesm status)
  --disk GB             rootfs size (default: 16)
  --cores N             default: 2
  --memory MB           default: 2048
  --swap MB             default: 512
  --template VOLID      existing template (default: newest debian-12 on --template-storage)
  --template-storage S  storage holding templates (default: local)
Access:
  --ssh-key FILE        public key file installed as root's authorized_keys
Other:
  --no-start            do not start the container
  --help                this text

Exit codes: 0 ok, 1 error (existing CT, bad storage, template download failure...).
EOF
}

while (($#)); do
  case "$1" in
    --ctid)              CTID="$2"; shift 2 ;;
    --hostname)          CT_HOSTNAME="$2"; shift 2 ;;
    --mode)              MODE="$2"; shift 2 ;;
    --ip)                IP_CIDR="$2"; shift 2 ;;
    --gw)                GATEWAY="$2"; shift 2 ;;
    --dns)               DNS_SERVER="$2"; shift 2 ;;
    --bridge)            BRIDGE="$2"; shift 2 ;;
    --storage)           STORAGE="$2"; shift 2 ;;
    --disk)              DISK_GB="$2"; shift 2 ;;
    --cores)             CORES="$2"; shift 2 ;;
    --memory)            MEMORY_MB="$2"; shift 2 ;;
    --swap)              SWAP_MB="$2"; shift 2 ;;
    --template)          TEMPLATE="$2"; shift 2 ;;
    --template-storage)  TEMPLATE_STORAGE="$2"; shift 2 ;;
    --ssh-key)           SSH_KEY_FILE="$2"; shift 2 ;;
    --no-start)          START_CT=0; shift ;;
    --help|-h)           usage; exit 0 ;;
    *)                   die "unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------- preflight
[[ ${EUID} -eq 0 ]] || die "run as root on the Proxmox VE host"
command -v pct    >/dev/null 2>&1 || die "pct not found — this script runs on Proxmox VE, not inside a container"
command -v pveam  >/dev/null 2>&1 || die "pveam not found — is this really a Proxmox VE host?"
command -v pvesm  >/dev/null 2>&1 || die "pvesm not found — is this really a Proxmox VE host?"

[[ "$CTID" =~ ^[0-9]+$ ]] || die "--ctid must be numeric"
[[ "$MODE" =~ ^(native|docker)$ ]] || die "--mode must be native or docker"
[[ "$DISK_GB" =~ ^[0-9]+$ ]] || die "--disk must be numeric"
[[ "$CORES" =~ ^[0-9]+$ ]] || die "--cores must be numeric"
[[ "$MEMORY_MB" =~ ^[0-9]+$ ]] || die "--memory must be numeric"

if [[ -e "/etc/pve/lxc/${CTID}.conf" || -e "/etc/pve/qemu-server/${CTID}.conf" ]]; then
  die "CT/VM id ${CTID} already exists — refusing to overwrite. Choose another --ctid."
fi

if ! pvesm status 2>/dev/null | awk -v s="$STORAGE" 'NR > 1 && $1 == s { found = 1 } END { exit found ? 0 : 1 }'; then
  die "storage '$STORAGE' is not available (check: pvesm status)"
fi

if [[ -n "$SSH_KEY_FILE" ]]; then
  [[ -r "$SSH_KEY_FILE" ]] || die "cannot read --ssh-key '$SSH_KEY_FILE'"
fi

# ------------------------------------------------------------------ template
if [[ -z "$TEMPLATE" ]]; then
  log "looking for an existing Debian 12 template on storage '$TEMPLATE_STORAGE'"
  TEMPLATE="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk '/debian-12/ {print $1}' | sort | tail -n 1 || true)"
fi

if [[ -z "$TEMPLATE" ]]; then
  log "no Debian 12 template found; downloading the newest one"
  pveam update >/dev/null 2>&1 || warn "pveam update failed (offline?) — trying anyway"
  local_avail="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep '^debian-12' | sort | tail -n 1 || true)"
  [[ -n "$local_avail" ]] || die "no debian-12 template available from pveam (check network/repos)"
  pveam download "$TEMPLATE_STORAGE" "$local_avail" >/dev/null 2>&1 \
    || die "failed to download template '$local_avail'"
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${local_avail}"
fi
log "using template: $TEMPLATE"

# ------------------------------------------------------------------- network
if [[ "$IP_CIDR" == "dhcp" ]]; then
  NET0="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  [[ -n "$GATEWAY" ]] || die "--gw is required when --ip is a static address"
  NET0="name=eth0,bridge=${BRIDGE},ip=${IP_CIDR},gw=${GATEWAY}"
fi

# ------------------------------------------------------------------ features
FEATURES=""
if [[ "$MODE" == "docker" ]]; then
  FEATURES="nesting=1,keyctl=1"
  log "docker mode: enabling features nesting=1,keyctl=1 (needed for dockerd inside LXC)"
fi

# --------------------------------------------------------------------- create
CREATE_ARGS=(
  "$CTID" "$TEMPLATE"
  --hostname "$CT_HOSTNAME"
  --unprivileged 1
  --cores "$CORES"
  --memory "$MEMORY_MB"
  --swap "$SWAP_MB"
  --rootfs "${STORAGE}:${DISK_GB}"
  --net0 "$NET0"
  --onboot 1
  --description "OpenWidgets — self-hosted interactive worksheets (BookWidgets alternative). Mode: ${MODE}. Created: $(date -Iseconds)"
)
[[ -n "$FEATURES" ]] && CREATE_ARGS+=(--features "$FEATURES")
[[ -n "$DNS_SERVER" ]] && CREATE_ARGS+=(--nameserver "$DNS_SERVER")
[[ -n "$SSH_KEY_FILE" ]] && CREATE_ARGS+=(--ssh-public-keys "$SSH_KEY_FILE")

log "creating unprivileged container ${CTID} (${CORES} vCPU, ${MEMORY_MB} MB RAM, ${DISK_GB} GB)"
pct create "${CREATE_ARGS[@]}"

if (( START_CT == 1 )); then
  log "starting container ${CTID}"
  pct start "$CTID"
  ready=0
  for _ in $(seq 1 60); do
    if pct exec "$CTID" -- true >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  (( ready == 1 )) || die "container ${CTID} did not become reachable via pct exec — check 'pct status ${CTID}' and the task log"

  # Time zone matters: exam deadlines are server-computed in UTC and shown in
  # Europe/Vienna. A wrong server clock silently breaks time limits.
  log "setting timezone Europe/Vienna and enabling NTP if available"
  pct exec "$CTID" -- bash -lc 'timedatectl set-timezone Europe/Vienna 2>/dev/null || true; timedatectl set-ntp true 2>/dev/null || true'
fi

# -------------------------------------------------------------------- summary
IP_SHOWN="$IP_CIDR"
[[ "$IP_SHOWN" == "dhcp" ]] && IP_SHOWN="<dhcp address — set a reservation!>"

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
Container ${CTID} (${CT_HOSTNAME}) created — mode: ${MODE}
  resources : ${CORES} vCPU / ${MEMORY_MB} MB RAM / ${SWAP_MB} MB swap / ${DISK_GB} GB rootfs (${STORAGE})
  network   : ${NET0}
  features  : ${FEATURES:-none (native systemd path; add nesting only if needed)}
  address   : ${IP_SHOWN}

NEXT STEPS (on this Proxmox host):

  1) Copy the repository into the container (from the repo root):
       tar czf /tmp/openwidgets.tgz --exclude=.git --exclude=tools/e2e/node_modules .
       pct push ${CTID} /tmp/openwidgets.tgz /root/openwidgets.tgz
       pct exec ${CTID} -- bash -lc 'mkdir -p /opt/openwidgets-src && tar xzf /root/openwidgets.tgz -C /opt/openwidgets-src'

     (or, if the container has network access to your git server:)
       pct exec ${CTID} -- bash -lc 'apt-get update && apt-get install -y git'
       pct exec ${CTID} -- bash -lc 'git clone <repo-url> /opt/openwidgets-src'

  2) Provision inside the container:
       pct exec ${CTID} -- bash -lc 'bash /opt/openwidgets-src/deploy/provision.sh \\
         --mode ${MODE} \\
         --domain widgets.<school-domain> \\
         --admin-email admin@<school-domain>'

  3) Point DNS (widgets.<school-domain>) at the container and allow TCP 443
     from the pupil VLAN. Then test from a pupil device, not from the host.

  4) Schedule backups: see docs/DEPLOY-LXC.md §8 (backup.sh + off-site copy).
  5) Proxmox vzdump of CT ${CTID} is a useful second line of defence, not a
     replacement for the SQLite-consistent backup in step 4.
──────────────────────────────────────────────────────────────────────────────
EOF
