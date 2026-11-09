#!/usr/bin/env bash
# deploy/provision.sh — provision OpenWidgets inside a Debian 12 LXC.
#
# Runs INSIDE the container (as root). Idempotent: re-running after a failure or
# a config change keeps existing secrets/data and only fixes what is missing.
# Supports two deployment modes:
#   native : systemd service + Caddy (recommended)
#   docker : Docker Compose + Caddy (requires LXC features nesting=1,keyctl=1)
#
# There is deliberately NO `npm install`: OpenWidgets has zero runtime
# dependencies (docs/CONTRACT.md §0). Node is only needed as the runtime.
#
# Examples:
#   bash deploy/provision.sh --mode native \
#     --domain widgets.ms-telfs.at --admin-email admin@ms-telfs.at
#
#   bash deploy/provision.sh --mode docker --domain widgets.ms-telfs.at \
#     --admin-email admin@ms-telfs.at --tls existing \
#     --cert /root/fullchain.pem --key /root/privkey.pem
#
# Options: see --help. Exit codes: 0 ok, 1 error (printed with context).

set -Eeuo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

MODE="native"
DOMAIN=""
ADMIN_EMAIL=""
ADMIN_NAME="Administrator"
ADMIN_PASSWORD=""
TLS_MODE="internal"
CERT_FILE=""
KEY_FILE=""
ACME_EMAIL=""
SRC_DIR="$REPO_ROOT"
APP_DIR="/opt/openwidgets"
DATA_DIR="/var/lib/openwidgets"
CONF_DIR="/etc/openwidgets"
REPO_URL=""
BRANCH=""
NO_CADDY=0
FORCE_ENV=0
SKIP_NODE=0
SKIP_OS=0

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { printf '\n[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
trap 'printf "\n[%s] provision failed near line %s (exit %s)\n" "$(date +%H:%M:%S)" "$LINENO" "$?" >&2' ERR

usage() {
  cat <<'EOF'
Usage: provision.sh [options]

Provision OpenWidgets inside a Debian 12 LXC (run as root).

Mode:
  --mode native|docker        deployment mode (default: native)
  --src DIR                   repo source to deploy from (default: this script's repo)
  --repo-url URL              git clone/pull instead of --src
  --branch NAME               git branch for --repo-url (default: clone default / main)
  --app-dir DIR               install path (default: /opt/openwidgets)
  --data-dir DIR              data path (default: /var/lib/openwidgets)

Web / TLS:
  --domain FQDN               public hostname for BASE_URL and Caddy (required unless --no-caddy)
  --no-caddy                  do not install/configure Caddy (app stays on 127.0.0.1:3000)
  --tls internal|existing|acme
                              internal = local Caddy CA (default, offline)
                              existing = use --cert/--key (e.g. school wildcard)
                              acme     = public Let's Encrypt HTTP-01/TLS-ALPN (needs public DNS)
  --cert FILE                 certificate chain for --tls existing
  --key FILE                  private key for --tls existing
  --acme-email EMAIL          ACME account e-mail for --tls acme

Admin seed (first boot only; existing users are never modified):
  --admin-email EMAIL         e-mail of the first admin
  --admin-name NAME           display name (default: Administrator)
  --admin-password PASSWORD   password (>= 10 chars); generated and printed if omitted
  --force-env                 overwrite /etc/openwidgets/openwidgets.env (WARNING: new secrets)

Other:
  --skip-node                 do not install Node (only if Node >= 24 is already present)
  --skip-os                   skip apt package installation (offline images)
  --help                      this text
EOF
}

while (($#)); do
  case "$1" in
    --mode)            MODE="$2"; shift 2 ;;
    --domain)          DOMAIN="$2"; shift 2 ;;
    --admin-email)     ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-name)      ADMIN_NAME="$2"; shift 2 ;;
    --admin-password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --tls)             TLS_MODE="$2"; shift 2 ;;
    --cert)            CERT_FILE="$2"; shift 2 ;;
    --key)             KEY_FILE="$2"; shift 2 ;;
    --acme-email)      ACME_EMAIL="$2"; shift 2 ;;
    --src)             SRC_DIR="$2"; shift 2 ;;
    --repo-url)        REPO_URL="$2"; shift 2 ;;
    --branch)          BRANCH="$2"; shift 2 ;;
    --app-dir)         APP_DIR="$2"; shift 2 ;;
    --data-dir)        DATA_DIR="$2"; shift 2 ;;
    --no-caddy)        NO_CADDY=1; shift ;;
    --force-env)       FORCE_ENV=1; shift ;;
    --skip-node)       SKIP_NODE=1; shift ;;
    --skip-os)         SKIP_OS=1; shift ;;
    --help|-h)         usage; exit 0 ;;
    *)                 die "unknown option: $1 (try --help)" ;;
  esac
