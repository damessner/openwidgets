# Auto-update from GitHub

Once OpenWidgets is deployed on a host (VM or LXC), it can **update itself from
the GitHub repository**: a systemd timer polls `api.github.com` for the latest
commit on the deploy branch every 10 minutes; when a new commit appears, the
matching tarball is downloaded from `codeload.github.com` (pinned to the exact
commit sha), swapped into `/opt/openwidgets`, the service is restarted, and the
health endpoint must answer `{"status":"ok"}` — otherwise the previous version
is restored automatically from the backup.

Your data is never touched: the database, uploads and logs live in
`DATA_DIR` (`/var/lib/openwidgets`), outside the app directory.

## Install (one command, as root)

```bash
curl -fsSL https://raw.githubusercontent.com/damessner/openwidgets/main/deploy/auto-update/install.sh | bash
```

Inside a Proxmox LXC, from the PVE host:

```bash
pct exec <vmid> -- bash -c "curl -fsSL https://raw.githubusercontent.com/damessner/openwidgets/main/deploy/auto-update/install.sh | bash"
```

Requires: systemd, curl or wget, and outbound HTTPS to `api.github.com` /
`codeload.github.com` / `raw.githubusercontent.com`.

## What gets installed

| Path | Purpose |
| --- | --- |
| `/usr/local/sbin/openwidgets-update` | updater script (poll → download → swap → restart → health check → rollback on failure) |
| `/etc/systemd/system/openwidgets-update.service` | oneshot unit running the script |
| `/etc/systemd/system/openwidgets-update.timer` | runs it 3 min after boot, then every 10 min (`Persistent=true`) |
| `/etc/openwidgets/update.env` | config: `OW_REPO`, `OW_BRANCH`, `OW_APP_DIR`, `OW_SERVICE`, `OW_STATE_FILE`, `OW_BACKUP_DIR`, `OW_HEALTH_PORT` |
| `/var/lib/openwidgets/.deployed-sha` | sha of the currently deployed commit |
| `/var/backups/openwidgets/<timestamp>/` | backup of the previous app version before each swap |

## Everyday operations

```bash
systemctl start openwidgets-update.service   # update now (instead of waiting for the timer)
journalctl -u openwidgets-update.service -f   # watch update logs
systemctl list-timers openwidgets-update.timer # next scheduled run
systemctl stop openwidgets-update.timer       # pause auto-updates
systemctl disable openwidgets-update.timer    # remove auto-updates entirely
```

## How it stays safe

- **Pinned downloads**: the tarball URL contains the exact commit sha, so a
  force-push mid-run cannot mix files from two versions.
- **Sanity check**: the tarball must contain `server/index.js` + `package.json`
  before anything is touched.
- **Backup + health gate + rollback**: previous app dir is copied to
  `/var/backups/openwidgets/`, and only if `systemctl is-active` **and**
  `GET /api/health` returns `"status":"ok"` after restart is the new sha
  recorded. On failure the backup is restored and the service restarted again.
- **DB migrations still run automatically** on service start
  (`server/db.js` migration ladder), so schema changes in a new release apply
  on the first boot after the update.
- Network failures are non-fatal: the next timer run retries.

## Changing what is deployed

Edit `/etc/openwidgets/update.env`, e.g. to pin a release branch or tag:

```bash
OW_BRANCH=v0.2          # branch or tag name
systemctl restart openwidgets-update.timer
```

## Workflow

1. Develop locally, `git push` to `damessner/openwidgets` (branch `main`).
2. Within ~10 minutes every host with the timer installed picks up the new
   commit, updates itself and rolls back automatically if anything breaks.
3. Check `journalctl -u openwidgets-update.service` on the host if you want to
   confirm the update landed.
