#!/usr/bin/env bash
# deploy/upgrade.sh — upgrade OpenWidgets with a pre-upgrade backup and health gate.
#
# Runs INSIDE the container. Supports both deployment modes and both code
# sources: a git checkout (/opt/openwidgets) or a release tarball.
#
# Usage:
#   sudo ./upgrade.sh                        # git pull on current branch, backup, restart, verify
#   sudo ./upgrade.sh --test                 # also run `node --test test/` before restarting
#   sudo ./upgrade.sh --tarball /tmp/openwidgets-0.2.0.tar.gz
#   sudo ./upgrade.sh --branch main --update-config
#
# Rules enforced here (see docs/DEPLOY-LXC.md §10):
#   * a pre-upgrade backup is mandatory (override only with --no-backup, for dev)
#   * no `npm install` will ever be run: zero runtime dependencies are a contract
#   * health check failure prints the exact rollback, it does not pretend success
#   * Node major version is never changed by this script
#
# Exit codes: 0 ok, 1 failure (previous code/DB state preserved or documented).

set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/openwidgets}"
DATA_DIR="${DATA_DIR:-/var/lib/openwidgets}"
MODE=""
BRANCH=""
REPO_URL=""
TARBALL=""
RUN_TESTS=0
NO_BACKUP=0
UPDATE_CONFIG=0
ALLOW_DIRTY=0
FORCE=0
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OLD_COMMIT=""
NEW_COMMIT=""
PRE_BACKUP_PATH=""

log() {
  local line
  line="[$(date -Is)] $*"
  printf '%s\n' "$line"
  mkdir -p /var/log 2>/dev/null || true
  printf '%s\n' "$line" >>/var/log/openwidgets-upgrade.log 2>/dev/null || true
}
warn() { log "WARN: $*" >&2; }
die()  { log "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: upgrade.sh [options]

Options:
  --branch NAME      git branch to deploy (default: current branch, else main)
  --repo-url URL     clone the repo into --app-dir if it is not a git checkout yet
  --tarball FILE     deploy from a release tarball instead of git
  --test             run `node --test test/` before restarting (recommended)
  --no-backup        skip the mandatory pre-upgrade backup (DEV ONLY)
  --update-config    reinstall the systemd unit (Caddyfile is never overwritten:
                     review deploy/Caddyfile manually and re-run provision.sh)
  --allow-dirty      allow upgrading a git checkout with local modifications
  --force            restart even if the git commit did not change
  --app-dir DIR      app installation (default: /opt/openwidgets)
  --data-dir DIR     DATA_DIR (default: /var/lib/openwidgets)
  --mode native|docker  force deployment mode (default: auto-detect)
  --help             this text
EOF
}

while (($#)); do
  case "$1" in
    --branch)        BRANCH="$2"; shift 2 ;;
    --repo-url)      REPO_URL="$2"; shift 2 ;;
    --tarball)       TARBALL="$2"; shift 2 ;;
    --test)          RUN_TESTS=1; shift ;;
    --no-backup)     NO_BACKUP=1; shift ;;
    --update-config) UPDATE_CONFIG=1; shift ;;
    --allow-dirty)   ALLOW_DIRTY=1; shift ;;
    --force)         FORCE=1; shift ;;
    --app-dir)       APP_DIR="$2"; shift 2 ;;
    --data-dir)      DATA_DIR="$2"; shift 2 ;;
    --mode)          MODE="$2"; shift 2 ;;
    --help|-h)       usage; exit 0 ;;
    *)               die "unknown option: $1 (try --help)" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "run as root"
[[ -d "$APP_DIR" ]] || die "APP_DIR '$APP_DIR' does not exist"
[[ -f "$APP_DIR/server/index.js" ]] || die "APP_DIR '$APP_DIR' does not look like the OpenWidgets repo (missing server/index.js)"

if [[ -f /etc/openwidgets/openwidgets.env ]]; then
  env_value="$(grep -E '^DATA_DIR=' /etc/openwidgets/openwidgets.env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  if [[ -n "${env_value:-}" && "$DATA_DIR" == "/var/lib/openwidgets" ]]; then
    DATA_DIR="$env_value"
  fi
fi

