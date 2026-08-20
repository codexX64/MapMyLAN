# MapMyLAN — redesigned version + equipment connectivity

Complete project, ready to rebuild. No secrets included (.env excluded).

## Interface
- Two appearances of a single visual language: light by default, dark as an
  option, toggle in the top right. The three old themes are gone; a preference
  saved as "glass" or "enterprise" falls back cleanly.
- 38 icons drawn for the app, rendered inline and mathematically recentered
  within their box. No more sprite: the icon shift under Safari can no longer
  occur.
- French / English with a selector, preference remembered. French by default.
  The shell and the equipment screen are translated; the labels internal to the
  other pages migrate key by key without breaking anything.
- Map: dotted grid, solid line for wired, dashed for wireless, neutral color
  except on the selected link.
- Notifications: a third state, "activating," between inactive and active, for a
  channel whose token is saved but which has not transmitted anything yet. It
  switches to active on its own at the first successful send.

## Network equipment connectivity (new "Network equipment" screen)
- Nine manufacturers: UniFi (local API), Asus-Merlin, OpenWrt, RouterOS,
  pfSense, Cisco IOS, Zyxel, EdgeOS, and a generic SSH profile.
- The screen shows the capabilities declared by each adapter (block, isolate,
  list clients, read ARP, reboot…): no button promises an action the hardware
  cannot perform.
- Automatic recognition of the manufacturer from the SSH banner or the HTTP
  response, connection test, and two "what the equipment sees" views: associated
  clients and ARP table — the latter catches the silent devices the scan misses.
- Credentials are encrypted at rest and never come back out of the API.

## Underlying fixes
- arp-scan: cascading fallback (explicit interface → kernel neighborhood →
  router's ARP table) instead of a hard failure, plus the required setcap in the
  image.
- IP duplicates: a deduplication service that merges entries for the same IP,
  keeping the most relevant one; the scanner falls back to the IP when the MAC
  changes, instead of creating a new entry.

## Database
No migration to run by hand: `prisma db push` at container startup creates the
new fields of the SshDevice model (transport, apiBaseUrl, site, verifyTls).

## Hardware identification (rewritten)
The type guesser moves from a cascade of regexes to a scoring system
(`backend/src/services/classify.ts`). Each signal — OUI vendor, mDNS service,
open port, nmap banner, system, NetBIOS, hostname — votes with a weight for one
or more types; the highest-scoring one wins, and a confidence of 0..1 is computed
from its share and its margin over the runner-up. Twenty types distinguished
instead of nine: nas, hypervisor, docker, pi, camera, tv, console, voip, printer,
tablet… The confidence is stored in the metadata and shown in the map's tooltip
("docker · 62%"). A device with no signal stays "unknown" with confidence 0
rather than being filed at random.

## Map (improved)
- Automatic layout aligned with your addressing convention: the third octet sorts
  nodes by tier (infra, dockers, inference, workstations), the wifi face (tens
  digit) falls back into the category of its machine, and each tier is sorted by
  last octet so that the two faces of the same device sit next to each other.
- Nodes reuse the single icon set: camera, NAS, Pi, printer, television, and
  console finally have their own drawing instead of the generic question mark.

## Discovery fixes (this iteration)
- **ARP duplicates**: an IP that answers with several MACs (arp-scan's "DUP: n"
  lines) no longer creates several devices. The parser groups by IP, keeps the
  MAC whose vendor is identified, and retains the others as secondary cards of
  the same device.
- **Subnet filter**: sorting was done on a three-octet prefix ("10.0.2."), which
  silently discarded anything spilling over onto a /22 or wider. Replaced with a
  real CIDR membership test.
- **Gateway**: a device that carries the default route's address, or is flagged
  as the main router in the database, is classified as "router" with a confidence
  of 0.97 regardless of its ports. Without this rule, a box exposing SMB showed
  up as a "Windows PC."
- **Box OUIs**: TP-Link, Freebox, Livebox, Bbox, Technicolor, Sagemcom, and
  Arcadyan recognized as routers.
- **Switch ranges**: Zyxel switches (GS/XGS/XS/MG) are distinguished from its
  firewalls (USG/ZyWALL), and TP-Link's TL-SG/TL-SF ranges are no longer confused
  with its boxes.

## Inferred map (new)
Automatic construction no longer attaches devices "to the hub of the same /24."
It applies the addressing convention:

- root = gateway (main router flag, or default route);
- switches, access points, and secondary routers hang off the gateway;
- a device whose third octet is below 10 is wired: it goes through the switch if
  one exists, otherwise directly through the gateway — this is the inference "not
  seen directly by the gateway, therefore behind the switch";
- a device whose third octet is above 10 is wireless: it is attached to the
  access point, or failing that to the secondary router acting as one;
- two entries of the same category and the same last octet are the two faces of a
  single box: they remain two distinct nodes, each linked to its own equipment,
  plus a very discreet "sibling" link that expresses the kinship.

Hand-drawn links are never overwritten. Once the UniFi controller is in place,
real querying (switch port, association access point) will replace the inference,
which will remain as a fallback.
