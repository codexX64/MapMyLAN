# Reporting a vulnerability

Please **do not open a public issue** for a vulnerability.

Instead, write to the address listed on the
[CodexX64](https://github.com/CodexX64) profile, or use GitHub's private
reporting form under the *Security → Report a vulnerability* tab.

Where possible, include the version, the reproduction conditions, and the impact
you estimate. You will receive a response within a week.

## Scope

MapMyLAN handles network equipment credentials and can cut off devices' access.
The following are of particular concern:

- authentication bypass, in any form;
- access to stored equipment credentials;
- execution of defensive actions without authorization;
- command injection through the SSH adapters;
- privilege escalation between roles.

## Out of scope

- Attacks that require physical access to the host machine.
- Self-signed equipment certificates, which are unavoidable on a local network.
- Exposing the bare application on the Internet: it is not designed for that,
  and the documentation says so.

## What the project guarantees

No software can claim to be free of vulnerabilities. What is guaranteed is how
reports are handled and how fixes are published.

## Security — status of fixes

The weaknesses identified while assembling this repository have been fixed in the
code. What follows describes what is in place, and what is not.

### Fixed

| Item | Before | Now |
|---|---|---|
| Password change | accessible without a token, identifier taken from the body | requires a token, operates on the bearer's account |
| Hashing | bcrypt — truncates at 72 bytes, fits in 4 KiB | Argon2id, 32 MiB and 3 passes, transparent migration |
| Content policy | disabled | enabled, sources restricted to the application |
| Attempt limiter | blind behind a proxy | `trust proxy` set, two separate ceilings |
| Account lockout | absent | progressive: 1 min after 5 failures, 15 min after 10 |
| Token revocation | impossible before expiry | version carried by the token, incremented on every change |
| Account enumeration | distinct response times | comparable timing, identical message |
| Request size | 5 MB | 512 KB |

A password change invalidates all open sessions: a password changed because it
is believed compromised must not leave tokens issued beforehand alive.

### Not covered

These items call for an operational decision, not a line of code.

- **Public exposure.** The application is not designed to be reached bare from
  the Internet. Place it behind authenticated access.
- **Transport encryption.** Handled by the proxy in front of it, not by the
  application.
- **Backing up `MASTER_KEY`.** Losing it makes equipment credentials
  unrecoverable.
- **Second factor.** Available but not enabled by default.

### What cannot be guaranteed

No software is free of vulnerabilities, and claiming otherwise would be
dishonest. What is established here is that the project's known weaknesses have
been addressed, and that each fix has been verified. An unknown flaw remains
possible: that is true of all software, including software that is continuously
audited.

## Exploitable flaws — remediation

### Fixed

| Flaw | What it allowed | Countermeasure |
|---|---|---|
| Command injection via the address | A device announcing `192.0.2.1; command` caused code to run on the router, as root | Strict validation of the IP and MAC before construction, plus a guard at the execution point that rejects any chaining character |
| Injection via the hostname | Names come from mDNS, NetBIOS, and DHCP — announced by the device. Injection into the logs, the interface, the database | Sanitized at the scanner's input: control characters, direction marks, and invisible spaces stripped, length bounded |
| Server-side request forgery | The API address was free-form: the backend could be pointed at an internal service or a cloud metadata endpoint | The address must designate the registered equipment, with no path, no parameter, no credentials |
| Missing or guessable secrets | An empty `JWT_SECRET` allowed any token to be forged | Refusal to start, with the generation commands displayed |
| Vulnerable dependencies | Seven high-severity flaws, including an SMTP command injection | Updates applied, no high or critical remaining |

Protection against command injection is placed at **two levels**: at the source,
where the address is recognized as such or rejected, and at the execution point,
where any command containing a chaining character is rejected. Placing the check
at the single point of passage covers the twenty-four actions of the nine
drivers; placing it in each driver would have let through the one that gets
forgotten.

### Not fixable

These items are not defects but a choice, an environmental constraint, or an
operational decision.

| Item | Why it remains | What contains it |
|---|---|---|
| SSH console | Running commands is its very purpose. Removing it would mean removing the feature | Reserved for the administrator role; every action is logged |
| Equipment TLS verification | Routers present self-signed certificates. Requiring it would prevent any connection | Only affects the local network; fingerprint pinning is still to be done |
| Container on host networking | ARP scanning does not work otherwise: it is a constraint of the protocol | Reduced surface, dependencies kept up to date |
| Stolen administrator session | An administrator account can legitimately do anything | Second factor available, tokens revocable, lockout after failures |
| Loss of `MASTER_KEY` | Encryption at rest only makes sense if the key lives elsewhere | Backup is the operator's responsibility |
| Direct public exposure | The application assumes controlled access upstream | To be placed behind an authenticated tunnel or a VPN |
| Unknown vulnerability | No software is free of them | Dependencies kept up to date, reduced surface, documented reporting |