detect_mode() {
  [[ -n "$MODE" ]] && return 0
  if command -v systemctl >/dev/null 2>&1 && systemctl cat openwidgets.service >/dev/null 2>&1; then
    MODE=native
  elif command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'openwidgets'; then
    MODE=docker
  elif [[ -f /etc/systemd/system/openwidgets.service ]]; then
    MODE=native
  else
    die "cannot detect deployment mode — pass --mode native|docker"
  fi
}
detect_mode
log "upgrade start (mode=${MODE}, app=${APP_DIR})"

# ------------------------------------------------------- mandatory pre-backup
if (( NO_BACKUP == 0 )); then
  log "pre-upgrade backup (mandatory)"
  offline_flag=()
  if [[ "$MODE" == "docker" ]] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'openwidgets'; then
    offline_flag=(--offline)
  fi
  if pre_out="$("$SCRIPT_DIR/backup.sh" "${offline_flag[@]}" --out "/var/backups/openwidgets/pre-upgrade" --keep 5 \
        --app-dir "$APP_DIR" --data-dir "$DATA_DIR" --mode "$MODE" 2>&1)"; then
    printf '%s\n' "$pre_out"
    PRE_BACKUP_PATH="$(printf '%s\n' "$pre_out" | tail -n 1)"
    log "pre-upgrade backup: ${PRE_BACKUP_PATH:-<see output above>}"
  else
    printf '%s\n' "$pre_out" >&2
    die "pre-upgrade backup failed — refusing to upgrade without a backup (--no-backup for dev only)"
  fi
else
  warn "--no-backup given: upgrading without a safety net (DEV ONLY)"
fi

# --------------------------------------------------------------- fetch code
if [[ -n "$TARBALL" ]]; then
  [[ -r "$TARBALL" ]] || die "--tarball '$TARBALL' is not readable"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR:-}"' EXIT
  log "extracting $TARBALL"
  tar -xf "$TARBALL" -C "$TMP_DIR" || die "failed to extract tarball"
  SRC_ROOT="$TMP_DIR"
  if [[ ! -f "$SRC_ROOT/server/index.js" ]]; then
    candidate="$(find "$TMP_DIR" -maxdepth 3 -type f -name 'index.js' -path '*/server/*' -print -quit 2>/dev/null || true)"
    [[ -n "$candidate" ]] || die "tarball does not contain server/index.js"
    SRC_ROOT="$(cd "$(dirname "$candidate")/.." && pwd)"
  fi
  if command -v git >/dev/null 2>&1 && [[ -d "$APP_DIR/.git" ]]; then
    OLD_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  log "syncing code from tarball into $APP_DIR"
  rsync -a --delete --exclude '.git' --exclude '.pnpm-store' --exclude 'data' --exclude 'data-*' \
    --exclude 'tools/e2e/node_modules' \
    "$SRC_ROOT"/ "$APP_DIR"/ || die "rsync failed"
