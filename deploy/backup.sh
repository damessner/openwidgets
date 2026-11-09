#!/usr/bin/env bash
# deploy/backup.sh — SQLite-consistent backup for OpenWidgets.
#
# Runs INSIDE the container (native or docker mode). Auto-detects the mode.
# Calls the app's own backup CLI:
#     node scripts/backup.mjs --out <dir>
# which is the contract-specified, consistent SQLite snapshot + assets backup
# (docs/CONTRACT.md §2). It never copies a live .db file with cp/cp -r.
#
# Usage:
#   sudo ./backup.sh                                  # -> /var/backups/openwidgets, keep 14
#   sudo ./backup.sh --out /srv/backup/ow --keep 30
#   sudo ./backup.sh --offsite backup@nas:/backups/openwidgets
#   sudo ./backup.sh --offline                        # service already stopped (used by restore.sh)
#
# Exit codes: 0 ok, 1 error (no backup produced / verification failed).
# A cron line is in docs/DEPLOY-LXC.md §8.3.

set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/openwidgets}"
DATA_DIR="${DATA_DIR:-/var/lib/openwidgets}"
OUT_DIR="${OUT_DIR:-/var/backups/openwidgets}"
KEEP="${KEEP:-14}"
OFFSITE=""
MODE=""
OFFLINE=0
DO_VERIFY=1
LOG_FILE="${LOG_FILE:-/var/log/openwidgets-backup.log}"

log() {
  local line
  line="[$(date -Is)] $*"
  printf '%s\n' "$line"
  if [[ -n "$LOG_FILE" ]]; then
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
  fi
}
warn() { log "WARN: $*" >&2; }
die()  { log "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: backup.sh [options]

Options:
  --out DIR          destination directory (default: /var/backups/openwidgets)
  --keep N           keep the N newest backup sets (default: 14)
  --offsite TARGET   rsync the new backup set to TARGET (e.g. user@nas:/backups/openwidgets)
  --app-dir DIR      app installation (default: /opt/openwidgets)
  --data-dir DIR     DATA_DIR (default: /var/lib/openwidgets; the env file value is used if set)
  --mode native|docker  force deployment mode (default: auto-detect)
  --offline          service is stopped; docker mode uses a one-off container
  --no-verify        skip the SQLite quick_check on the produced snapshot
  --help             this text

The backup is created by `node scripts/backup.mjs --out <staging>` (contract:
consistent SQLite snapshot + uploaded assets). SHA-256 sums and a MANIFEST are
written next to it; old sets are rotated by mtime.
EOF
}

while (($#)); do
  case "$1" in
    --out)       OUT_DIR="$2"; shift 2 ;;
    --keep)      KEEP="$2"; shift 2 ;;
    --offsite)   OFFSITE="$2"; shift 2 ;;
    --app-dir)   APP_DIR="$2"; shift 2 ;;
    --data-dir)  DATA_DIR="$2"; shift 2 ;;
    --mode)      MODE="$2"; shift 2 ;;
    --offline)   OFFLINE=1; shift ;;
    --no-verify) DO_VERIFY=0; shift ;;
    --help|-h)   usage; exit 0 ;;
    *)           die "unknown option: $1 (try --help)" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "run as root (needs to read the data dir and write the backup dir)"
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep must be numeric"

# --------------------------------------------------------- config discovery
if [[ -f /etc/openwidgets/openwidgets.env ]]; then
  # only take DATA_DIR from the env file when the caller did not override it
  if [[ "${DATA_DIR}" == "/var/lib/openwidgets" ]]; then
    env_value="$(grep -E '^DATA_DIR=' /etc/openwidgets/openwidgets.env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    [[ -n "${env_value:-}" ]] && DATA_DIR="$env_value"
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

[[ -d "$DATA_DIR" ]] || die "DATA_DIR '$DATA_DIR' does not exist"
[[ -d "$APP_DIR" ]] || die "APP_DIR '$APP_DIR' does not exist"
[[ -f "$APP_DIR/scripts/backup.mjs" ]] || die "missing $APP_DIR/scripts/backup.mjs (app backup CLI not implemented yet?)"

