# Install Formula Inserter

Download the pack for your operating system, unzip, and run the installer. No admin
rights needed; the add-in loads its code from the hosted site over HTTPS.

| Your OS | Download | Then |
| --- | --- | --- |
| **Windows** | [`formula-inserter-windows.zip`](formula-inserter-windows.zip) | Unzip, **right-click `install.ps1` → Run with PowerShell** (or run `install.bat`), restart Word. See `INSTALL.md` inside. |
| **macOS** | [`formula-inserter-mac.zip`](formula-inserter-mac.zip) | Unzip, run `bash install.command` in Terminal (drag the file in), restart Word. See `INSTALL-MAC.md` inside. |

After installing, open Word → **Insert → Add-ins → Formula Inserter** (or the
**Insert Formula** button on the Home tab).

> These packs register the add-in per-user and point at the hosted web app
> (GitHub Pages). They're regenerated from `scripts/package.ps1`; see
> `DISTRIBUTION.md` for the full deployment guide.
