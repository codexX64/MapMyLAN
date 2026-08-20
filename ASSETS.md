# ASSETS.md — Inventory of assets and data (GOV-002)

Reference inventory for MapMyLAN: exposed routes, data stores and their
sensitivity, third-party services and the keys used, and the location of every
secret. To be kept up to date with each new feature.

_Last revised: 2026-08-18 (security audit)._

## 1. Exposed surfaces

| Surface | Detail |
|---------|--------|
| Frontend | Static SPA served by nginx (published port `8090:80`). Security headers + CSP set by nginx. |
| API | `/api/*`, proxied by nginx to the backend `:4000`. Every route except `/api/health` and `/api/auth/login` requires a session. |
| Real time | WebSocket `/ws` (socket.io), authenticated by the session cookie (signature + token version check). |
| Database | PostgreSQL, published on `127.0.0.1:5432` only. |
| Cache | Redis, published on `127.0.0.1:6379` only. |
| Docker socket | Never mounted into the backend: read-only access via `docker-socket-proxy` (`127.0.0.1:2375`, `CONTAINERS=1` only). |

### API routes (prefix `/api`)

| Mount | Auth | Role required |
|---------|------|-------------|
| `/auth` (`login`, `logout`, `change-password`) | public / session | — |
| `/devices` | session | mutations open to authenticated users |
| `/vlans` | session | — |
| `/ssh` | session | `admin` (create/delete), `admin`+`operator` (exec) |
| `/topology` | session | — |
| `/host` | session | — |
| `/commands` | session | `admin` (create/edit/delete/trigger) |
| `/bot-commands` | session | `admin` (create/edit/delete/execute) |
| `/router` | session | `admin` |
| `/` (system: stats, settings, notifications, rules, alerts, logs, setup) | session | `admin` on sensitive writes |

## 2. Data stores and sensitivity

| Prisma model | Content | Sensitivity |
|---------------|---------|-------------|
| `User` | credentials (Argon2id hash + pepper), role, token version, lockout | **High** (authentication) |
| `SshDevice` | equipment host/port/user + **encrypted** secrets (`passwordEnc`, `privateKeyEnc`, `passphraseEnc`, AES-256-GCM) | **Critical** (router access) |
| `Device`, `Interface`, `Port`, `CveMatch`, `DeviceHistory` | network inventory (IP, MAC, names, CVE) | Medium (personal data under GDPR: mapping of a network) |
| `TopologyLink`, `Zone`, `Vlan` | topology and segmentation | Low |
| `Alert`, `LogEntry`, `ScanRun`, `HostMetric` | events, logs, metrics | Low→Medium (logs contain no secrets) |
| `Setting`, `NotificationConfig` | settings; `NotificationConfig` holds notification keys (Telegram token, SMTP, Twilio) | **High** (third-party keys) |
| `BotCommand`, `NotificationCommand`, `SecurityRule` | admin-defined automations (including `exec_ssh`) | High (can trigger actions) |

## 3. Third-party services and keys used

| Service | Use | Key / secret | Where |
|---------|-------|--------------|-----|
| Telegram Bot API | notifications + command bot | bot token | `NotificationConfig` (database), called server-side only |
| SMTP (nodemailer) | alert emails | SMTP credentials | `NotificationConfig` |
| Twilio | alert SMS | SID + auth token | `NotificationConfig` |
| Network equipment (SSH/UniFi) | scan, defense, provisioning | encrypted credentials | `SshDevice` (`*Enc`, AES-256-GCM) |
| SYNAPSE (homelab edition only) | sending internal events | `SYNAPSE_TOKEN` (Bearer) | environment variable; URL restricted to the internal network |

No third-party key is exposed to the browser. No secret `VITE_*` variable is
compiled into the bundle.

## 4. Secrets and their location

| Secret | Role | Location | Rotation |
|--------|------|-------------|----------|
| `JWT_SECRET` | signing session tokens | environment (`.env`) | invalidates all sessions |
| `MASTER_KEY` | derives the AES key for equipment credentials | environment | loss = credentials unrecoverable |
| `PASSWORD_PEPPER` | HMAC pepper for passwords | environment (outside the database) | changes the hash of every password |
| `POSTGRES_PASSWORD` | database access | environment | — |
| `DEFAULT_ADMIN_PASSWORD` | regaining control of the admin account | environment (empty in normal operation) | to be cleared again after use |
| `SYNAPSE_TOKEN` | ingestion Bearer (homelab) | environment | per service |

All live in the environment / a secrets manager, never in the repository.
`.gitignore` excludes `.env`, `.env.*`, `*.pem`, `*.key`, dumps, and logs.

## 5. Trust boundaries (reminder)

browser → nginx (CDN/edge) → backend → database; backend → third-party APIs;
providers (Telegram webhook) → endpoints; imported files → processing → other
browsers. Each arrow is a point of validation/authentication/authorization,
regardless of what the sender promises.
