# Distribution & Deployment Guide (IT)

This Office Add-in is a static web app (HTML/JS/CSS) plus a manifest. There is no
server-side component and no database. Deployment = host the built files on an
internal HTTPS endpoint and have users register the manifest.

> **Note:** Office add-ins cannot be a double-click `.exe`. The web files must be
> HTTPS-hosted, and each user registers the small `manifest.xml`. The package
> below makes that an email-and-run flow with **no admin rights** required.

## Quick path: build an emailable package

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -HostUrl https://your-host/formula-inserter
```

This builds the bundle, stamps the manifest with your host URL, validates it, and
produces **three separate, labeled outputs** under `release\`:

| Output | Audience | What to do with it |
| --- | --- | --- |
| `formula-inserter-host\` (`web\`, `manifest.xml`, `HOST-SETUP.md`) | IT (once) | Upload `web\` to `https://your-host/formula-inserter` |
| `formula-inserter-windows.zip` | **Windows** users | Email it — they run `install.bat`/`install.ps1` (per-user, no admin) |
| `formula-inserter-mac.zip` | **macOS** users | Email it — they **right-click `install.command` → Open** (per-user, no admin) |

Each install pack is self-contained: it carries its own copy of the stamped
`manifest.xml`, the OS installer/uninstaller, the matching INSTALL doc, and
`FEATURES.md`. So: run the script → upload `formula-inserter-host\web` once → send
each person the **one zip for their OS**. They run the installer, restart Word,
and pick **JurisLab** from **Insert → Add-ins**.

> **How the per-user install works:**
> - **Windows:** `install.ps1` copies `manifest.xml` to
>   `%LOCALAPPDATA%\FormulaInserter` and registers it under
>   `HKCU\…\WEF\Developer` (a per-user "developer add-in"). The older local-folder
>   **Trusted Catalog** ("Shared Folder") method is **not** used — it did not
>   surface the add-in on the target Office build.
> - **macOS:** Mac Word has no registry; `install.command` copies `manifest.xml`
>   into Word's per-user sideload folder
>   `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`. The add-in then
>   appears under **Insert → Add-ins**. GOTCHAS handled: (1) the Mac zip is built
>   by `scripts/zip-mac.mjs`, which preserves the Unix exec bit (a Windows
>   `Compress-Archive` zip strips it → "permission denied"); (2) Gatekeeper blocks
>   a *plain double-click* of an unsigned downloaded script, so users **right-click
>   → Open** the first time (newer macOS: System Settings → Privacy & Security →
>   Open Anyway). A no-script copy-paste fallback is in `START HERE` / `INSTALL-MAC.md`
>   for anyone the script still won't run for.
>
> The same hosted `web\` files and the same stamped `manifest.xml` serve both
> platforms — only the per-user install step differs.

**Ready for IT-managed rollout instead?** See
[`packaging/CENTRALIZED-DEPLOY.md`](packaging/CENTRALIZED-DEPLOY.md) for pushing
the add-in to users via the Microsoft 365 admin center (no per-user installer).

**Verify the dictionary first (optional):** `npm run review-sheet` writes
`review-sheet.html` — every compound rendered for a chemist to sign off.

### No server? Host free on GitHub Pages

If you don't have an internal HTTPS host, **`packaging/GITHUB-PAGES.md`** walks
through hosting the web files free on GitHub Pages (~10 min, no admin). An
included GitHub Action (`.github/workflows/pages.yml`) builds and publishes
automatically on push; your add-in URL becomes
`https://<user>.github.io/<repo>/`. Then run `package.ps1` with that URL.

---

## Manual / advanced deployment

The steps below are the underlying mechanics (and the centralized-deployment
alternative) if you don't use the package script.

## 1. Build the production bundle

```bash
npm ci
npm run build          # outputs static files to ./dist
```

`dist/` contains `taskpane.html`, `taskpane.js`, `commands.html`, `commands.js`,
`assets/`, and the CSS. These are the only files that get hosted.

## 2. Host the static files

Host the contents of `dist/` on an **internal HTTPS** location, e.g.:

- SharePoint Online document library (served over HTTPS), or
- Azure Static Web Apps / Azure Blob Storage static website, or
- An internal IIS site / network share served over HTTPS.

Requirements:

- **HTTPS is mandatory** (Office add-ins will not load over HTTP).
- The hosting origin must send `Access-Control-Allow-Origin` appropriately if
  assets are cross-origin (same-origin hosting avoids this).
- Note the base URL, e.g. `https://addins.contoso.com/formula-inserter/`.

## 3. Prepare the production manifest

`manifest.prod.xml` is a template with the host placeholder
`https://ADDIN-HOST.example.com`. Replace every occurrence with your hosted base
URL and save as your production manifest:

```bash
# example (PowerShell)
(Get-Content manifest.prod.xml -Raw) -replace 'https://ADDIN-HOST.example.com','https://addins.contoso.com/formula-inserter' | Set-Content manifest.deploy.xml
```

Then validate it:

```bash
npx office-addin-manifest validate manifest.deploy.xml
```

> Keep the manifest `<Id>` GUID stable across updates so Office treats new
> versions as the same add-in. Bump `<Version>` on every release.

## 4. Deploy to users (centralized)

Use the **Microsoft 365 admin center → Settings → Integrated apps → Upload custom
app** (or the classic *Centralized Deployment*) to push `manifest.deploy.xml` to a
pilot group, then org-wide. This is preferred over manual sideloading:

- Admin controls who gets it; users don't touch developer settings.
- Updates propagate by re-uploading a manifest with a higher `<Version>`.

**Step-by-step admin instructions are in
[`packaging/CENTRALIZED-DEPLOY.md`](packaging/CENTRALIZED-DEPLOY.md)** — roles
required, the upload flow, pilot assignment, propagation time, updates, and
rollback.

> Not recommended here: a **trusted add-in catalog** on a network share
> (File → Options → Trust Center → Trusted Add-in Catalogs → Insert → My Add-ins
> → Shared Folder). It did **not** surface the add-in on the target Office build,
> so use the per-user installer or Integrated Apps instead.

## 5. Updates & versioning

- Bump `<Version>` in the manifest (e.g. `1.0.0.0` → `1.1.0.0`) for each release.
- Re-deploy `dist/` to the same host path; add cache-busting if your host caches
  aggressively (the bundle filenames are stable, so set short cache TTLs or
  version the hosting path, e.g. `/formula-inserter/1.1/`).
- Keep `CHANGELOG.md` current.

## 6. Requirements & compatibility

- **Word**: Microsoft 365 (desktop Win/Mac) or Word on the web, on a build that
  uses the modern WebView2 (Edge Chromium) runtime. Legacy IE/Trident-based
  webviews are **not** supported.
- Validate on **Windows desktop, Mac desktop, and Word on the web** before broad
  rollout (rendering of equations/structures should be spot-checked on each).

## 7. Rollback

Re-upload the previous manifest version and restore the previous `dist/` from
source control (every release is a tagged git commit).