done

# ------------------------------------------------------------------ preflight
[[ ${EUID} -eq 0 ]] || die "run as root inside the container"
[[ "$MODE" =~ ^(native|docker)$ ]] || die "--mode must be native or docker"
[[ "$TLS_MODE" =~ ^(internal|existing|acme)$ ]] || die "--tls must be internal, existing or acme"
command -v systemctl >/dev/null 2>&1 || die "systemd not available — is this a proper LXC template?"
[[ -f /etc/debian_version ]] || warn "this does not look like Debian — continuing, but the scripts target Debian 12"

if (( NO_CADDY == 0 )); then
  [[ -n "$DOMAIN" ]] || die "--domain is required (or pass --no-caddy)"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
    || die "--domain '$DOMAIN' does not look like a FQDN"
fi
if [[ "$TLS_MODE" == "existing" ]]; then
  [[ -r "$CERT_FILE" ]] || die "--tls existing requires --cert FILE"
  [[ -r "$KEY_FILE"  ]] || die "--tls existing requires --key FILE"
fi
if [[ "$TLS_MODE" == "acme" ]]; then
  [[ -n "$ACME_EMAIL" ]] || die "--tls acme requires --acme-email"
fi
if (( NO_CADDY == 0 )) && [[ "$TLS_MODE" == "acme" ]]; then
  warn "--tls acme: the domain must be publicly resolvable and TCP 80/443 reachable from the internet;"
  warn "otherwise Caddy cannot obtain a certificate. For DNS-01 you need a custom Caddy build (§6.2 of the docs)."
fi

log "OpenWidgets provisioning — mode=${MODE}, app=${APP_DIR}, data=${DATA_DIR}"

# ---------------------------------------------------------------- OS packages
install_os_packages() {
  log "installing base packages"
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git rsync sqlite3 openssl \
    debian-keyring debian-archive-keyring apt-transport-https
}

# ---------------------------------------------------------------------- Node
install_node() {
  if (( SKIP_NODE == 1 )); then
    log "--skip-node: not installing Node"
  fi
  local major=""
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  if [[ -n "$major" && "$major" -ge 24 ]]; then
    log "Node $(node -v) already present"
  else
    if (( SKIP_NODE == 1 )); then
      die "--skip-node given but Node >= 24 is not installed"
    fi
    log "installing Node.js 24.x from NodeSource (Debian 12 ships Node 18, which lacks node:sqlite)"
    tmp_script="$(mktemp)"
    curl -fsSL https://deb.nodesource.com/setup_24.x -o "$tmp_script" \
      || die "could not download the NodeSource setup script (no internet?)"
    # basic sanity check before running a downloaded script
    grep -q 'nodesource' "$tmp_script" || die "NodeSource setup script looks wrong — aborting"
    bash "$tmp_script"
    rm -f "$tmp_script"
    apt-get install -y nodejs
  fi

  command -v node >/dev/null 2>&1 || die "Node installation failed"
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 24 ]] || die "Node >= 24 required (node:sqlite); got $(node -v)"
  node -e 'import("node:sqlite").then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})' \
    || die "node:sqlite is not usable on this Node build ($(node -v))"
  if [[ ! -x /usr/bin/node ]]; then
    [[ -x /usr/local/bin/node ]] || die "node is installed but not at /usr/bin/node or /usr/local/bin/node — adjust ExecStart in the systemd unit"
    ln -sf /usr/local/bin/node /usr/bin/node
  fi
  log "Node OK: $(node -v)"
}

# ------------------------------------------------------------- users and dirs
create_user_and_dirs() {
  getent group openwidgets >/dev/null 2>&1 || groupadd --system openwidgets
  if ! id -u openwidgets >/dev/null 2>&1; then
    useradd --system --gid openwidgets --home-dir "$APP_DIR" \
      --shell /usr/sbin/nologin --no-create-home openwidgets
    log "created system user 'openwidgets'"
  fi
  install -d -o openwidgets -g openwidgets -m 0750 "$APP_DIR" "$DATA_DIR"
  install -d -o root -g openwidgets -m 0750 "$CONF_DIR"
  log "directories ready: $APP_DIR $DATA_DIR $CONF_DIR"
}

