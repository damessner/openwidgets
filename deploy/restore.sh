#!/usr/bin/env bash
# deploy/restore.sh — restore an OpenWidgets backup set.
#
# Runs INSIDE the container (native or docker mode). Auto-detects the mode.
# The service is STOPPED before restoring (contract: restore expects the
# service stopped) and STARTED again afterwards, then /api/health is verified.
#
# Safety: unless --no-backup is given, a pre-restore backup of the CURRENT
# state is taken first, so a wrong restore is reversible.
#
# Usage:
#   sudo ./restore.sh --from /var/backups/openwidgets/openwidgets-20261109-021700
#   sudo ./restore.sh --from /var/backups/openwidgets/... --yes
#   sudo ./restore.sh --from <path> --no-start        # restore only, start manually
#
# Exit codes: 0 ok and healthy, 1 error / unhealthy after restore.

set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/openwidgets}"
DATA_DIR="${DATA_DIR:-/var/lib/openwidgets}"
OUT_DIR="${OUT_DIR:-/var/backups/openwidgets}"
FROM=""
MODE=""
NO_BACKUP=0
NO_START=0
ASSUME_YES=0
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log() {
  local line
  line="[$(date -Is)] $*"
  printf '%s\n' "$line"
  mkdir -p /var/log 2>/dev/null || true
  printf '%s\n' "$line" >>/var/log/openwidgets-restore.log 2>/dev/null || true
}
warn() { log "WARN: $*" >&2; }
die()  { log "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: restore.sh --from PATH [options]

Options:
  --from PATH        backup file or backup set directory (required)
  --yes              non-interactive confirmation (required when no TTY)
  --no-backup        do NOT take a pre-restore backup of the current state
  --no-start         do not start the service after restoring
  --app-dir DIR      app installation (default: /opt/openwidgets)
  --data-dir DIR     DATA_DIR (default: /var/lib/openwidgets; env file value wins)
  --mode native|docker  force deployment mode (default: auto-detect)
  --help             this text

The actual restore is done by `node scripts/restore.mjs --from <path>`.
EOF
}

while (($#)); do
  case "$1" in
    --from)      FROM="$2"; shift 2 ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --no-start)  NO_START=1; shift ;;
    --app-dir)   APP_DIR="$2"; shift 2 ;;
    --data-dir)  DATA_DIR="$2"; shift 2 ;;
    --mode)      MODE="$2"; shift 2 ;;
    --help|-h)   usage; exit 0 ;;
    *)           die "unknown option: $1 (try --help)" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "run as root"
[[ -n "$FROM" ]] || die "--from is required (backup file or directory)"
[[ -e "$FROM" ]] || die "--from '$FROM' does not exist"
[[ -d "$APP_DIR" ]] || die "APP_DIR '$APP_DIR' does not exist"
[[ -f "$APP_DIR/scripts/restore.mjs" ]] || die "missing $APP_DIR/scripts/restore.mjs (app restore CLI not implemented yet?)"

if [[ -f /etc/openwidgets/openwidgets.env ]]; then
  env_value="$(grep -E '^DATA_DIR=' /etc/openwidgets/openwidgets.env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  if [[ -n "${env_value:-}" && "${DATA_DIR}" == "/var/lib/openwidgets" ]]; then
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

# -------------------------------------------------------------- confirmation
FROM_ABS="$(readlink -f -- "$FROM")"
log "restore requested from: $FROM_ABS (mode=${MODE})"
if (( ASSUME_YES == 0 )); then
  if [[ -t 0 ]]; then
    printf 'This will OVERWRITE the current OpenWidgets data in %s\n' "$DATA_DIR"
    printf 'with the backup %s\n' "$FROM_ABS"
    read -r -p 'Continue? [y/N] ' answer
    [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]] || die "aborted by user"
  else
    die "refusing to restore non-interactively without --yes"
  fi
fi

# ---------------------------------------------------------------- stop service
stop_service() {
  case "$MODE" in
    native)
      if systemctl is-active --quiet openwidgets 2>/dev/null; then
        log "stopping openwidgets.service"
        systemctl stop openwidgets
      fi
      ;;
    docker)
      log "stopping openwidgets container"
      docker compose -f "$APP_DIR/deploy/docker-compose.yml" stop openwidgets || true
      ;;
  esac
}
trap 'warn "restore failed — service state unchanged or partially changed; see messages above"' ERR
stop_service

