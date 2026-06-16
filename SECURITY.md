# Security & Confidentiality

This add-in is designed for drafting confidential, often unpublished, technical
and patent content. The core guarantee is that **document content never leaves
the user's machine.**

## Data flow

- All processing — formula formatting, equation (OMML) generation, 2D structure
  rendering (OpenChemLib), molecule building — happens **locally in the Word
  webview**. Nothing the user types or inserts is transmitted anywhere.
- There are **no analytics, no telemetry, and no external API calls** in the
  application code. (Verified by source scan; see CI.)
- The only network request the add-in makes is loading **office.js** from
  Microsoft's official CDN (`https://appsforoffice.microsoft.com`) — required by
  all Office add-ins. The application bundle (including OpenChemLib) is served
  from your own internal host.

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
  before each release.

## Permissions

- The manifest requests `ReadWriteDocument` — the minimum needed to insert
  formatted text, equations, and images at the cursor. It does not request
  mailbox, identity, or external connection permissions.

## Reporting

Report security concerns to the add-in maintainer (see `CHANGELOG.md` /
internal owner) rather than filing a public issue.