# ----------------------------------------------------------------- code deploy
deploy_code() {
  if [[ -n "$REPO_URL" ]]; then
    if [[ -d "$APP_DIR/.git" ]]; then
      log "updating git checkout in $APP_DIR"
      git -C "$APP_DIR" fetch --all --prune
      [[ -n "$BRANCH" ]] && git -C "$APP_DIR" checkout "$BRANCH"
      git -C "$APP_DIR" pull --ff-only
    else
      log "cloning $REPO_URL"
      if [[ -n "$BRANCH" ]]; then
        git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
      else
        git clone "$REPO_URL" "$APP_DIR"
      fi
    fi
  else
    [[ -f "$SRC_DIR/package.json" ]] || die "source dir '$SRC_DIR' does not look like the repo root (no package.json)"
    if [[ "$(cd "$SRC_DIR" && pwd -P)" != "$(cd "$APP_DIR" && pwd -P 2>/dev/null || echo /nonexistent)" ]]; then
      log "copying code from $SRC_DIR to $APP_DIR"
      rsync -a --delete \
        --exclude '.git' --exclude '.pnpm-store' --exclude 'data' --exclude 'data-*' \
        --exclude 'tools/e2e/node_modules' \
        "$SRC_DIR"/ "$APP_DIR"/
    else
      log "source and app dir are the same — skipping copy"
    fi
  fi
  [[ -f "$APP_DIR/server/index.js" ]] || die "deployed code is incomplete: $APP_DIR/server/index.js missing"
  chown -R openwidgets:openwidgets "$APP_DIR"
  log "code deployed to $APP_DIR"
}