else
  [[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout — use --tarball or --repo-url"
  if [[ -n "$REPO_URL" ]]; then
    log "ensuring remote origin is $REPO_URL"
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  fi
  if (( ALLOW_DIRTY == 0 )); then
    if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
      die "git checkout has local modifications — commit/stash them or pass --allow-dirty"
    fi
  fi
  if [[ -z "$BRANCH" ]]; then
    BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  fi
  OLD_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  log "fetching origin (branch: $BRANCH)"
  git -C "$APP_DIR" fetch --all --prune || die "git fetch failed"
  git -C "$APP_DIR" checkout "$BRANCH" || die "git checkout $BRANCH failed"
  if ! git -C "$APP_DIR" pull --ff-only; then
    die "git pull --ff-only failed (diverged history) — resolve manually, then re-run"
  fi
  NEW_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  log "commit: ${OLD_COMMIT:-?} -> ${NEW_COMMIT:-?}"
  if [[ -n "$OLD_COMMIT" && "$OLD_COMMIT" == "$NEW_COMMIT" ]] && (( FORCE == 0 )); then
    log "already up to date (${NEW_COMMIT}); nothing to do (use --force to restart anyway)"
    exit 0
  fi
fi
chown -R openwidgets:openwidgets "$APP_DIR" 2>/dev/null || true

# --------------------------------------------------------------- preflight
log "preflight: contract check (zero runtime dependencies)"
if ( cd "$APP_DIR" && node -e '
  const p = require("./package.json");
  const deps = p.dependencies ? Object.keys(p.dependencies) : [];
  if (deps.length) { console.error("runtime deps: " + deps.join(", ")); process.exit(1); }
' ); then
  log "zero runtime dependencies: OK (no npm install will be run)"
else
  die "package.json declares runtime dependencies — this violates the contract (docs/CONTRACT.md §0). Refusing to continue."
fi

log "preflight: Node version"
node -v
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node 24+ required (node:sqlite)"); process.exit(1); }' \
  || die "Node >= 24 is required"

log "preflight: ESM syntax check of the entry point"
if ! ( cd "$APP_DIR" && node --check server/index.js >/dev/null 2>&1 ); then
  # ESM syntax checking via --check is version/flag sensitive; try stdin form.
  if ! ( cd "$APP_DIR" && node --input-type=module --check < server/index.js >/dev/null 2>&1 ); then
    warn "could not syntax-check server/index.js (not fatal — tests/health will catch real breakage)"
  fi
fi

if (( RUN_TESTS == 1 )); then
  if [[ -d "$APP_DIR/test" ]]; then
    log "running test suite: node --test test/"
    if ! ( cd "$APP_DIR" && runuser -u openwidgets -- env HOME=/tmp node --test test/ ); then
      die "tests FAILED — refusing to restart; code left in place at ${NEW_COMMIT:-tarball state}"
    fi
    log "tests passed"
    chown -R openwidgets:openwidgets "$APP_DIR" 2>/dev/null || true
  else
    warn "no test/ directory present — skipping --test"
  fi
fi

# ------------------------------------------------------------- config update
if (( UPDATE_CONFIG == 1 )); then
  if [[ -f "$APP_DIR/deploy/systemd/openwidgets.service" ]]; then
    log "updating systemd unit"
    install -m 0644 "$APP_DIR/deploy/systemd/openwidgets.service" /etc/systemd/system/openwidgets.service
    systemctl daemon-reload
  fi
  warn "Caddyfile NOT overwritten (may contain local TLS/DNS customisation). Diff it manually:"
  warn "  diff -u /etc/caddy/Caddyfile $APP_DIR/deploy/Caddyfile"
fi

# ---------------------------------------------------------------- restart
wait_health() {
  local tries="${1:-60}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -m 3 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log "restarting service"
case "$MODE" in
  native)
    systemctl restart openwidgets || die "systemctl restart failed — check: journalctl -u openwidgets"
    ;;
  docker)
    ( cd "$APP_DIR" && docker compose -f deploy/docker-compose.yml up -d --build ) \
      || die "docker compose up --build failed"
    ;;
esac

log "waiting for /api/health"
if wait_health 180; then
  log "upgrade OK — service healthy"
else
  warn "service did NOT become healthy after upgrade"
  cat >&2 <<EOF

ROLLBACK INSTRUCTIONS
  1) Code:
     cd $APP_DIR && git checkout -f ${OLD_COMMIT:-<previous-commit>}
     sudo systemctl restart openwidgets      # native
     # docker: cd $APP_DIR && docker compose -f deploy/docker-compose.yml up -d --build
  2) Data (only if the new version migrated the schema):
     sudo $SCRIPT_DIR/restore.sh --from ${PRE_BACKUP_PATH:-<pre-upgrade backup>} --yes
  3) Investigate:
     journalctl -u openwidgets -n 200 --no-pager
EOF
  exit 1
fi

# ---------------------------------------------------------------- record state
{
  echo "deployed_at=$(date -Is)"
  echo "mode=${MODE}"
  echo "commit=${NEW_COMMIT:-tarball}"
  if [[ -n "$TARBALL" ]]; then echo "tarball=$(basename "$TARBALL")"; fi
  echo "node=$(node -v)"
  echo "pre_upgrade_backup=${PRE_BACKUP_PATH:-none}"
} > "$APP_DIR/DEPLOYED_VERSION"
chown openwidgets:openwidgets "$APP_DIR/DEPLOYED_VERSION" 2>/dev/null || true
log "wrote $APP_DIR/DEPLOYED_VERSION"
log "upgrade complete"
