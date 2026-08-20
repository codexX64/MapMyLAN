# State of this repository

This file is intended for the maintainer. It documents what is in the repository
and what is not yet.

## What is present

The backend and frontend code corresponds to a version **earlier** than the last
one deployed. It is functional, but several pieces of work carried out after this
snapshot are not in it.

## What is missing

The following items exist on the production installation and must be recovered
before the repository can be considered complete.

### Backend

| File | What it provides |
|---|---|
| `src/services/poste.ts` | Sending alerts to the messaging service |
| `src/services/mailbox.ts` | IMAP and SMTP verification with no dependency |
| `src/services/totp.ts` | Second factor, built on Node's crypto module |
| `src/routes/mail.ts` | Mailbox management |
| `mail-providers.js` | Provider catalog, shared with the frontend |

### Frontend

| File | What it provides |
|---|---|
| `src/components/layout/WorkshopShell.tsx` | Dense layout, known as "workshop" |
| `src/pages/FirstRun.tsx` | Account creation on first launch |
| `src/pages/ResetPassword.tsx` | Two-factor reset |
| `src/components/security/TotpPanel.tsx` | Second-factor enrollment |
| `src/components/scan/ScanRangesPanel.tsx` | Multiple scanned ranges |
| `src/components/mail/MailboxPanel.tsx` | Mailboxes |
| `public/` | Favicons and provider catalog |

### Security fixes

They have been applied. See [SECURITY.md](../SECURITY.md) for details.


## Fix not applied

`docs/patch-v29/` contains a UI fix that has not been applied to the current
code. Check its relevance before using it: it targets a version whose exact state
is uncertain.

## Before publishing

```bash
grep -rioE "POSTE_SEND_KEY=.+|relay_[a-z0-9]{10,}|sk_[A-Za-z0-9]{10,}" . \
  --include='*.ts' --include='*.tsx' --include='*.yml' --include='*.json'
```

No secret was found in the sources at the time this repository was assembled, and
no `.env` file is present. Even so, run this check again after adding the missing
files: a secret pushed to a public repository remains in the history even after
deletion, and requires rewriting that history **and** revoking the key.

## Two editions, one codebase

The public edition — **MapMyLAN Codex64** — contains no connector specific to a
particular installation. The **REDACTED** edition is not a separate codebase: it is
the same application, with modules dropped into `extensions/`.

The connector to the knowledge base (`memoire.ts`) has therefore been removed
from this repository. It must be adapted into an extension — that is, it must
expose `surAppareil`, `surBalayage`, and `surAlerte` rather than being called
directly from the scanner, then dropped into the `extensions/` folder of the
installation concerned.

This split avoids maintaining two divergent versions. A fix applied here benefits
both.

## Naming adopted

The public repository is hosted at `CodexX64/mapmylan` and the demo at
`demo.codex64.fr/mapmylan`.