# --------------------------------------------------------- pre-restore backup
PRE_BACKUP_PATH=""
if (( NO_BACKUP == 0 )); then
  log "taking a pre-restore backup of the current state"
  if pre_out="$("$SCRIPT_DIR/backup.sh" --offline --out "${OUT_DIR}/pre-restore" --keep 3 \
        --app-dir "$APP_DIR" --data-dir "$DATA_DIR" --mode "$MODE" 2>&1)"; then
    printf '%s\n' "$pre_out"
    PRE_BACKUP_PATH="$(printf '%s\n' "$pre_out" | tail -n 1)"
    [[ -d "$PRE_BACKUP_PATH" || -f "$PRE_BACKUP_PATH" ]] || PRE_BACKUP_PATH=""
    log "pre-restore backup: ${PRE_BACKUP_PATH:-<see output above>}"
  else
    printf '%s\n' "$pre_out" >&2
    die "pre-restore backup FAILED — refusing to restore without a safety net (use --no-backup to override).
      NOTE: the service is currently STOPPED. Restart it with:
        systemctl start openwidgets        # native
        docker compose -f $APP_DIR/deploy/docker-compose.yml start openwidgets   # docker"
  fi
else
  warn "--no-backup given: the current state will be overwritten with no safety net"
fi

# ------------------------------------------------------------------- restore
log "calling scripts/restore.mjs"
case "$MODE" in
  native)
    # Run as root on purpose: the backup source lives under root-owned
    # /var/backups and must not be copied (disk doubling). Ownership of the
    # restored tree is fixed to the service user immediately afterwards.
    # restore.mjs refuses without --yes, by design.
    env DATA_DIR="$DATA_DIR" NODE_ENV=production \
      node "$APP_DIR/scripts/restore.mjs" --from "$FROM_ABS" --yes \
      || die "scripts/restore.mjs failed"
    chown -R openwidgets:openwidgets "$DATA_DIR"
    ;;
  docker)
    # Make the backup visible inside the container's /data mount.
    if [[ "$FROM_ABS" == "$DATA_DIR"/* ]]; then
      CONTAINER_PATH="/data/${FROM_ABS#"$DATA_DIR"/}"
    else
      STAGE_DIR="$DATA_DIR/restore-input-$(date +%s)"
      log "staging backup into $STAGE_DIR (visible to the container at /data/$(basename "$STAGE_DIR"))"
      mkdir -p "$DATA_DIR"
      cp -a -- "$FROM_ABS" "$STAGE_DIR"
      # container runs as uid 1000 and must be able to read the staged input
      chown -R 1000:1000 "$STAGE_DIR"
    fi
    docker compose -f "$APP_DIR/deploy/docker-compose.yml" run --rm --no-deps \
      -e DATA_DIR=/data openwidgets node scripts/restore.mjs --from "$CONTAINER_PATH" --yes \
      || die "scripts/restore.mjs failed (inside the container)"
    chown -R 1000:1000 "$DATA_DIR"
    # remove the staged copy of the backup (the archive itself is untouched)
    if [[ -n "${STAGE_DIR:-}" && -d "$STAGE_DIR" ]]; then rm -rf -- "$STAGE_DIR"; fi
    ;;
esac
log "restore CLI finished"

# --------------------------------------------------------------------- start
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

if (( NO_START == 0 )); then
  case "$MODE" in
    native)
      systemctl start openwidgets
      ;;
    docker)
      docker compose -f "$APP_DIR/deploy/docker-compose.yml" start openwidgets
      ;;
  esac
  log "waiting for /api/health"
  if wait_health 60; then
    log "restore OK — service is healthy"
  else
    warn "service did NOT become healthy after restore"
    printf '\nROLLBACK (restore the pre-restore backup):\n'
    printf '  sudo %s/restore.sh --from %s --yes\n\n' "$SCRIPT_DIR" "${PRE_BACKUP_PATH:-<pre-restore backup path>}"
    exit 1
  fi
else
  log "--no-start given: service left stopped"
fi

# Best-effort compatibility note: compare recorded app commit with current one.
if [[ -d "$FROM_ABS" && -f "$FROM_ABS/MANIFEST.txt" ]]; then
  old_commit="$(grep -E '^app_commit=' "$FROM_ABS/MANIFEST.txt" | tail -n1 | cut -d= -f2- || true)"
  cur_commit="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "$old_commit" && -n "$cur_commit" && "$old_commit" != "$cur_commit" ]]; then
    warn "backup was created by commit ${old_commit}, current code is ${cur_commit} — verify the data looks right"
  fi
fi

log "done: $FROM_ABS"
