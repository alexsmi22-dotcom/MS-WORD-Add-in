# Centralized deployment (IT admin)

This guide is for an IT/Microsoft 365 administrator who wants to push **JurisLab**
(formerly Formula Inserter) to users centrally — so users get it automatically,
without running the per-user `install.ps1`. It uses the Microsoft 365 admin center
(**Integrated apps** / Centralized Deployment).

> If you only need a quick per-user pilot, the emailable installer in
> [`../DISTRIBUTION.md`](../DISTRIBUTION.md) (run `install.bat`, no admin) is
> simpler. Use this guide when you want IT to own the rollout.

---

## What gets deployed

An Office Add-in is **a manifest + HTTPS-hosted web files**. There is no MSI/EXE
and nothing installed on the machine. Centralized deployment distributes the
small `manifest.xml`; the web files are loaded from your host at runtime.

- **Web files:** already hosted (e.g. GitHub Pages at
  `https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/`, or your internal HTTPS
  host). See [`HOST-SETUP.md`](HOST-SETUP.md) / [`GITHUB-PAGES.md`](GITHUB-PAGES.md).
- **Manifest:** `release\formula-inserter\manifest.xml`, produced and validated by
  `scripts\package.ps1 -HostUrl <your-host>`. This same file is what you upload
  below — no separate "deploy manifest" is needed.

## Prerequisites

- A Microsoft 365 admin role that can deploy add-ins: **Global Administrator**, or
  the **Global Reader + (Exchange/Office) admin** combination Microsoft requires
  for Integrated apps. (A non-admin user account cannot do this step.)
- Centralized Deployment must be available for your tenant/licensing (it is for
  most Microsoft 365 Business/Enterprise plans).
- The web files reachable over **HTTPS** from users' machines (corporate proxy/
  firewall must allow the host origin).

## Deploy

1. Go to **[admin.microsoft.com](https://admin.microsoft.com)** →
   **Settings → Integrated apps**.
2. Click **Upload custom apps**.
3. Choose **Office Add-in**, then **Provide link to manifest file** (if your
   manifest is reachable by URL) **or** **Upload manifest file (.xml)** and select
   `manifest.xml` from the package.
4. **Assign users:** start with a small **pilot group** (a security group or a few
   named users), not "Entire organization". Accept the permissions
   (`ReadWriteDocument`) and finish.
5. Wait for propagation. Centralized Deployment typically appears for users within
   a few hours (Microsoft cites up to ~24 h for the first deployment).

### What users see

The add-in appears automatically on the Word **Home** tab as the **JurisLab**
button (group "JurisLab") — no installer, no developer settings, no
restart beyond the normal next launch. (The per-user method instead surfaces it
under Insert → Add-ins → Developer Add-ins.)

## Updates

- Bump `<Version>` in `manifest.prod.xml` (e.g. `1.0.0.0` → `1.1.0.0`) and rebuild
  the package. **Keep the `<Id>` GUID unchanged** so Office treats it as the same
  add-in.
- Re-deploy the web files to the **same host path** (the GitHub Pages Action does
  this on push to `main`).
- In **Integrated apps**, open the app and **update** it with the new manifest.
  Clients pick up the higher version automatically.
- Web-only changes (no manifest change) need no admin action — just redeploy the
  files; keep cache TTLs short so clients refresh.

## Remove / roll back

- **Remove:** Integrated apps → the app → **Remove**. It disappears from users'
  ribbons on next sync.
- **Roll back:** re-upload the previous manifest `<Version>` and restore the
  previous `dist/` from source control (each release is a tagged commit).

## Verify before broad rollout

- Run `npx office-addin-manifest validate <manifest>` (the package script already
  does this) — it must report **"The manifest is valid."**
- Spot-check on **Windows desktop** (the team's primary target). The add-in needs
  a modern **WebView2 (Edge Chromium)** runtime; legacy IE-based webviews are not
  supported.
- Optional: `npm run review-sheet` renders every compound for a chemist to sign
  off before release.

## Notes specific to this add-in

- **No data leaves the machine.** It is a static client-side web app; it reads/
  writes only the active document. The pane shows a confidentiality disclaimer.
- **Public AppSource is intentionally not used** — this is an internal tool;
  centralized deployment (or the per-user installer) keeps it private.
- **Network-share Trusted Catalog is not recommended** — it did not surface the
  add-in on the target Office build.
