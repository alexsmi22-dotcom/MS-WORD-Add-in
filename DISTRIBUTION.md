# Distribution & Deployment Guide (IT)

This Office Add-in is a static web app (HTML/JS/CSS) plus a manifest. There is no
server-side component and no database. Deployment = host the built files on an
internal HTTPS endpoint and push the manifest to users.

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

Alternative for a small pilot: a **trusted add-in catalog** on a network share
(File → Options → Trust Center → Trusted Add-in Catalogs), then
Insert → My Add-ins → Shared Folder.

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
