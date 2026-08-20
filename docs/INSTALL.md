# Detailed installation guide

## 1 · Choose the machine

MapMyLAN must be **on the segment it monitors**. ARP scanning does not cross
routers: a machine placed behind a routing hop will only see its own segment.

Prefer a wired connection. Over Wi-Fi, client isolation — often enabled by
default on access points — prevents it from seeing the other devices.

## 2 · Get the project

```bash
git clone https://github.com/CodexX64/mapmylan.git
cd mapmylan
cp .env.example .env
```

## 3 · Generate the secrets

Three secrets are required. Do not reuse ones from another project.

```bash
{
  echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
  echo "JWT_SECRET=$(openssl rand -base64 48)"
  echo "MASTER_KEY=$(openssl rand -base64 32)"
  echo "PASSWORD_PEPPER=$(openssl rand -base64 32)"
} >> .env
```

Then remove the original blank lines to avoid duplicates.

> `MASTER_KEY` encrypts the credentials of your network equipment. Losing it
> makes them unrecoverable: you would have to re-enter them. Back it up somewhere
> other than the machine.

## 4 · Declare the network interface

```bash
ip -o link show | awk -F': ' '{print $2}'
```

Enter the name in `SCAN_INTERFACE`. On a machine with several interfaces, choose
the one that carries the network to monitor — not a Docker interface, not a
tunnel interface.

## 5 · Start

```bash
docker compose up -d --build
docker compose logs -f backend
```

Wait for the line announcing that it is listening, then open
`http://localhost:8120`.

## 6 · Follow the wizard

**Administrator account.** Choose a long passphrase rather than a short,
complicated password: length matters more than variety.

**Authentication.** The password alone is enough on a closed network. As soon as
access leaves your home, add at least a second factor.

**Network equipment.** The form adjusts to the manufacturer.

*For UniFi*, first create a **local** account on the console, under
*Settings → Admins & Users*, with the local access option enabled. Then enter the
gateway address, port 443, and these credentials. Since the certificate is
self-signed, leave TLS verification disabled.

*For manufacturers over SSH*, check that the service is enabled on the equipment
and that the account has write permissions — otherwise reading will work but
blocking will fail.

**Ranges.** Declare everything your network actually contains. A forgotten range
is a slice of the network left invisible.

**Alerts.** A messaging bot warns you within seconds; email leaves a written
trace. A second address dedicated to password resets limits the damage if the
sending mailbox is compromised.

## 7 · After installation

- Clear `DEFAULT_ADMIN_PASSWORD` if it was used.
- Back up `MASTER_KEY` off the machine.
- Create a first defense rule: without one, nothing will be blocked
  automatically.

## Troubleshooting

**The scan finds only one host.** The interface is probably wrong, or the
declared range does not match the real network. Check with `ip addr` and
`ip route`.

**"Connection lost before handshake."** An SSH channel is being opened to a port
that speaks HTTPS. Check the manufacturer selected: UniFi goes through the API,
not SSH.

**UniFi credentials rejected.** The account used is an online Ubiquiti account.
The local API only accepts local accounts.

**The password comes back after a restart.** `DEFAULT_ADMIN_PASSWORD` is set in
`.env` and is reapplied on every start. Clear it.
