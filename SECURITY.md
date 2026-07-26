# Security & Confidentiality

This add-in is designed for drafting confidential, often unpublished, technical
and patent content. The core guarantee is that **document content never leaves
the user's machine.**

## Data flow

- All processing — formula formatting, equation (OMML) generation, 2D structure
  rendering (OpenChemLib), molecule building, spectra prediction, sequence
  analysis, statistics and citation parsing — happens **locally in the Word
  webview**. **No document content is transmitted anywhere, ever.**
- There are **no analytics and no telemetry**.

### Every network destination, exhaustively

The add-in reaches exactly three hosts. This list is enforced by
`src/lib/__tests__/networkSurface.test.ts`, which scans the source for network
primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`)
and fails the build on any call site or destination not listed here.

| Destination | When | Carries | Consent |
|---|---|---|---|
| `appsforoffice.microsoft.com` | Every pane load | Nothing — it is a script tag for office.js, required of all Office add-ins | n/a |
| Your own host (`version.json`) | Every pane open | Nothing. A same-origin GET whose response drives the "update available" banner. Your host sees the request's IP, user agent and timing, as it does for every other file it serves you | n/a — no content leaves |
| `www.ebi.ac.uk/opsin` | Only when the user clicks **Look up online** in Chemical mode | One chemical **name**, typed by the user. Never a structure, never document text | Explicit, per name — see below |

### The OPSIN exception

Chemical mode can resolve an IUPAC name to a structure using EMBL-EBI's public
OPSIN service. This is the **only** feature that sends anything off the machine,
it is never automatic, and it sends a single chemical name — nothing else.

Consent is **per name**. The pane asks before any name it has not already sent in
this session, and the confirmation shows the exact name. Looking the same name up
twice does not ask twice, because nothing new leaves the machine; typing a
different name always asks again.

If your matters are confidential enough that even a compound name is sensitive,
do not use this button — every other chemistry feature works entirely offline
from a name in the built-in dictionary, a SMILES string, or a drawn formula.

## Local storage

- **Search/recents/favorites** and the **equation-numbering counter** are stored
  in the webview's `localStorage` (origin = your hosting URL). This persists
  recent formulas/compound names and favorites between sessions.
- A **"Clear recents & favorites"** control removes this data. On shared or kiosk
  machines, advise users to clear it, or scope hosting per-user.

## Recommended hardening (validate in Word during pilot)

- **Content-Security-Policy.** Add a CSP `<meta>` to `taskpane.html` /
  `commands.html` once validated against the target Office builds, e.g.:

  ```html
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self';
                 script-src 'self' https://appsforoffice.microsoft.com;
                 style-src 'self' 'unsafe-inline';
                 img-src 'self' data:;
                 connect-src 'self';
                 frame-ancestors https://*.officeapps.live.com https://*.office.com;" />
  ```

  `connect-src 'self'` is the key control: it blocks any data exfiltration. **Test
  in Word desktop, Mac, and web before enabling** — an over-strict CSP can break
  office.js. It is intentionally **not** enabled by default to avoid breaking a
  working install.

## Dependencies

- Runtime dependencies that ship in the bundle: **OpenChemLib** (BSD-3-Clause)
  and **core-js** (MIT). Both are permissive and redistributable. See
  `THIRD_PARTY_LICENSES.md`.
- `package-lock.json` pins exact versions. Run `npm audit` periodically and
  before each release. This is **not** automated today — there is no Dependabot
  configuration and no `npm audit` step in CI, so it depends on a human
  remembering. Treat that as a known gap rather than a control.

## Permissions

- The manifest requests `ReadWriteDocument` — the minimum needed to insert
  formatted text, equations, and images at the cursor. It does not request
  mailbox, identity, or external connection permissions.

## Reporting

Report security concerns to the add-in maintainer (see `CHANGELOG.md` /
internal owner) rather than filing a public issue.