# ------------------------------------------------------------------- env file
write_env_file() {
  local env_file="$CONF_DIR/openwidgets.env"
  local generated_password=0

  if [[ -f "$env_file" && $FORCE_ENV -eq 0 ]]; then
    log "keeping existing $env_file (use --force-env to regenerate)"
    # ensure permissions are sane even if the file was hand-edited
    chown root:openwidgets "$env_file" 2>/dev/null || true
    chmod 0600 "$env_file" 2>/dev/null || true
    return 0
  fi

  [[ -n "$ADMIN_EMAIL" ]] || die "--admin-email is required when the env file is created"
  [[ "$ADMIN_EMAIL" == *@*.* ]] || die "--admin-email does not look like an e-mail address"

  local pw="$ADMIN_PASSWORD"
  if [[ -z "$pw" ]]; then
    pw="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
    generated_password=1
  fi
  [[ ${#pw} -ge 10 ]] || die "admin password must be at least 10 characters (contract)"

  local base_url="http://localhost"
  if (( NO_CADDY == 0 )); then base_url="https://${DOMAIN}"; fi

  local tmp
  tmp="$(mktemp)"
  chmod 0600 "$tmp"
  cat >"$tmp" <<EOF
# OpenWidgets production configuration
# Generated by deploy/provision.sh on $(date -Is)
# Contract: docs/CONTRACT.md §2 — keep this file 0600 root:openwidgets.
# Values marked "first boot only" seed the initial admin when the DB is empty.
NODE_ENV=production
# Only Caddy (same host) may reach the app. Do NOT change to 0.0.0.0.
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=1
BASE_URL=${base_url}
DATA_DIR=${DATA_DIR}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${pw}
ADMIN_NAME=${ADMIN_NAME}
SESSION_TTL_DAYS=14
MAX_UPLOAD_MB=10
EOF
  install -m 0600 -o root -g openwidgets "$tmp" "$env_file"
  rm -f "$tmp"
  log "wrote $env_file"

  if (( generated_password == 1 )); then
    cat <<EOF

  ┌────────────────────────────────────────────────────────────────────┐
  │  SAVE THIS ADMIN PASSWORD — IT IS SHOWN ONLY ONCE                  │
  │                                                                    │
  │    e-mail  : ${ADMIN_EMAIL}
  │    password: ${pw}
  │                                                                    │
  │  Also stored in ${env_file} (0600).
  │  Change it at the first login and then remove ADMIN_PASSWORD there. │
  └────────────────────────────────────────────────────────────────────┘

EOF
  fi
}

# --------------------------------------------------------------------- Docker
install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker + Compose already installed ($(docker --version))"
  else
    log "installing Docker Engine + Compose plugin"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /tmp/docker.gpg \
      || die "could not download Docker GPG key (no internet?)"
    gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg /tmp/docker.gpg
    rm -f /tmp/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    local arch
    arch="$(dpkg --print-architecture)"
    cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable
EOF
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  # LXC check: docker inside an unprivileged LXC needs nesting=1,keyctl=1
  if ! docker info >/dev/null 2>&1; then
    systemctl enable --now docker 2>/dev/null || true
    sleep 2
    docker info >/dev/null 2>&1 || die "dockerd is not usable inside this container. Enable LXC features: pct set <ctid> --features nesting=1,keyctl=1 && pct reboot <ctid>"
  fi

  # Storage driver: overlay2 on ZFS-backed LXC hosts is a known failure mode.
  local fstype driver
  fstype="$(findmnt -n -o FSTYPE / 2>/dev/null || echo unknown)"
  driver="$(docker info --format '{{.Driver}}' 2>/dev/null || echo unknown)"
  log "root filesystem: ${fstype}; docker storage driver: ${driver}"
  if [[ "$fstype" == "zfs" && "$driver" != *fuse-overlayfs* && "$driver" != "vfs" ]]; then
    log "ZFS root detected — switching Docker to fuse-overlayfs (overlay2 is unreliable on ZFS-in-LXC)"
    apt-get install -y fuse-overlayfs
    install -d -m 0755 /etc/docker
    if [[ ! -f /etc/docker/daemon.json ]]; then
      cat >/etc/docker/daemon.json <<'EOF'
{
  "storage-driver": "fuse-overlayfs"
}
EOF
    else
      warn "/etc/docker/daemon.json already exists — NOT overwriting. Ensure it sets \"storage-driver\": \"fuse-overlayfs\"."
    fi
    systemctl restart docker
    sleep 2
    log "docker storage driver now: $(docker info --format '{{.Driver}}' 2>/dev/null || echo unknown)"
  fi

  # The image runs as uid 1000 (node); the bind-mounted host dir must match.
  chown -R 1000:1000 "$DATA_DIR"
}

# ---------------------------------------------------------------------- Caddy
install_caddy() {
  if (( NO_CADDY == 1 )); then
    warn "--no-caddy: skipping reverse proxy. The app is only reachable on 127.0.0.1:3000."
    return 0
  fi

  if command -v caddy >/dev/null 2>&1; then
    log "Caddy already installed: $(caddy version 2>/dev/null | head -n1)"
  else
    log "installing Caddy from the official repository"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
      || die "could not download Caddy signing key"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      >/etc/apt/sources.list.d/caddy-stable.list \
      || die "could not download Caddy apt repo definition"
    apt-get update -y
    apt-get install -y caddy
  fi
  command -v caddy >/dev/null 2>&1 || die "Caddy installation failed"

  install -d -m 0750 /etc/caddy
  printf 'OW_DOMAIN=%s\n' "$DOMAIN" >/etc/caddy/caddy.env
  chmod 0640 /etc/caddy/caddy.env
  install -d -m 0755 /etc/systemd/system/caddy.service.d
  cat >/etc/systemd/system/caddy.service.d/openwidgets.conf <<'EOF'
[Service]
# OW_DOMAIN for deploy/Caddyfile (written by deploy/provision.sh)
EnvironmentFile=/etc/caddy/caddy.env
EOF

  # ---- TLS line selection
  local tls_line
  case "$TLS_MODE" in
    internal)
      tls_line='tls internal'
      log "TLS: Caddy internal CA (offline). Trust it on managed devices or switch to --tls existing."
      ;;
    existing)
      install -d -o root -g caddy -m 0750 /etc/openwidgets/tls
      install -m 0644 -o root -g caddy "$CERT_FILE" /etc/openwidgets/tls/fullchain.pem
      install -m 0640 -o root -g caddy "$KEY_FILE"  /etc/openwidgets/tls/privkey.pem
      tls_line='tls /etc/openwidgets/tls/fullchain.pem /etc/openwidgets/tls/privkey.pem'
      log "TLS: using the supplied certificate"
      ;;
    acme)
      tls_line="tls ${ACME_EMAIL}"
      log "TLS: Let's Encrypt via ACME (${ACME_EMAIL})"
      ;;
  esac

  log "writing /etc/caddy/Caddyfile"
  local tab=$'\t'
  sed "s|^[[:space:]]*tls internal$|${tab}${tls_line}|" "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
  chmod 0644 /etc/caddy/Caddyfile
  grep -Fq -- "$tls_line" /etc/caddy/Caddyfile \
    || die "failed to apply TLS mode '$TLS_MODE' to the Caddyfile"

  OW_DOMAIN="$DOMAIN" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

  systemctl daemon-reload
  systemctl enable caddy >/dev/null 2>&1
  log "Caddy configured for https://${DOMAIN} (TLS mode: ${TLS_MODE})"
}