detect_mode
log "starting backup (mode=${MODE}, data=${DATA_DIR}, out=${OUT_DIR}, offline=${OFFLINE})"

mkdir -p "$OUT_DIR"
# Serialise runs; don't queue a pile of backups behind a stuck one.
exec 9>"/run/openwidgets-backup.lock"
flock -n 9 || die "another backup is already running (lock: /run/openwidgets-backup.lock)"

RUN_ID="$$-$(date +%s)"
STAGING_DIR=""
FINAL_DIR=""

cleanup() {
  # remove staging leftovers; keep the final set (that's the deliverable)
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" && -z "$FINAL_DIR" ]]; then
    rm -rf "$STAGING_DIR" 2>/dev/null || true
  fi
  # docker staging under DATA_DIR must be cleaned in both paths
  if [[ "$MODE" == "docker" ]]; then
    rm -rf "${DATA_DIR}/backups/staging-${RUN_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------- run the app CLI
log "creating consistent snapshot via scripts/backup.mjs"
case "$MODE" in
  native)
    # native CLI works whether or not the service runs
    STAGING_DIR="${OUT_DIR}/.staging-${RUN_ID}"
    # The app CLI runs as the unprivileged service user, so the staging dir
    # must be writable by it (OUT_DIR itself stays root-owned).
    install -d -o openwidgets -g openwidgets -m 0750 "$STAGING_DIR"
    runuser -u openwidgets -- env \
      DATA_DIR="$DATA_DIR" \
      NODE_ENV=production \
      node "$APP_DIR/scripts/backup.mjs" --out "$STAGING_DIR"
    ;;
  docker)
    COMPOSE_FILE="$APP_DIR/deploy/docker-compose.yml"
    [[ -f "$COMPOSE_FILE" ]] || die "missing compose file: $COMPOSE_FILE"
    install -d -m 0750 "${DATA_DIR}/backups"
    # The container runs as uid 1000; it must be able to write the staging dir.
    chown 1000:1000 "${DATA_DIR}/backups" \
      || warn "could not chown ${DATA_DIR}/backups to 1000:1000 — container backups may fail"
    if [[ "$OFFLINE" -eq 1 ]]; then
      docker compose -f "$COMPOSE_FILE" run --rm --no-deps -e DATA_DIR=/data \
        openwidgets node scripts/backup.mjs --out "/data/backups/staging-${RUN_ID}"
    else
      docker compose -f "$COMPOSE_FILE" exec -T -e DATA_DIR=/data \
        openwidgets node scripts/backup.mjs --out "/data/backups/staging-${RUN_ID}"
    fi
    STAGING_DIR="${DATA_DIR}/backups/staging-${RUN_ID}"
    ;;
  *) die "unknown mode '$MODE'" ;;
esac

