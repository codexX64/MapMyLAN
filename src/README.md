# Provided modules

These files are meant to be dropped into the project's tree. They do not
constitute a standalone application.

| File | Destination | Role |
|---|---|---|
| `password.ts` | `backend/src/services/` | Argon2id hashing, transparent bcrypt migration, constant-time comparison |
| `detourage.ts` | `frontend/src/lib/` | Dependency-free image cutout, by diffusion from the edges |
| `DevicePhoto.tsx` | `frontend/src/components/device/` | Importing and cutting out a device photo |
| `WorldTrafficView.tsx` | `frontend/src/components/world/` | Orthographic globe and connection log |
| `ticket.ts` | `backend/src/services/` | Building the structured ticket and its transports |
| `alerte.ts` | `backend/src/services/` | Routing alerts to the channels, according to the format of each |
| `extensions.ts` | `backend/src/services/` | Hook point for optional extensions |

## Dependency to add

`password.ts` requires:

```bash
npm install @node-rs/argon2
```

This implementation provides precompiled binaries, unlike the `argon2` package,
which requires a compilation toolchain in the Docker image.

## Alerts

`ticket.ts` produces a normalized object rather than a sentence: severity,
affected device, metrics, and grouping key are separate fields, which lets a
ticketing system create the ticket without interpreting the text.

**The human-readable format is the default.** The structured format is only used
if a ticketing system is connected: sending JSON to someone reading their mail
would be a regression. Each channel has its own setting, and the bot always stays
readable — nobody reads JSON on their phone.

Ticketing is optional. Without it, alerts still go out through the other
channels. If it responds, the ticket reference is cited in the messages meant for
humans; if it fails, the other channels go out regardless.

Urgency is derived from a matrix crossing impact and scope. An unreachable
gateway is blocking at the scale of the site, hence P1; a port opening on a
machine concerns that machine, hence P4. Nothing is left to the sender's
judgment, which prevents an automated system from declaring itself at maximum
priority.

The grouping key combines the nature of the event and its subject, with no
timestamp: a recurring incident increments a counter instead of creating a
hundred tickets.

The name of the header carrying the key is configurable, and so is the
destination address. The module therefore makes no assumption about the ticketing
system in use.

## Extensions

`extensions.ts` loads whatever the `extensions/` folder at the root contains. An
extension is recognized there by its mere presence: nothing to declare, nothing
to recompile.

This mechanism avoids maintaining two versions of the code for two uses. An
installation that wants to graft in particular behavior drops in its module; the
others have nothing to do, and the shared code stays identical.
