# Deployment Guide — OpenWidgets on a single Proxmox LXC

**Audience:** the teacher/sysadmin who runs the school's Proxmox host, not a platform team.
**Target:** one Debian 12 unprivileged LXC on an existing Proxmox VE host, serving OpenWidgets to one Austrian secondary school (Mittelschule Telfs), on the school LAN (optionally reachable from home).
**App:** single Node.js 24 process, zero runtime npm dependencies, SQLite + local assets, served through Caddy.
**Artifacts referenced:** everything in [`deploy/`](../deploy/) — `lxc-create.sh`, `provision.sh`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `systemd/openwidgets.service`, `backup.sh`, `restore.sh`, `upgrade.sh`.
**Review date:** 2026-11-09. Re-check versions before a fresh install; "latest" ages badly.

> **Scope note:** this guide documents *our* deployment. It is not a das proprietäre Originalprodukt migration guide (see [`CRITICAL-EVALUATION.md`](CRITICAL-EVALUATION.md) §3.3 — activity content cannot be exported from das proprietäre Originalprodukt, so migration is re-authoring).

---

## 0. TL;DR / decision sheet

| Question | Answer |
|---|---|
| Container type | **Unprivileged** Debian 12 LXC, 2 vCPU, 2 GB RAM, 512 MB swap, 16 GB disk |
| Recommended install path | **Native systemd + Caddy** (~30 % less moving parts than Docker-in-LXC, no overlayfs/io_uring caveats) |
| Docker path | Supported and scripted, but requires `features: nesting=1,keyctl=1` and a storage driver that works on the host's storage (see §5) |
| Node | **Node 24.x** (Debian 12's own Node 18 is too old — `node:sqlite` does not exist there). Pin the minor version. |
| Network | Only **80/443** exposed to the LAN; the app listens on `127.0.0.1:3000` behind Caddy |
| Data | `/var/lib/openwidgets` inside the container (`openwidgets.db` + `assets/`) |
| Backups | Nightly `deploy/backup.sh` → SQLite-consistent snapshot + assets; off-site copy; **quarterly restore drill** |
| TLS | Prefer the school's existing certificate or a public cert with DNS-01; internal CA works only for devices you manage |
| DSGVO | School is the *Verantwortlicher*; self-hosting removes the processor, but you still need Verzeichnis/TOMs/Löschkonzept (§12) |
| Maintenance | ~1 h/month + Debian/Node security updates + one restore drill per term |

**Deployment assumptions you must confirm before starting** (they change the numbers below):

- Proxmox VE 8.x or 9.x (cgroup v2), host on ZFS or LVM-thin.
- A static IP or DHCP reservation for the container; a DNS name (`widgets.<school-domain>`) resolvable by pupil devices.
- The host has ≥ 8 GB RAM free, and backups already go somewhere (Proxmox Backup Server, NAS, or filesystem).
- The school's device fleet: mix of Windows laptops, iPads/tablets and Chromebooks (this determines TLS choice and touch testing).
- No LMS requirement for v0.1 (Teams/Google Classroom links are pasted manually; see roadmap).

---

## 1. Capacity sizing and when to scale

The workload is: one Node process, one SQLite writer, small static assets, SSE streams per open live dashboard, and file uploads by teachers. A Mittelschule is roughly 200–400 pupils and 25–50 teachers; a busy lesson has 20–30 simultaneous attempts, and the worst realistic burst is a whole class submitting within a few seconds.

| Resource | Default | Rationale / threshold to increase |
|---|---|---|
| vCPU | **2** | Node is single-threaded for JS; 2 vCPU gives headroom for Caddy, SQLite checkpoints, backups and the OS. Watch load average: sustained > 1.5 during lessons → add a core. |
| RAM | **2 GB** | Node ≈ 100–200 MB, Caddy ≈ 30–50 MB, Debian ≈ 250–400 MB, page cache for SQLite is the rest. Watch `MemoryMax`/swap use: if the process is repeatedly OOM-killed, go to 4 GB. |
| Swap | 512 MB–1 GB | Safety net for a backup+build spike, not for steady state. |
| Disk | **16 GB** | OS+Node ≈ 2–3 GB; the DB *should* stay < 500 MB for a school; **uploads are the growth risk** (audio/video especially). 16 GB is enough for text/image worksheets for several years. If you enable audio/video uploads (v0.3), start at **32 GB** and monitor. |
| Storage type | Host local (LVM-thin, ZFS, ext4) | Do **not** place `DATA_DIR` on NFS/CIFS or a synced folder (OneDrive/Dropbox/iCloud): SQLite locking and mmap behave badly there. This is a classic self-hosted-app data-loss bug — see §14. |
| Bandwidth | LAN 100 Mbit+ | Assets are small; video playback from uploads is the only heavy case. |

**Scaling guidance (in order):**

1. **Add cores second, RAM first** if the process is being OOM-killed; **add RAM second** if the DB page cache thrashes.
2. **Concurrency ceiling** in practice is *SQLite writer serialization + single Node event loop*, not CPU. For one school that ceiling is hundreds of responses/minute — more than enough. If a second school ever shares it (don't), you'd need to reassess SQLite, not CPU.
3. **Exports/backups** are the only operations that block the event loop for seconds (synchronous `node:sqlite`). Schedule them outside lesson hours.
4. If the host is busy with other VMs, set `cores`/`cpulimit` and use `cpuunits` to give this container priority during school hours (Proxmox cgroup controls; see [Proxmox LXC docs](https://pve.proxmox.com/wiki/Linux_Container)).

Storage estimate: 30 pupils × 20 items × ~500 bytes ≈ 300 KB per attempt set; 1000 assignments/year ≈ tens of MB. Images dominate: a 300 KB JPEG per item × 10 items × 500 activities ≈ 1.5 GB. **Budget disk by uploads, not by grades.**

---

## 2. Target architecture

```
Pupil/teacher device (Chromebook / iPad / PC)
        │  https://widgets.<school-domain>  (LAN, optional WAN)
        ▼
┌──────────────────────────── Proxmox host ────────────────────────────┐
│ ┌──────────────── unprivileged LXC (Debian 12) ────────────────────┐ │
│ │ Caddy  :80/:443  ──reverse_proxy──►  Node 24 127.0.0.1:3000      │ │
│ │   (TLS, headers, SSE flush)           single process, zero deps  │ │
│ │                                        │                         │ │
│ │                          /opt/openwidgets  (code, read-only)     │ │
│ │                          /var/lib/openwidgets (DATA_DIR)         │ │
│ │                            openwidgets.db (+wal, +shm)           │ │
│ │                            assets/<assetId>                      │ │
│ │                          /etc/openwidgets/openwidgets.env (0600) │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ vzdump / PBS backups ──► off-box storage (NAS/PBS)                    │
└───────────────────────────────────────────────────────────────────────┘
```

Only Caddy is reachable from the network. The Node process is not exposed, has no root, and writes only to `DATA_DIR`.

---

## 3. Create the container (Proxmox host)

The script [`deploy/lxc-create.sh`](../deploy/lxc-create.sh) wraps the `pct` commands below and is idempotent (it refuses to reuse an existing CTID). Run it **on the Proxmox host** as root.

### 3.1 Manual equivalent (so you understand what the script does)

```bash
# on the Proxmox host, as root
pveam update
pveam available --section system | grep debian-12        # find the current template name
pveam download local debian-12-standard_<date>_amd64.tar.zst

pct create 210 local:vztmpl/debian-12-standard_<date>_amd64.tar.zst \
  --hostname openwidgets \
  --unprivileged 1 \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-zfs:16 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.20.15/24,gw=10.10.20.1 \
  --nameserver 10.10.20.1 \
  --onboot 1 --start 1 \
  --description "OpenWidgets - das proprietäre Originalprodukt alternative (school)"

# Docker path only (see §5): add --features nesting=1,keyctl=1
```

Notes:

- **`--unprivileged 1`** is the Proxmox default and the right choice: root in the container maps to an unprivileged host UID (typically 100000), so a container escape lands on an unprivileged user, not host root ([Proxmox LXC docs](https://pve.proxmox.com/wiki/Linux_Container#Unprivileged_Containers)).
- **Static IP or DHCP reservation** — pick one. DNS matters more than you think: `BASE_URL` and QR codes embed the hostname.
- If the container needs to reach the internet for package installation (NodeSource/Caddy/docker repos), allow it outbound during provisioning; you can restrict it afterwards.
- Proxmox storage choice: `local-zfs`, `local-lvm`, or a directory storage all work. Avoid putting the container's rootfs on a network filesystem.
- Record the container root password / SSH key. Then prefer SSH keys over password login.

### 3.2 Script usage

```bash
# copy the repo's deploy/ directory to the host, then:
cd deploy
./lxc-create.sh --ctid 210 --hostname openwidgets --ip 10.10.20.15/24 --gw 10.10.20.1 \
                --storage local-zfs --disk 16 --cores 2 --memory 2048 --mode native
# Docker path:
./lxc-create.sh ... --mode docker      # adds features nesting=1,keyctl=1
```

The script prints the exact `pct exec` / `pct push` commands for the next step. It does **not** modify the host firewall or DNS — do those deliberately (§11).

### 3.3 Post-create checklist

```bash
pct exec 210 -- bash -lc 'apt-get update && apt-get -y upgrade'
pct exec 210 -- bash -lc 'hostnamectl; ip -4 addr; df -h /'
# time must be correct (exam deadlines are server-computed!)
pct exec 210 -- bash -lc 'timedatectl set-timezone Europe/Vienna; timedatectl status'
```

Time zone: the app stores ISO-UTC and formats in `Europe/Vienna` (`CONTRACT.md` §9), but **the server clock must be NTP-synced** — a drifting clock breaks `timeLimitMinutes` and `due_at`.

---

## 4. Path A (recommended): native systemd + Caddy

### 4.1 What gets installed

| Piece | Where | Why |
|---|---|---|
| Node.js **24.x** | `/usr/bin/node` (NodeSource) or `/usr/local/bin/node` (tarball) | `node:sqlite`, `fetch`, built-in test runner. Debian 12 ships Node 18.x — **the app will not even boot** (`node:sqlite` missing). |
| App code | `/opt/openwidgets` (git checkout or release tarball) | read-only for the `openwidgets` user |
| Data | `/var/lib/openwidgets` | DB + assets, owned by `openwidgets` |
| Config | `/etc/openwidgets/openwidgets.env` (0600) | secrets: admin seed, `BASE_URL`, etc. |
| Service | `/etc/systemd/system/openwidgets.service` | runs as `openwidgets`, hardened |
| Reverse proxy | Caddy from the official apt repo | TLS + SSE-safe proxy |

### 4.2 Run the provisioning script

Copy the repository (or a release tarball) to the container, then:

```bash
# inside the container, as root; run from the repo root
sudo bash deploy/provision.sh --mode native \
  --domain widgets.ms-telfs.at \
  --admin-email admin@ms-telfs.at \
  --admin-name "Administrator" \
  --admin-password 'CHANGE-ME-strong-12+-chars' \
  --tls internal            # or: --tls existing --cert /path/fullchain.pem --key /path/privkey.pem
```

What it does (idempotent — safe to re-run after failures):

1. Installs OS prerequisites (`curl`, `ca-certificates`, `gnupg`, `git`, `sqlite3`, `rsync`, `nginx`-free Caddy prerequisites).
2. Installs Node 24 (NodeSource repo) and **fails loudly** if `node -v` is not ≥ 24.
3. Creates the `openwidgets` system user, `/opt/openwidgets`, `/var/lib/openwidgets`, `/etc/openwidgets`.
4. Writes `openwidgets.env` **once** (preserves existing secrets on re-run; generates a strong `ADMIN_PASSWORD` if you didn't pass one and prints it exactly once).
5. Installs the systemd unit and enables it (not started yet).
6. Installs/configures Caddy with the school domain and the chosen TLS mode; enables it.
7. Starts the app, waits for `GET /api/health` to return 200, and prints the URL + next steps.

**There is no `npm install` step.** The app has zero runtime dependencies (`CONTRACT.md` §0). If a provisioning script ever asks npm to install runtime packages, the contract has been broken — stop and ask.

### 4.3 Manual equivalent (if you prefer to see every command)

```bash
# Node 24 via NodeSource (review the script before piping it to bash!)
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh
apt-get install -y nodejs
node -v   # must be v24.x

# user + dirs
useradd --system --home /opt/openwidgets --shell /usr/sbin/nologin openwidgets
install -d -o openwidgets -g openwidgets -m 0750 /opt/openwidgets /var/lib/openwidgets
install -d -o root -g openwidgets -m 0750 /etc/openwidgets
chmod 600 /etc/openwidgets/openwidgets.env

# code (git deploy example)
git clone https://<school-git>/openwidgets.git /opt/openwidgets
chown -R openwidgets:openwidgets /opt/openwidgets

# unit + Caddy
install -m 0644 deploy/systemd/openwidgets.service /etc/systemd/system/
install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile   # edit OW_DOMAIN / TLS first
systemctl daemon-reload
systemctl enable --now openwidgets caddy
curl -fsS http://127.0.0.1:3000/api/health
```

### 4.4 Environment file (the contract, exactly)

`CONTRACT.md` §2 is authoritative. Production values:

```dotenv
# /etc/openwidgets/openwidgets.env   (chmod 600, owner root:openwidgets)
NODE_ENV=production
HOST=127.0.0.1                # IMPORTANT: only Caddy may reach the app
PORT=3000
TRUST_PROXY=1                 # we are behind Caddy; use X-Forwarded-*
BASE_URL=https://widgets.ms-telfs.at
DATA_DIR=/var/lib/openwidgets
ADMIN_EMAIL=admin@ms-telfs.at
ADMIN_PASSWORD=...            # first boot only; then change/rotate deliberately
ADMIN_NAME=Administrator
SESSION_TTL_DAYS=14
MAX_UPLOAD_MB=10
```

Notes:

- `HOST=127.0.0.1` is a **deployment decision that matters**: the contract's default is `0.0.0.0`, which would expose port 3000 to the whole LAN if anyone bypasses Caddy. Keep it loopback.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` seed the first admin **only when the user table is empty** (`CONTRACT.md` §2). Re-running the service with different values does not change existing users.
- Rotate the seeded password after first login (UI: account settings) and remove `ADMIN_PASSWORD` from the env file afterwards (or leave it; it becomes inert once users exist — but secrets age badly).
- `BASE_URL` must match the external URL exactly (scheme+host, no trailing slash) or share links and QR codes point to the wrong origin.
- `TRUST_PROXY=1` is required for correct `Secure` cookies and client IPs behind Caddy. Do **not** enable it if you are *not* behind a proxy (a client could spoof `X-Forwarded-For`).

### 4.5 systemd hardening (already in the unit)

The shipped unit ([`deploy/systemd/openwidgets.service`](../deploy/systemd/openwidgets.service)) runs as an unprivileged user with `ProtectSystem=strict`, a single writable path (`/var/lib/openwidgets`), `NoNewPrivileges`, `PrivateTmp`, restricted address families and a read-only home. **Deliberately not set:** `MemoryDenyWriteExecute` (breaks V8 JIT) and blanket `SystemCallFilter` profiles (Node needs a broad syscall set; a too-strict filter produces mysterious crashes). Harden by restriction, not by wishful syscall lists.

Useful commands:

```bash
systemctl status openwidgets --no-pager
journalctl -u openwidgets -n 200 --no-pager
journalctl -u openwidgets -f
systemctl restart openwidgets
curl -fsS http://127.0.0.1:3000/api/health && echo OK
```

---

## 5. Path B: Docker Compose inside the LXC

Docker works, but it is a **second container runtime inside an unprivileged LXC**, and that is where the sharp edges are.

### 5.1 Required LXC features

On the Proxmox host, the container must have:

```bash
pct set 210 --features nesting=1,keyctl=1
pct reboot 210
```

- `nesting=1` — lets systemd and Docker create namespaces/procfs inside the container (Proxmox docs: nesting "expose[s] procfs and sysfs to allow nested containers. Note that systemd also uses this to isolate services").
- `keyctl=1` — lets Docker (and anything using the kernel keyring) work inside the container.
- Without these, `dockerd` fails with permission errors; without `keyctl`, Compose can fail at container start.

### 5.2 Storage driver caveat (this is the one that bites)

Docker's default `overlay2` storage driver may fail inside an unprivileged LXC depending on the host storage:

| Host storage | What usually happens | Fix |
|---|---|---|
| LVM-thin / ext4 rootfs | `overlay2` often works with `nesting=1` | default is fine |
| **ZFS** (common for Proxmox) | overlay-on-ZFS issues, xattr/whiteout errors, or "operation not permitted" | install `fuse-overlayfs`, set `"storage-driver": "fuse-overlayfs"` in `/etc/docker/daemon.json`, restart docker |
| Anything | If overlay is broken and you need a quick escape | `"storage-driver": "vfs"` — correct but **slow and disk-hungry**; treat as temporary |

`provision.sh --mode docker` detects ZFS and configures `fuse-overlayfs` automatically; it installs `fuse-overlayfs` and writes the daemon config. Verify with:

```bash
docker info --format '{{.Driver}}'
```

### 5.3 Run it

```bash
sudo bash deploy/provision.sh --mode docker \
  --domain widgets.ms-telfs.at \
  --admin-email admin@ms-telfs.at \
  --admin-password 'CHANGE-ME-strong-12+-chars' \
  --tls internal
```

This installs Docker Engine + Compose plugin, then Docker and the data-directory ownership, then brings the stack up (the provisioning script runs `docker compose ... up -d --build` itself and waits for health). To redo it by hand:

```bash
cd /opt/openwidgets
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

**Note:** `provision.sh` installs Node 24 on the *container host* in both modes. In Docker mode the app itself runs inside the container (which has its own Node), but the host Node is used by `deploy/upgrade.sh` for pre-flight checks and by optional test runs.

The compose file mounts the **host path** `/var/lib/openwidgets` into the container at `/data` (`DATA_DIR=/data` inside the image), so backups on the host and native mode share the same data location. The container runs as the image's non-root `node` user (UID 1000); the host directory must be owned by **UID 1000 as seen inside the container**, i.e.:

```bash
chown -R 1000:1000 /var/lib/openwidgets    # provisioning script does this
```

Caddy still runs **natively in the LXC** and proxies to `127.0.0.1:3000` (the compose file publishes the port on loopback only). This keeps TLS/cert pain out of Docker.

### 5.4 Docker operational commands

```bash
docker compose -f deploy/docker-compose.yml logs -f --tail=100
docker compose -f deploy/docker-compose.yml restart
docker compose -f deploy/docker-compose.yml down       # stops, keeps volume path
docker compose -f deploy/docker-compose.yml up -d --build   # after upgrade
```

**Caution:** `docker compose down -v` with a *named* volume would delete data. Our compose uses a **bind mount**, not a named volume, but never run `down -v` on a school server anyway.

### 5.5 Native vs Docker: recommendation

| | Native systemd | Docker in LXC |
|---|---|---|
| Moving parts | Caddy + Node | Caddy + Docker daemon + containerd + runc + container |
| LXC requirements | none beyond unprivileged | `nesting=1,keyctl=1` + storage driver tuning |
| Backup/restore scripts | direct `node scripts/*.mjs` | must be run inside the container (`docker compose exec/run`) |
| Upgrade | `git pull && systemctl restart` | rebuild image (`--build`) with `--pull` |
| Debugging | `journalctl -u openwidgets` | `docker logs` + `docker inspect` |
| Failure modes | few | overlayfs/seccomp/io_uring dockerd failures |
| **Verdict for one school** | **Recommended** | Supported, use only if you already standardise on Docker |

Either way, the **deployment scripts handle both modes** (`backup.sh`/`restore.sh`/`upgrade.sh` auto-detect).

---

## 6. Reverse proxy, DNS and TLS

### 6.1 DNS first

Two viable shapes:

1. **Internal only** (recommended for v0.1): `widgets.ms-telfs.at` resolves via the school DNS to `10.10.20.15`. No inbound internet exposure. Pupils access from the school network; teachers can reach it from home only via VPN (school policy).
2. **Public**: a public A record (or split-horizon: internal record + public record if you need home access). Adds attack surface; needs a proper cert and monitoring.

**Test before touching TLS:** from a pupil VLAN, `ping`/`curl -v https://widgets.ms-telfs.at` — DNS and routing are the most common deployment failures.

### 6.2 TLS options (choose honestly)

| Option | How | Pros | Cons / caveats |
|---|---|---|---|
| **A. School's existing wildcard/school cert** | Put `fullchain.pem`/`privkey.pem` on the container, `tls /etc/openwidgets/tls/fullchain.pem /etc/openwidgets/tls/privkey.pem` in the Caddyfile | Devices already trust it; no ACME dependency; works fully offline | Requires the school to own a cert (often emitted by the Land/federal provider) and to share/renew it; renewal process is manual |
| **B. Let's Encrypt, DNS-01** | Caddy obtains/renews via a DNS provider API | Works without public port 80; trusted everywhere; automatic renewal | **Stock Caddy cannot do DNS-01**: the DNS provider is a plugin that requires a custom Caddy build (`xcaddy`) or `acme.sh` + a `tls` file reload. Also needs a public domain and DNS API credentials on the box. |
| **C. Let's Encrypt, HTTP-01** | Caddy serves :80 and gets a cert | Simplest *if* port 80 is reachable from the internet | Usually **not possible** in a school network (NAT/firewall inbound closed); don't design for it |
| **D. Caddy internal CA** (default in our `Caddyfile`) | `tls internal`; Caddy generates a local root CA | Zero internet, zero cost, automatic | **Every pupil device must trust the root CA** — fine for school-managed Windows/Chromebooks via GPO/Admin console, *not* fine for BYOD or unmanaged iPads (cert warnings = pupils stop using it). `caddy trust` only installs it on the server itself. |

**Recommendation:** **A if the school has a cert, else B if a public name + DNS API is acceptable, else D only for managed devices.** Document which one you chose in the runbook. The shipped `deploy/Caddyfile` uses `tls internal` as the safe offline default and contains commented alternatives.

### 6.3 Caddy specifics that matter for this app

- **SSE must not be buffered.** The `reverse_proxy` block sets `flush_interval -1`, which makes Caddy flush immediately — without it, the live dashboard updates in chunks or not at all behind a proxy. (Our design uses SSE, not WebSocket: one-way, EventSource auto-reconnect, no upgrade handling needed.)
- **Upload size.** `request_body { max_size 12MB }` sits slightly above `MAX_UPLOAD_MB=10` so the app returns a proper `413 payload_too_large` JSON rather than Caddy's opaque error. Keep the two numbers in sync if you change them.
- **No `encode` for API paths.** Compression middlewares can buffer streams; we deliberately do not enable `encode`, which is fine on a LAN. If you add `encode zstd gzip`, verify the live dashboard still updates (the typical symptom of the bug is "SSE only updates every 15 s").
- **Security headers** (already in the Caddyfile): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal. The app itself sets a strict CSP (`CONTRACT.md` §0.4). Do **not** duplicate/override CSP in Caddy — one authority for the policy.
- **HSTS** is commented out by default: enabling `Strict-Transport-Security` with an internal CA or a cert you may have to roll back is painful (browser lock-out). Enable only with a stable public cert.
- **Do not** add `X-Frame-Options: DENY` blindly if you may later embed in an LMS iframe; use `SAMEORIGIN` now and revisit with LTI (`frame-ancestors`).

### 6.4 Firewall / ports

Inside the container:

```bash
apt-get install -y nftables   # optional; Proxmox firewall can also be used at the host
# allow 22/tcp (admin), 80/tcp, 443/tcp from the school LAN; drop the rest inbound
```

On the Proxmox host:

- Use the Proxmox firewall or your normal network policy for the container's IP.
- **Never** publish 3000 to the LAN. Verify: `ss -tlnp | grep 3000` should show `127.0.0.1:3000` only.
- If the school has an internal VLAN for pupil devices, ensure it can reach the container (routing/ACL) — this is a common "it works for me on the admin VLAN" trap.

---

## 7. First boot and admin lifecycle

1. `systemctl start openwidgets` (or `docker compose up -d`).
2. **First boot only:** if the DB has no users, the app creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` (`CONTRACT.md` §2).
3. Confirm: `curl -fsS http://127.0.0.1:3000/api/health` → `{"status":"ok",...,"db":"ok"}` (HTTP 503 if the DB probe fails — treat as unhealthy).
4. Open `https://<BASE_URL>/login`, log in, **change the password immediately** (Account settings), create teacher accounts (admin UI or `npm run admin:create -- --email … --name … --password …`).
5. Restart once more and confirm the admin was **not** re-seeded/changed (proves first-boot-only behaviour).
6. Lock the env file: `chmod 600 /etc/openwidgets/openwidgets.env`; ideally remove `ADMIN_PASSWORD` after successful first boot.

**Admin recovery** (forgotten password, no email reset in v0.1): reset via the CLI as the service user, or as admin via `PATCH /api/admin/users/:id`. **CLI scripts read `DATA_DIR` from the environment** — the systemd unit gets it from the env file, but a manual run does not, so pass it explicitly (otherwise a script would write to `/opt/openwidgets/data` instead of the real data directory):

```bash
sudo -u openwidgets env DATA_DIR=/var/lib/openwidgets \
  node /opt/openwidgets/scripts/create-admin.mjs --email admin@ms-telfs.at --name Administrator --password '<new>' 
# (exact CLI per CONTRACT.md §2 / Lead's scripts; check `--help`)
```

Document the recovery command in the school's IT runbook — a forgotten admin password on a Friday afternoon is a support call.

---

## 8. Backups (SQLite-safe)

### 8.1 Why not just copy the database file

SQLite in WAL mode keeps live state in `openwidgets.db` **plus** `openwidgets.db-wal` and `openwidgets.db-shm`. Copying only `openwidgets.db` (or `cp -r` while the app writes) can produce a **torn, inconsistent or stale** database. Two correct methods:

1. **The app's own backup script** — `node scripts/backup.mjs --out <dir>` (Lead-owned; contract says it produces "a consistent SQLite snapshot plus assets"). **Preferred**, because it knows the data layout.
2. **`VACUUM INTO`** — SQLite's documented way to write a consistent copy of a live database: `VACUUM INTO '/path/backup.db';` ([SQLite docs](https://sqlite.org/lang_vacuum.html)). It takes a read transaction snapshot, produces a compact single file, and is safe while the app is running. (Node 24 also exposes `sqlite.backup()` / `DatabaseSync` APIs if you ever script it yourself: [Node docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).)

**Never** mix methods mid-backup or copy `-wal`/`-shm` separately.

### 8.2 What to back up

| Item | Why | Method |
|---|---|---|
| `DATA_DIR` (`/var/lib/openwidgets`) — DB snapshot + `assets/` | The only irreplaceable data | `backup.sh` (calls `scripts/backup.mjs`), nightly |
| `/etc/openwidgets/openwidgets.env` | Seeds/settings/secrets — losing it means reconfiguring | Included in the host config backup (encrypted!) |
| Caddy TLS material (certs/keys) | Internal CA root key; existing cert files | Proxmox host backup / config backup |
| App code | Reproducible from git | Git is the backup; pin the deployed commit in a `DEPLOYED_VERSION` file |
| **Not needed:** Node/Caddy binaries, OS | Reproducible by provisioning script | — |

### 8.3 The backup script

```bash
sudo /opt/openwidgets/deploy/backup.sh                # default: /var/backups/openwidgets
sudo /opt/openwidgets/deploy/backup.sh --out /srv/backup/openwidgets --keep 14
```

What it does:

1. Takes an `flock` lock (no overlapping runs).
2. Runs the app's consistent snapshot (`node scripts/backup.mjs --out <staging>`; docker mode: inside the container).
3. Verifies the artifact exists, is non-empty, computes SHA-256, and if it contains a SQLite file, runs `PRAGMA integrity_check` when `sqlite3` is available (best-effort, non-fatal).
4. Moves it into the destination as `openwidgets-YYYYmmdd-HHMMSS…`, writes a `.sha256` next to it, applies retention (`--keep`, default 14), logs to the journal.
5. Optional off-site copy: `--offsite user@nas:/backups/openwidgets/` (rsync), or let Proxmox `vzdump` back up the whole container.

**Schedule (systemd timer or cron):**

```cron
# /etc/cron.d/openwidgets-backup
17 2 * * * root /opt/openwidgets/deploy/backup.sh --out /var/backups/openwidgets --keep 14 >> /var/log/openwidgets-backup.log 2>&1
```

Run it **after** the Proxmox/PBS backup window or deliberately independent of it; one nightly data backup off-box is the minimum. For a school, **two independent destinations** (local + off-box) is the realistic 3-2-1.

### 8.4 Encryption

The DB contains pupils' names, answers and (if not minimised) IPs. Options:

- Proxmox Backup Server encrypts backups client-side — use it.
- Otherwise wrap the backup with `age` or `gpg` before sending off-site (`deploy/backup.sh` documents the hook; add a `tar | age -r <pubkey>` step). Keep the private key **off the same box**.
- ZFS-at-rest encryption on the host is *not* a substitute for backup encryption (it protects a stolen disk; backups travel).

### 8.5 Restore drill (do this once per term)

The only backup that counts is one you have restored. Drill:

1. Create a scratch LXC or use the same one **outside school hours**.
2. Stop the service, take a pre-restore backup, restore the newest snapshot, start, check health, log in, open a recently used activity, verify a pupil's submitted answers exist.
3. Record the date and the restore duration in the runbook. Target: **< 30 minutes** for the whole container.

---

## 9. Restore

```bash
# stop is mandatory: restore expects the service stopped (contract)
sudo systemctl stop openwidgets            # native mode
# docker mode: sudo docker compose -f /opt/openwidgets/deploy/docker-compose.yml stop openwidgets

# safety net: back up the current (broken) state first
sudo /opt/openwidgets/deploy/backup.sh --out /var/backups/openwidgets/pre-restore

# restore (accepts a backup file or directory produced by backup.mjs)
sudo /opt/openwidgets/deploy/restore.sh --from /var/backups/openwidgets/openwidgets-<timestamp>...

# start + verify
sudo systemctl start openwidgets
curl -fsS http://127.0.0.1:3000/api/health
```

`restore.sh` will:

1. Verify the source exists and is readable; warn if the service is still running.
2. Take a pre-restore backup automatically (so a wrong restore is reversible).
3. Run `node scripts/restore.mjs --from <path>` with the correct `DATA_DIR` (docker mode: one-off container with the data volume).
4. Fix ownership (`openwidgets` / UID 1000 in docker mode).
5. Start the service (unless `--no-start`) and poll `/api/health`; on failure it prints the exact rollback command instead of pretending success.

**If the restore fails halfway:** do not run it again on the same data dir. Restore from the automatic pre-restore backup, then investigate with the backup file on a scratch container.

**Rehearsed:** this backup→restore flow was verified end-to-end on a live instance (192 KiB database + 4 uploaded assets): the restored instance answered `/api/health` and participant/response counts and assets matched the backup.

---

## 10. Upgrade

```bash
cd /opt/openwidgets
sudo deploy/upgrade.sh --branch main --test       # --test runs `node --test test/` before restarting
```

Sequence enforced by `upgrade.sh`:

1. **Pre-upgrade backup** (refuses to continue if it fails).
2. Fetch code: `git fetch && git checkout <branch> && git pull --ff-only` (or unpack a release tarball; the script supports `--tarball <file>`).
3. Syntax/pre-flight check (`node --check` on the entry module) — cheap, catches the "half-copied repo" case.
4. Optional tests (`--test`): `node --test test/` (zero deps; works on the server).
5. Restart the service (native) or `docker compose up -d --build` (docker).
6. Poll `/api/health`; **on failure, print the rollback** and leave the previous code reachable (git can `checkout` the recorded previous commit; the pre-upgrade DB backup is the data rollback).
7. Write `/opt/openwidgets/DEPLOYED_VERSION` with the commit hash + timestamp.

**Rules of thumb:**

- Upgrade **outside lesson hours**; announce it.
- **Never** upgrade Node across a major version as a side effect (e.g. 24→26). `node:sqlite` is a **Release Candidate** in Node 24 ([docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)); test a Node minor upgrade on a scratch container first.
- The DB schema has no migration framework yet (v0.1) — before any version that changes the schema, restore the pre-upgrade backup into a scratch container and test the upgrade there.
- Debian security updates are independent: enable `unattended-upgrades` for security patches, but **not** automatic Node major upgrades.

**Rollback:**

```bash
cd /opt/openwidgets && git checkout <previous-commit>
sudo systemctl restart openwidgets
# if the DB changed incompatibly: restore the pre-upgrade backup (§9)
```

---

## 11. Monitoring, logs and routine operations

What you actually need for one school (no Prometheus stack):

| Check | How | Frequency |
|---|---|---|
| App alive + DB OK | `curl -fsS http://127.0.0.1:3000/api/health` (200 = ok; 503 = DB problem). systemd `Restart=on-failure` covers crashes. | every 5 min (cron) |
| Service state | `systemctl status openwidgets` | on demand |
| Logs | `journalctl -u openwidgets` (app), `journalctl -u caddy` (proxy) | on demand; keep journald default (rotate) |
| Disk | `df -h /`, `du -sh /var/lib/openwidgets/assets` — alert at 80 % | daily |
| DB integrity | `sqlite3 /var/lib/openwidgets/openwidgets.db 'PRAGMA integrity_check;'` (stop the app for a full check, or run it on the nightly backup snapshot — preferable) | weekly (on backup) |
| WAL growth | `ls -lh /var/lib/openwidgets/openwidgets.db*` — a persistently huge `-wal` (hundreds of MB) means checkpoints are stalling | weekly |
| TLS expiry | `openssl s_client -connect localhost:443 -servername <domain> </dev/null 2>/dev/null \| openssl x509 -noout -dates` (or Caddy logs ACME renewals) | monthly |
| Backup success | latest file mtime + `.sha256` present | daily (it's a cron line) |
| Restore drill | §8.5 | per term |

A tiny cron health check that mails/logs on failure is enough:

```bash
# /etc/cron.d/openwidgets-health
*/5 * * * * root curl -fsS -m 10 http://127.0.0.1:3000/api/health >/dev/null || echo "$(date -Is) health check FAILED" | logger -t openwidgets
```

**Log retention / DSGVO:** the app should not log request bodies or tokens (`CONTRACT.md` §9). journald keeps logs ~1 month by default — decide a retention period with the school DSB, and make sure Caddy access logs (if enabled) don't contain pupil names in URLs (they shouldn't: student pages are `/a/<code>`, codes are per-assignment, not per-pupil).

**Routine calendar:** monthly — apply Debian security updates, check disk/cert/backups; each term — restore drill; each school year — export grades and run the retention purge with a dry run first (§12.5), rotate the admin password, verify DNS/cert renewals, review `DEPLOYED_VERSION` and plan upgrades.

---

## 12. DSGVO / data sovereignty for an Austrian school

> **Not legal advice.** This is a practical engineering checklist to take to the school's *Datenschutzbeauftragte:r* (DSB) and, if needed, the education authority's data-protection contact. The school — not the software project — is the **Verantwortlicher** (controller) under Art. 4(7) DSGVO.

### 12.1 Why self-hosting is simpler than it looks (and where it isn't)

**Advantages of this deployment:**

- **No processor, no AVV (Auftragsverarbeitungsvertrag) with a SaaS vendor** for the hosting itself: the school runs the software on its own infrastructure. (If backups go to an external cloud/NAS-as-a-service, *that* provider may be a processor — check separately.)
- **No third-country transfer** (Art. 44 ff. DSGVO) for the core data flow: pupils' names, answers and grades stay on the school's Proxmox host in Austria.
- **No vendor account lock-in**: the data is a SQLite file the school can read, copy and delete.

**Where it isn't automatically compliant:**

- Self-hosting does not remove the need for a **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30), **TOMs** (Art. 32), **Löschkonzept**, **Datenminimierung** (Art. 5(1)(c)) or **information of data subjects** (Art. 13) — it moves them from the vendor to the school.
- The app can store **special-category-adjacent** data (e.g. a pupil's answers reveal learning difficulties) — treat all answer data as sensitive in practice.
- Pupils are usually **minors**: information should reach parents/guardians as the school's policy requires.
- Any **external content** you embed (YouTube/Vimeo video URLs) transfers pupil IP/behaviour data to those providers — a real DSGVO issue in Austria, not a footnote.
- **AI features are deliberately absent** in v0.1. If a self-hosted LLM is ever added, it needs a fresh DSB review (purpose, model, logs, retention) even though no data leaves the building.

### 12.2 Data inventory to put in the Verzeichnis (Art. 30)

| Category | Examples in OpenWidgets | Minimisation recommendation |
|---|---|---|
| Teacher accounts | e-mail, display name, `password_hash` (scrypt), last login | Keep; no phone/address. Admin-only creation. |
| Pupil participation | **name** (typed by pupil), per-assignment random token (only SHA-256 stored), timestamps, answers, auto/manual scores | Name is necessary to give feedback; keep only for the assignment's lifetime. |
| Network metadata | **Pupils:** the participant `ip`/`user_agent` columns exist for schema compatibility but are **never populated** (stored NULL — an explicit data-minimisation decision for minors). **Teachers:** login sessions store IP/UA for session security. | Nothing to minimise for pupils: no pupil IP/UA is collected. Teacher session metadata expires with the session TTL (14 days) and is not used for analytics. |
| Teaching content | activities, stems, media, feedback | Teacher IP/content; keep. |
| Logs | service logs, Caddy access logs | no bodies/tokens; short retention (~1 month); document it. |
| Backups | full DB + assets, off-box | encrypted; same retention as primary; **deletion is hard in backups** — see 12.4. |

**Purpose and legal basis:** typically Art. 6(1)(e) DSGVO (public task / education mandate under Austrian school law, e.g. Schulunterrichtsgesetz) for the core teaching workflow; the school's legal service decides the exact wording. Don't invent consent where a legal basis already exists.

### 12.3 TOMs (Art. 32) that this deployment provides

| Measure | Where |
|---|---|
| Access control | unprivileged LXC, key-only SSH, admin-seeded accounts, no self-signup, scrypt+timingSafeEqual, HttpOnly/SameSite cookies; rate-limited login, join (30/min per IP), save (120/min per participant token) and submit (5/min per token); hard cap of 500 participants per assignment |
| Network protection | only 80/443 reachable; app on loopback; school firewall |
| Encryption in transit | TLS (see §6); HSTS once cert is stable |
| Encryption at rest | host disk encryption (ZFS/LUKS) if the school policy requires it; encrypted backups |
| Availability/backup | nightly backups + periodic restore drill; systemd restart; documented fallback (paper) |
| Data minimisation | anonymous-by-token participants; no pupil accounts or e-mail; **participant IP/UA never stored** (NULL columns); only teacher session IP/UA is recorded, for login security |
| Deletion | assignment delete cascades participants/responses; per-participant delete; **retention tooling shipped**: `scripts/prune.mjs` (offline CLI) and `POST /api/admin/purge` (online, admin session, dry-run first) — see §12.5 |
| Separation | one school per deployment (`CONTRACT.md` §0.7); no multi-tenancy mixing |
| Logging | no secrets/passwords/tokens in logs (contract); retention period documented |

### 12.4 Löschkonzept (deletion concept) — what to do in practice

1. **Per assignment:** at the end of a unit/term, the teacher (or admin) deletes or archives assignments; deletion cascades participant data (`CONTRACT.md` §5.3 `DELETE /api/assignments/:id`).
2. **Per school year:** export the grades you must legally keep into the school's official system (Sokrates/administration) **before** purging; the tool is not the gradebook of record. Then purge the previous year's participant data with the retention tooling in §12.5 (dry run first).
3. **Backups:** retention (e.g. 14 daily + 6 monthly) means deleted data may live in backups for months. Document this honestly ("Löschung in Sicherungskopien erfolgt mit Ablauf der Sicherungsrotation, spätestens nach N Monaten") — a standard, defensible statement when backups are immutable by design.
4. **Host disks:** ZFS/LVM snapshots and SSD wear mean "overwrite" is not guaranteed; full-disk encryption + crypto-shredding (destroying the key) is the honest deletion method at that layer.
5. **Access requests** (Auskunft, Art. 15; deletion, Art. 17): the admin can export/delete a participant's data via the teacher review/assignment APIs; write down the procedure in the runbook.

### 12.5 Retention in practice (shipped in v0.1)

Deleting pupil data is an operation, not a promise. Two equivalent tools ship with the app; both keep teacher-authored **activities and assignments** and remove only participant rows plus their responses/events.

**Offline / cron (CLI — also works with the service stopped):**

```bash
# 1) preview: prints the cutoff, participant count and up to 20 affected names
sudo -u openwidgets env DATA_DIR=/var/lib/openwidgets \
  node /opt/openwidgets/scripts/prune.mjs --older-than-days 365 --dry-run

# 2) delete for real (take a backup first: deploy/backup.sh)
sudo -u openwidgets env DATA_DIR=/var/lib/openwidgets \
  node /opt/openwidgets/scripts/prune.mjs --older-than-days 365 --yes
```

The CLI cutoff is each participant's `submitted_at`/`started_at` (so abandoned in-progress attempts are included too); `--include-events` additionally prunes orphan event rows. It prints what it deletes; run it after a backup (`deploy/backup.sh`).

**Online (running instance, admin session):**

```bash
BASE_URL="$(grep -E '^BASE_URL=' /etc/openwidgets/openwidgets.env | cut -d= -f2-)"
curl -fsS -X POST "$BASE_URL/api/admin/purge" \
  -H 'Content-Type: application/json' \
  -H "Cookie: ow_session=<admin session cookie>" \
  -d '{"olderThanDays":365,"dryRun":true}'    # dryRun:false performs the deletion
```

`olderThanDays` must be 1–3650 (default 30); the endpoint matches participants with status `submitted`/`graded` whose **assignment was created** before the cutoff, and returns `{participantsMatched, participantsDeleted, responses, events, cutoff}`. Take the cookie from your own admin browser session — never put the admin password in a shell history or a cron job.

**Suggested annual calendar entry (runbook):**

1. Copy the grades you must keep into the school's official system (Sokrates/administration) — the tool is not the gradebook of record.
2. Take a backup (`deploy/backup.sh`).
3. **Dry run** and review the counts/names.
4. Purge with the cutoff agreed with the DSB (e.g. `--older-than-days 365`).
5. Record date, cutoff and counts in the Löschprotokoll/Verzeichnis (evidence that deletion happened).
6. Note in the Löschkonzept that **backups still contain the deleted data** until backup rotation has passed.

Run this once per school year (e.g. at the start of the new school year); keep the current school year live for feedback.

### 12.6 Things to tell the DSB / head teacher in one page

- What data: teacher accounts; pupil names, answers, scores, timestamps; **no pupil IP/UA is collected** (the columns stay NULL), only teacher session IP/UA for login security; no pupil e-mail, no pupil accounts, no external AI, no tracking/analytics.
- Where: one school-owned LXC in Austria; no US/cloud transfer for core data; backups on school-controlled storage.
- Why: teaching and assessment (Art. 6(1)(e)); automatic grading and live monitoring are part of the teaching process.
- How long: assignment lifetime + documented backup rotation; annual retention purge with the shipped tooling (§12.5); grades copied to the official system first.
- Who can access: teachers (their own activities), admin; no cross-school access.
- Risks/measures: see TOMs table; the honest residual risk is a school-network compromise or a careless teacher sharing a code — mitigated by teacher training, code rotation per assignment, and low-stakes framing.
- Accessibility: **no conformance claim** is made; what was implemented/tested and the known limitations are documented in [`ACCESSIBILITY.md`](ACCESSIBILITY.md).

---

## 13. Troubleshooting

### 13.1 The app does not start

| Symptom | Likely cause | Fix |
|---|---|---|
| `SyntaxError: Cannot use import statement...` / `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | **Debian 12's Node 18** is in use; `node:sqlite` was added in Node 22.5 | Install Node 24 (NodeSource or tarball); `node -v` must be v24.x; check the unit's `ExecStart` path (`/usr/bin/node` vs `/usr/local/bin/node`) |
| `EACCES` on `/var/lib/openwidgets` | wrong owner (esp. after restore or in Docker/unprivileged CT) | `chown -R openwidgets:openwidgets /var/lib/openwidgets` (native); `chown -R 1000:1000` (docker) |
| `EADDRINUSE :3000` | old process still alive / another service on 3000 | `ss -tlnp \| grep 3000`; `systemctl status openwidgets`; kill the stale process |
| `database is locked` at boot | another process opened the DB (scratch container? second instance?) or a network filesystem | only one writer process; move `DATA_DIR` to local disk; check `ps aux \| grep node` |
| Unit exits 226/NAMESPACE | sandboxing path not present | ensure `/var/lib/openwidgets` exists before start; `ReadWritePaths` must match `DATA_DIR` |
| App starts but 502 from Caddy | app bound to `127.0.0.1` and Caddy configured to a different upstream, or app crashed | `curl 127.0.0.1:3000/api/health`; `journalctl -u openwidgets` |

### 13.2 Docker inside the LXC fails

| Symptom | Cause | Fix |
|---|---|---|
| `dockerd` permission errors, `operation not permitted` | missing `nesting`/`keyctl` | `pct set <ctid> --features nesting=1,keyctl=1; pct reboot <ctid>` |
| `overlay2` errors / `upper fs does not support xattr` / whiteout errors | overlayfs on ZFS/unprivileged | install `fuse-overlayfs`, set storage-driver `fuse-overlayfs`, restart docker (`provision.sh` does this) |
| `io_uring_setup: operation not permitted` | newer runc/containerd using io_uring, blocked by the LXC seccomp profile on some Proxmox/kernel combinations | **Do not disable seccomp/AppArmor** to work around it. Prefer **native mode**; or pin the docker/runc version known-good on your PVE; check Proxmox forum for your exact PVE/kernel version. |
| Container starts then dies with OOM | docker + build + app in 2 GB | use 4 GB or build images on another machine and `docker load` |
| `compose` not found | compose plugin missing | `apt-get install docker-compose-plugin` (v2) — do **not** use the old Python `docker-compose` (v1) |

**Rule:** the LXC's seccomp/AppArmor confinement is a **security boundary, not an obstacle**. If Docker needs it weakened, use the native path instead.

### 13.3 SQLite / storage issues

| Symptom | Cause | Fix |
|---|---|---|
| `SQLITE_IOERR`, `disk I/O error`, intermittent locks | `DATA_DIR` on **NFS/CIFS/OneDrive/iCloud/overlay** or a wrong mount | move data to local disk; SQLite WAL requires POSIX advisory locking + shared memory (mmap) that network/synced FS don't provide reliably |
| Huge `-wal` file, slow writes | checkpoints not running / long-lived readers / `sync=disabled` weirdness on ZFS | restart to checkpoint; keep `journal_mode=WAL` (app default); avoid `sync=disabled`; monitor `-wal`; ensure no second process holds a read transaction |
| Slow DB on ZFS | 128 KB recordsize write amplification for small SQLite pages | set `recordsize=16K` on the dataset holding the container/volume (ZFS tuning; optional but recommended) or put the DB on an ext4-backed volume |
| DB corrupted after hard power-off | no UPS, `sync=disabled`, bad storage | restore from backup (that's why they exist); consider UPS; never set `sync=disabled` for this dataset |
| `integrity_check` fails on a backup | torn copy from `cp` of a live DB | use `VACUUM INTO`/`scripts/backup.mjs` only |
| Backups take minutes and freeze the UI | synchronous `node:sqlite` in the single process | run backups outside lessons; keep DB small; consider `sqlite.backup()`-style incremental copy later |

### 13.4 Live dashboard / SSE problems

| Symptom | Cause | Fix |
|---|---|---|
| Live grid never updates, or updates only every ~15 s | proxy buffering / `encode` middleware / corporate proxy | Caddy `flush_interval -1` (shipped); remove `encode` for `/api/*`; test with `curl -N` against `/api/assignments/:id/stream` |
| Dashboard open but pupils show offline despite working | heartbeat blocked (ad blocker? CSP? different origin?) | check browser console; heartbeats are `POST /api/participant/heartbeat`; verify `BASE_URL` and mixed-content (https→http) |
| Many tabs → requests stall | browser's 6-connection limit on HTTP/1.1 per origin | serve over HTTP/2 (Caddy does, by default, with TLS); don't open many dashboard tabs |
| SSE reconnects continuously | reverse proxy timeout / idle settings | Caddy has no default idle timeout issue with `flush_interval -1`; check a middlebox/VPN |

### 13.5 TLS / certificate problems

| Symptom | Cause | Fix |
|---|---|---|
| `NET::ERR_CERT_AUTHORITY_INVALID` on pupil devices | Caddy internal CA root not trusted | install Caddy's root CA on all managed devices (GPO/MDM/Chrome policy) **or** switch to option A/B in §6.2 |
| Works on server, not on Chromebooks | Chromebooks don't trust the internal CA | Chromebooks need the root CA pushed via Admin console; otherwise use a public cert |
| `caddy` won't start | port 80/443 in use, config syntax, ACME failure | `caddy validate --config /etc/caddy/Caddyfile`; `journalctl -u caddy`; `ss -tlnp` |
| Cert renewal silently failed | DNS-01 plugin credentials/API, or HTTP-01 unreachable | check `journalctl -u caddy \| grep -i acme`; internal CA never needs renewal from outside |
| Locked out after enabling HSTS | HSTS remembered with a wrong/cert-changed host | only enable HSTS with a stable cert; clear HSTS in browser (`chrome://net-internals/#hsts`) if needed |

### 13.6 Network / access problems

| Symptom | Cause | Fix |
|---|---|---|
| Works from admin VLAN, not pupil VLAN | firewall/ACL between VLANs | open 443 from the pupil VLAN to the container; test with `curl -v` from a pupil device |
| `https://widgets...` doesn't resolve at school but resolves at home/other network | internal DNS missing/split-horizon | add A record in school DNS; check DHCP-provided DNS; flush DNS |
| Port 3000 reachable from LAN | `HOST=0.0.0.0` or docker published `0.0.0.0:3000` | set `HOST=127.0.0.1`; compose maps `127.0.0.1:3000:3000` only; firewall |
| Pupils can't join by code from home | internal-only DNS by design (v0.1) | decide with the school: VPN, or public exposure with public cert (§6.1 option 2) |
| Uploads fail with 413 | file > `MAX_UPLOAD_MB` or Caddy `request_body max_size` | raise both consistently; document the limit for teachers |

### 13.7 Unprivileged container UID mapping (bind mounts)

Inside an unprivileged LXC, container UID 1000 maps to host UID **1001000** (or `100000+uid` depending on the idmap range). If you bind-mount a host directory (e.g. a NAS path) into the container:

- Either `chown -R 100000:100000 <host dir>` (for container root) / `1001000` (for container UID 1000), or
- Use Proxmox's per-mount `idmap=` option (Proxmox VE 8.1+ supports custom idmaps), or
- Keep all data **inside the container's rootfs** (simplest; our recommendation) and back it up with `vzdump`/`backup.sh`.

A "permission denied" on a bind mount is almost always this mapping — not an app bug.

---

## 14. Operational runbook (one page to print)

**Before the first lesson with pupils:**
- [ ] DNS resolves on a pupil VLAN; TLS valid on a pupil device (not just admin laptop)
- [ ] `curl -fsS https://<BASE_URL>/api/health` → 200
- [ ] Admin password changed; teachers created; one test activity published
- [ ] Test activity joined from a pupil device, answered, submitted; live dashboard shows it
- [ ] Print view of that activity looks correct on paper
- [ ] Last night's backup exists (`.sha256` present) and a restore drill was done within the term
- [ ] Disk < 80 %; cert > 30 days; `/var/lib/openwidgets` not on a network filesystem

**During a lesson:** teacher opens link/code; if the app is down → use printed fallback; do not restart the service mid-assessment unless necessary; force-submit is in the live dashboard.

**After a lesson:** check `journalctl -u openwidgets` for errors; export grades if needed (CSV); delete/archive test data.

**Hard rule:** the tool is not the gradebook of record. Grades must reach the school's official system.

---

## 15. Quick reference

| Task | Command (native path) |
|---|---|
| Status | `systemctl status openwidgets caddy` |
| Logs (app) | `journalctl -u openwidgets -f` |
| Logs (proxy) | `journalctl -u caddy -f` |
| Health | `curl -fsS http://127.0.0.1:3000/api/health` |
| Restart | `systemctl restart openwidgets` |
| Backup | `deploy/backup.sh --out /var/backups/openwidgets --keep 14` |
| Restore | `deploy/restore.sh --from <path>` (stops/starts service) |
| Upgrade | `deploy/upgrade.sh --branch main --test` |
| Retention / DSGVO purge | `sudo -u openwidgets env DATA_DIR=/var/lib/openwidgets node scripts/prune.mjs --older-than-days 365 --dry-run` (then `--yes`; see §12.5) |
| DB shell (read-only!) | `sudo -u openwidgets sqlite3 /var/lib/openwidgets/openwidgets.db 'PRAGMA integrity_check;'` |
| Disk usage | `du -sh /var/lib/openwidgets /var/lib/openwidgets/assets` |
| WAL size | `ls -lh /var/lib/openwidgets/openwidgets.db*` |
| Cert dates | `openssl s_client -connect localhost:443 -servername <domain> </dev/null 2>/dev/null \| openssl x509 -noout -dates` |
| Docker mode equivalent | prefix with `docker compose -f /opt/openwidgets/deploy/docker-compose.yml`; backup/restore/upgrade scripts auto-detect |

**Environment variables** (contract, production values): see §4.4 and [`CONTRACT.md`](CONTRACT.md) §2. **Never** commit secrets; the env file is `0600 root:openwidgets`.

---

## 16. Sources

- Proxmox VE — Linux Container (unprivileged, nesting, AppArmor/seccomp, cgroups, mount points): https://pve.proxmox.com/wiki/Linux_Container
- Proxmox VE — `pct` reference: https://pve.proxmox.com/pve-docs/pct.1.html
- Proxmox VE — Firewall: https://pve.proxmox.com/wiki/Firewall
- Node.js 24 — `node:sqlite` (Stability 1.2, Release candidate; added v22.5): https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Node.js release schedule: https://nodejs.org/en/about/previous-releases
- Debian 12 `nodejs` package (v18.x — why the distro package is unusable): https://packages.debian.org/bookworm/nodejs
- NodeSource distributions: https://github.com/nodesource/distributions
- Caddy — Automatic HTTPS (`tls internal`, ACME; DNS challenge needs a custom build): https://caddyserver.com/docs/automatic-https
- Caddy — `reverse_proxy` (`flush_interval`): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy — install: https://caddyserver.com/docs/install
- Docker Engine on Debian: https://docs.docker.com/engine/install/debian/
- fuse-overlayfs: https://github.com/containers/fuse-overlayfs
- SQLite — `VACUUM INTO`: https://sqlite.org/lang_vacuum.html
- SQLite — WAL mode and its limits: https://sqlite.org/wal.html
- systemd — service sandboxing directives: https://www.freedesktop.org/software/systemd/man/systemd.exec.html
- DSGVO (Regulation (EU) 2016/679): https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Austrian Data Protection Authority (Datenschutzbehörde): https://www.dsb.gv.at/