[[ -d "$STAGING_DIR" ]] || die "backup CLI did not create a staging directory ($STAGING_DIR)"
mapfile -t ENTRIES < <(find "$STAGING_DIR" -mindepth 1 -maxdepth 1 -print | sort)
((${#ENTRIES[@]} > 0)) || die "backup CLI produced no files in $STAGING_DIR"

# ------------------------------------------------------------- optional verify
if (( DO_VERIFY == 1 )); then
  db_file="$(find "$STAGING_DIR" -type f -name '*.db' -print -quit 2>/dev/null || true)"
  if [[ -n "$db_file" ]]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      log "verifying SQLite snapshot: PRAGMA quick_check on $(basename "$db_file")"
      check="$(sqlite3 "$db_file" 'PRAGMA quick_check;' 2>&1 || true)"
      [[ "$check" == "ok" ]] || die "SQLite quick_check failed: $check"
    else
      warn "sqlite3 not installed — skipping snapshot verification"
    fi
  else
    warn "no .db file found in the snapshot (tar/zip format?); skipping SQLite verification"
  fi
fi

# ----------------------------------------------------------------- assemble set
# scripts/backup.mjs writes a timestamped directory itself:
#   <staging>/openwidgets-<stamp>/{openwidgets.db, assets/, manifest.json}
# Promote that directory to be the backup set, so that
#   node scripts/restore.mjs --from <set-dir>
# finds openwidgets.db at the root (which is what restore.mjs expects).
TS="$(date +%Y%m%d-%H%M%S)"
FINAL_DIR="${OUT_DIR}/openwidgets-${TS}"
if ((${#ENTRIES[@]} == 1)) && [[ -d "${ENTRIES[0]}" ]]; then
  if [[ -e "$FINAL_DIR" ]]; then FINAL_DIR="${FINAL_DIR}-${RUN_ID}"; fi
  mv "${ENTRIES[0]}" "$FINAL_DIR"
  rmdir "$STAGING_DIR" 2>/dev/null || true
else
  # Fallback if the backup CLI layout changes: keep every artefact.
  warn "unexpected backup layout (multiple entries) — restore may need --from <nested dir>"
  mkdir -p "$FINAL_DIR"
  for entry in "${ENTRIES[@]}"; do
    mv "$entry" "$FINAL_DIR"/
  done
  rmdir "$STAGING_DIR" 2>/dev/null || true
fi
mapfile -t FINAL_ENTRIES < <(find "$FINAL_DIR" -mindepth 1 -maxdepth 1 -print | sort)

{
  echo "OpenWidgets backup set"
  echo "created_at=$(date -Is)"
  echo "hostname=$(hostname)"
  echo "mode=${MODE}"
  echo "data_dir=${DATA_DIR}"
  echo "app_dir=${APP_DIR}"
  if command -v git >/dev/null 2>&1 && [[ -d "$APP_DIR/.git" ]]; then
    echo "app_commit=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  fi
  node_version="$(node -v 2>/dev/null || echo unknown)"
  echo "node=${node_version}"
  echo "entries:"
} > "$FINAL_DIR/MANIFEST.txt"
for entry in "${FINAL_ENTRIES[@]}"; do
  printf '  %-60s %10s bytes\n' \
    "$(basename "$entry")" \
    "$(du -sb "$entry" 2>/dev/null | cut -f1 || echo '?')" >> "$FINAL_DIR/MANIFEST.txt"
done

log "computing SHA-256 sums"
( cd "$FINAL_DIR" && find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 -r sha256sum > SHA256SUMS )
chmod 0750 "$FINAL_DIR" 2>/dev/null || true

log "backup set created: $FINAL_DIR ($(du -sh "$FINAL_DIR" 2>/dev/null | cut -f1))"

# ------------------------------------------------------------------- retention
if (( KEEP > 0 )); then
  # shellcheck disable=SC2012
  old_sets="$(ls -1dt "${OUT_DIR}"/openwidgets-* 2>/dev/null | tail -n +$((KEEP + 1)) || true)"
  if [[ -n "$old_sets" ]]; then
    while IFS= read -r old; do
      [[ -n "$old" ]] || continue
      log "retention: removing $old"
      rm -rf -- "$old"
    done <<< "$old_sets"
  fi
fi
# stale docker staging dirs from crashed runs
find "${DATA_DIR}/backups" -maxdepth 1 -type d -name 'staging-*' -mmin +240 -exec rm -rf {} + 2>/dev/null || true

# --------------------------------------------------------------------- offsite
if [[ -n "$OFFSITE" ]]; then
  log "copying to offsite target: $OFFSITE"
  command -v rsync >/dev/null 2>&1 || die "rsync not installed — cannot use --offsite"
  rsync -a --partial "$FINAL_DIR" "$OFFSITE/" || die "offsite copy failed (backup kept locally at $FINAL_DIR)"
  log "offsite copy done"
fi

log "backup OK: $FINAL_DIR"
printf '%s\n' "$FINAL_DIR"