# --------------------------------------------------------------- start + check
wait_health() {
  local tries="${1:-90}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -m 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

install_service_native() {
  log "installing systemd unit"
  install -m 0644 "$APP_DIR/deploy/systemd/openwidgets.service" /etc/systemd/system/openwidgets.service
  systemctl daemon-reload
  systemctl enable openwidgets >/dev/null 2>&1
  systemctl restart openwidgets
}

start_app_docker() {
  log "building and starting the Docker Compose stack"
  ( cd "$APP_DIR" && docker compose -f deploy/docker-compose.yml up -d --build ) \
    || die "docker compose up failed (check: docker compose -f $APP_DIR/deploy/docker-compose.yml logs)"
}

start_caddy() {
  if (( NO_CADDY == 1 )); then return 0; fi
  log "starting/restarting Caddy"
  systemctl restart caddy
  systemctl is-active --quiet caddy || die "caddy did not start — check: journalctl -u caddy -n 100"
}

# =============================================================== main sequence
if (( SKIP_OS == 0 )); then
  install_os_packages
else
  warn "--skip-os: not installing OS packages"
fi

install_node
create_user_and_dirs
deploy_code
write_env_file

if [[ "$MODE" == "docker" ]]; then
  install_docker
else
  install_service_native
fi

install_caddy

if [[ "$MODE" == "docker" ]]; then
  start_app_docker
fi

start_caddy

log "waiting for GET /api/health"
if ! wait_health 120; then
  die "the app did not answer /api/health within 4 minutes — check the logs:
  native: journalctl -u openwidgets -n 100 --no-pager
  docker: docker compose -f $APP_DIR/deploy/docker-compose.yml logs --tail=100"
fi

# ------------------------------------------------------------------- summary
HEALTH="$(curl -fsS -m 3 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
EFFECTIVE_URL="http://127.0.0.1:3000"
if (( NO_CADDY == 0 )); then EFFECTIVE_URL="https://${DOMAIN}"; fi

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
OpenWidgets provisioned successfully.

  mode        : ${MODE}
  app dir     : ${APP_DIR}
  data dir    : ${DATA_DIR}
  config      : ${CONF_DIR}/openwidgets.env   (0600 root:openwidgets)
  health      : ${HEALTH:-<no response>}
  URL         : ${EFFECTIVE_URL}
  admin login : ${ADMIN_EMAIL:-$(grep -E '^ADMIN_EMAIL=' "$CONF_DIR/openwidgets.env" 2>/dev/null | cut -d= -f2- || echo '<see env file>')}

NEXT STEPS
  1. Open ${EFFECTIVE_URL}/login and change the admin password (then remove
     ADMIN_PASSWORD from ${CONF_DIR}/openwidgets.env).
  2. Create teacher accounts (admin UI, or with the CLI — note DATA_DIR, which the
     systemd unit gets from the env file but a manual run does not):
       sudo -u openwidgets env DATA_DIR=${DATA_DIR} node ${APP_DIR}/scripts/create-admin.mjs \\
         --email lehrer@schule.at --name "Name" --password 'mindestens-10-zeichen' --role teacher
  3. Test from a PUPIL device / pupil VLAN, not from this server.
  4. Install the nightly backup cron (docs/DEPLOY-LXC.md §8.3) and schedule a
     restore drill this term.
  5. TLS (${TLS_MODE}): $( [[ "$TLS_MODE" == internal ]] && echo "trust Caddy's root CA on managed devices, or re-run with --tls existing" || echo "verify the certificate chain on a pupil device" ).
──────────────────────────────────────────────────────────────────────────────
EOF
