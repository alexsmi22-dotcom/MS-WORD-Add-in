# Host setup (one-time, by whoever hosts the files)

The add-in's web files must be served over **HTTPS**. This is done **once**; after
that, users just run `install.ps1` (or use Upload My Add-in).

## 1. Upload the web files

Copy the contents of the **`web/`** folder to an HTTPS location that your users
can reach, e.g.:

- an internal web server / IIS site,
- SharePoint (a document library served over HTTPS),
- Azure Blob static website / Azure Static Web Apps.

The files must be reachable such that **`<host-url>/taskpane.html`** loads in a
browser (you should see the add-in UI, possibly with a certificate prompt the
first time).

## 2. Confirm the manifest points at your host

This package's **`manifest.xml`** was stamped with the host URL you provided when
it was built. Verify the URLs inside match where you uploaded `web/`:

```
<SourceLocation DefaultValue="https://YOUR-HOST/taskpane.html" />
... and the icon / commands URLs under the same host.
```

If you uploaded to a different URL, rebuild the package with the correct one:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -HostUrl https://your-host/formula-inserter
```

## 3. Distribute to users

Email users the small files — **`manifest.xml`**, **`install.ps1`**,
**`uninstall.ps1`**, and **`INSTALL.md`** — or put them on a download page. Users
run `install.ps1` once (no admin).

## Optional: network-share catalog (not recommended)

A network-share **Trusted Add-in Catalog** (`manifest.xml` on an SMB share, added
under File > Options > Trust Center > Trusted Add-in Catalogs, then Insert > My
Add-ins > Shared Folder) is possible in principle, but it **did not surface the
add-in on the target Office build** — use the per-user installer (`install.bat` /
`install.ps1`, Insert > Add-ins > Developer Add-ins) or, for IT-managed rollout,
the Microsoft 365 admin center (see `CENTRALIZED-DEPLOY.md`).

## Updating

Re-upload `web/` to the same location and bump `<Version>` in the source manifest
before repackaging. Users pick up the new web build automatically (clear the
Office cache if your host caches aggressively).
