#!/bin/bash
# openwidgets-update — poll GitHub for new commits on the deploy branch and
# hot-swap the app in place. Installed by deploy/auto-update/install.sh and
# run periodically by openwidgets-update.timer (systemd).
#
# Design notes:
# - The DATA_DIR (/var/lib/openwidgets) is outside APP_DIR, so updates never
#   touch the database, uploads or logs.
# - The tarball is pinned to the exact commit sha (codeload .../tar.gz/<sha>),
#   so a force-push or branch change mid-run cannot mix versions.
# - Before swapping, the current APP_DIR is backed up; after `systemctl restart`
#   the health endpoint must answer {"status":"ok"} — otherwise we roll back.
# - Network failures are not fatal: the timer just tries again next round.
set -euo pipefail

ENV_FILE="${OW_UPDATE_ENV:-/etc/openwidgets/update.env}"
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; fi

REPO="${OW_REPO:-damessner/openwidgets}"
BRANCH="${OW_BRANCH:-main}"
APP_DIR="${OW_APP_DIR:-/opt/openwidgets}"
SERVICE="${OW_SERVICE:-openwidgets}"
STATE_FILE="${OW_STATE_FILE:-/var/lib/openwidgets/.deployed-sha}"
BACKUP_DIR="${OW_BACKUP_DIR:-/var/backups/openwidgets}"
HEALTH_PORT="${OW_HEALTH_PORT:-3000}"
TAG="openwidgets-update"

log() { echo "[$TAG] $*"; }

fetch() { # fetch <url> <outfile>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 60 "$1" -o "$2"
  else
    wget -q --timeout=60 -O "$2" "$1"
  fi
}

latest_sha() {
  local tmp; tmp="$(mktemp)"
  if fetch "https://api.github.com/repos/${REPO}/commits/${BRANCH}" "$tmp"; then
    sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' "$tmp" | head -n 1
  fi
  rm -f "$tmp"
}

current_sha() {
  if [ -f "$STATE_FILE" ]; then cat "$STATE_FILE" 2>/dev/null || true; fi
}

health_ok() {
  local body
  if command -v curl >/dev/null 2>&1; then
    body="$(curl -fsS --max-time 10 "http://127.0.0.1:${HEALTH_PORT}/api/health" 2>/dev/null || true)"
  else
    body="$(wget -q --timeout=10 -O- "http://127.0.0.1:${HEALTH_PORT}/api/health" 2>/dev/null || true)"
  fi
  case "$body" in *'"status":"ok"'*|*'"status": "ok"'*) return 0 ;; *) return 1 ;; esac
}

do_update() {
  local sha="$1"
  local tmp; tmp="$(mktemp -d)"
  local root backup
  log "downloading ${REPO}@${sha}"
  fetch "https://codeload.github.com/${REPO}/tar.gz/${sha}" "$tmp/app.tar.gz"
  tar xzf "$tmp/app.tar.gz" -C "$tmp"
  root="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$root" ] || [ ! -f "$root/server/index.js" ] || [ ! -f "$root/package.json" ]; then
    log "ERROR: tarball does not look like an openwidgets checkout — aborting"
    rm -rf "$tmp"
    return 1
  fi

  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)"
  cp -a "$APP_DIR" "$backup"
  log "backup of current app at $backup"

  # overlay new files, then delete files that no longer exist upstream
  (cd "$root" && tar cf - .) | (cd "$APP_DIR" && tar xf -)
  (cd "$root" && find . -type f | sort) > "$tmp/new.txt"
  (cd "$APP_DIR" && find . -type f | sort) > "$tmp/old.txt"
  comm -13 "$tmp/new.txt" "$tmp/old.txt" | while IFS= read -r f; do
    rm -f "$APP_DIR/$f"
    log "removed stale file $f"
  done
  (cd "$APP_DIR" && find . -depth -type d -empty -exec rmdir {} + 2>/dev/null || true)

  log "restarting ${SERVICE}"
  systemctl restart "$SERVICE"
  sleep 2
  if systemctl is-active --quiet "$SERVICE" && health_ok; then
    echo "$sha" > "$STATE_FILE"
    log "updated to ${sha} — health OK (previous backup: $backup)"
    rm -rf "$tmp"
    return 0
  fi
  log "ERROR: health check failed after update — rolling back to $backup"
  rm -rf "$APP_DIR"
  cp -a "$backup" "$APP_DIR"
  systemctl restart "$SERVICE"
  sleep 2
  if systemctl is-active --quiet "$SERVICE" && health_ok; then
    log "rollback OK — still serving previous version"
  else
    log "CRITICAL: rollback failed, ${SERVICE} is not healthy — restore manually from $backup"
  fi
  rm -rf "$tmp"
  return 1
}

main() {
  local remote current
  remote="$(latest_sha || true)"
  if [ -z "$remote" ]; then
    log "could not reach GitHub API — skipping this round"
    exit 0
  fi
  current="$(current_sha)"
  if [ "$remote" = "$current" ]; then
    log "already up to date (${remote})"
    exit 0
  fi
  log "new commit on ${BRANCH}: ${remote} (deployed: ${current:-none})"
  do_update "$remote"
}

main "$@"
