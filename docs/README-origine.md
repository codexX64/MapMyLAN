# MapMyLAN

Self-hosted network observability and active defense platform.

Discovers every device on your LAN, scores them on trust/activity/vulnerability/danger,
draws an interactive topology map with zones and typed links, and can ban or
quarantine threats via SSH on your main router. Comes with a Telegram bot you can
program with custom commands like `/alert` to lock everything down remotely.

## Features

- **Discovery**: arp-scan, nmap, mDNS, NetBIOS, SNMP, UPnP — fuses all sources for
  reliable vendor / model / OS identification
- **Scoring**: 4-axis scoring (trust, activity, vulnerability, danger) with live
  dashboard sparklines
- **Topology map**: drag-and-drop devices, draggable zones with color palette
  and border styles, typed links (ethernet / wifi / vpn / trunk / wan / docker)
  with directional flow arrows, right-click drag to create links
- **Active defense**: real ban/quarantine via SSH on your router (Asus-Merlin,
  MikroTik, OpenWrt, pfSense, Cisco, UniFi, generic)
- **Notification commands**: 50+ trigger catalog ("when device.new → notify
  Telegram"), with cooldown, filters, custom message templates
- **Bot commands**: define `/alert`, `/lockdown`, `/scan`, custom SSH commands
  — runs from your Telegram chat with Y/N confirmation for destructive actions
- **Multi-NIC**: a single device can hold multiple interfaces (Wi-Fi + Ethernet)
  with the option to merge duplicate scan entries
- **3 themes**: Modern (emoji-rich glass), Minimal (sober monochrome),
  Enterprise (Cisco DNA-style)
- **Host monitoring**: CPU / memory / disk / temperature / network / Docker
  containers on the host machine

## Quick start

Requirements: a Linux host with Docker 20.10+ and Docker Compose v2.
The installer will offer to install Docker if it's missing.

```bash
# unzip the release
unzip mapmylan.zip
cd mapmylan

# run the installer
chmod +x install.sh
./install.sh
```

The installer auto-detects your LAN subnet, generates fresh secrets in `.env`,
builds the images and starts the stack. At the end it prints the dashboard URL
and the auto-generated admin password.

Open the dashboard, log in, complete the onboarding wizard, configure your
router SSH credentials, and you're up.

## Useful commands

```bash
docker compose logs -f          # follow logs
docker compose restart          # restart everything
docker compose down             # stop
docker compose up -d            # start
./install.sh                    # re-run installer (safe; reuses .env)
./install.sh --reset            # wipe Postgres + Redis volumes and start fresh
./install.sh --no-build         # skip rebuild
```

## File layout

```
mapmylan/
├── install.sh              ← runs everything
├── docker-compose.yml      ← reads .env, defines all 4 services
├── .env                    ← auto-generated on first install (chmod 600)
├── README.md
├── backend/
│   ├── Dockerfile          ← node:20-bookworm-slim + nmap, arp-scan, ssh,
│   │                         avahi, smbclient, snmp, curl, ncat
│   ├── prisma/schema.prisma
│   ├── package.json
│   └── src/
│       ├── index.ts        ← Express + Socket.IO server
│       ├── db.ts           ← Prisma client
│       ├── routes/         ← REST API
│       ├── services/       ← scanner, scoring, defense, enrichment,
│       │                     topology, ssh, notifier, commands,
│       │                     botCommands, host, vlanProvision
│       ├── workers/        ← cron scheduler
│       └── ws/             ← realtime websocket bus
└── frontend/
    ├── Dockerfile          ← node:20-alpine builder → nginx:alpine
    ├── nginx.conf          ← serves /api/* → backend on host
    ├── package.json
    └── src/
        ├── App.tsx
        ├── api/            ← REST + WS client
        ├── stores/         ← Zustand global store
        ├── components/
        │   ├── layout/AppShell.tsx
        │   ├── device/DeviceDrawer.tsx
        │   ├── topology/TopologyMap.tsx
        │   └── ui/         ← shared primitives, icons
        ├── lib/themes.ts
        └── pages/index.tsx ← all routed pages
```

## How it works

- **Postgres** stores devices, interfaces, ports, CVEs, history, alerts,
  topology links, zones, VLANs, SSH-managed devices, security rules,
  notification configs, notification commands and bot commands.
- **Redis** is reserved for future job queues and rate limiting.
- **Backend** runs on host networking so it can issue raw ARP scans and ping
  sweeps on the real LAN. `cap_add: NET_ADMIN, NET_RAW` lets non-root code
  run nmap and arp-scan.
- **Frontend** is a Vite-built React SPA served by nginx. The nginx config
  proxies `/api/*` to the backend on `172.17.0.1:4000` (the host bridge
  gateway, since backend uses `network_mode: host`).
- **Scanner** runs every `SCAN_INTERVAL` seconds (default 300s).
- **Enrichment** runs every 2 minutes against devices with missing or weak
  vendor information.
- **Topology auto-build** is **only** triggered by explicit user action — it
  never runs on a timer, so your manual links are safe.
- **Scoring + rules** run every minute and may auto-ban/quarantine devices
  according to user-configured rules.
- **Telegram bot** long-polls Telegram for incoming messages and answers
  built-in commands as well as user-defined `/xxx` commands.

## Security

- All secrets (router SSH passwords, Telegram tokens, SMTP credentials) are
  stored encrypted at rest with AES-GCM using `MASTER_KEY` from `.env`.
- The main router is protected: cannot be banned, quarantined, deleted or
  merged from the UI or the bot.
- Destructive bot commands (`lockdown`, `unlock_all`, `ban_*`, `exec_ssh`)
  require an explicit Y/N reply within 30 seconds before executing.
- Bot commands are restricted to the primary chat ID by default; additional
  chat IDs can be allowlisted per-command.

## Updates

To pull in new code:
```bash
# stop, replace files, rerun installer (which rebuilds)
docker compose down
# replace project files with the new release
./install.sh
```

Existing data in Postgres and Redis is kept across updates.
The DB schema is automatically synced on backend boot via `prisma db push`.

## License

Private project — not for redistribution.
