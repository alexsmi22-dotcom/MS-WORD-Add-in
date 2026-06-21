# Install Formula Inserter (Word) — Windows & macOS

Formula Inserter is a Microsoft Word add-in for STEM authoring (chemistry, math,
units, plotting, finance, DNA/sequence tools, and patent-drafting aids). It runs
**entirely on your machine** — nothing you type is sent anywhere — and needs **no
administrator rights**.

Pick your operating system below.

| Your OS | Download | Quick steps |
| --- | --- | --- |
| **Windows** | **[formula-inserter-windows.zip](formula-inserter-windows.zip)** | Unzip → right-click **`install.ps1` → Run with PowerShell** → restart Word |
| **macOS** | **[formula-inserter-mac.zip](formula-inserter-mac.zip)** | Unzip → run **`bash install.command`** in Terminal → restart Word |

After installing, open Word → **Insert** tab → **Add-ins** → **Formula Inserter**
(or the **Insert Formula** button on the Home tab). The pane opens on the side.

> First open needs an internet connection (the add-in's code is served over HTTPS).
> After that it works offline; your document content never leaves your machine.

---

## Windows — step by step

1. **Download** `formula-inserter-windows.zip` and **unzip** it (keep the files together in one folder).
2. **Right-click `install.ps1` → Run with PowerShell.** (Don't double-click — that just opens Notepad. Or double-click `install.bat`.)
   - If Windows shows a blue **"Windows protected your PC"** box, click **More info → Run anyway** (it's only because the file was downloaded).
   - A window says **"Formula Inserter installed…"** — press a key to close it.
3. **Fully close and reopen Word** (all windows; no lingering WINWORD in Task Manager).
4. **Insert** tab → **Add-ins** → **Formula Inserter**.

**Uninstall:** double-click `uninstall.bat` (or run `uninstall.ps1`), then restart Word.

---

## macOS — step by step

You need modern Word (Microsoft 365 / Office 2019+). Launch Word **once** before installing so it creates its add-in folder.

1. **Download** `formula-inserter-mac.zip` and **unzip** it.
2. **Run the installer** (the Terminal way is the most reliable — a zip made on Windows can strip the file's "executable" flag, so a Finder double-click may say *"permission denied"*):
   - Open **Terminal** (Spotlight → type "Terminal").
   - Type `bash ` (with a trailing space), then **drag `install.command` from Finder onto the Terminal window**, and press **Return**.
   - *(Or double-click `install.command`; if macOS says "unidentified developer," right-click it → **Open** → **Open**.)*
   - A message says **"Formula Inserter installed…"** — press any key to close.
3. **Fully quit Word** (**⌘Q**, not just the red dot), then reopen it.
4. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → **Formula Inserter**.

**Uninstall:** run `bash uninstall.command` (or double-click it), then restart Word.

---

## Quick test (either OS)
In the pane, with **Chemical** selected, type `H2O` and click **Insert formatted
text** — you should get H₂O in your document.

## Troubleshooting
- **Pane is blank / "can't load the add-in":** you need an internet connection the
  first time it loads (code is served over HTTPS). After that it works offline.
- **Not listed under Add-ins after installing:** make sure Word was *fully* closed
  (Windows) / quit with ⌘Q (Mac), then reopen.
- **macOS "unidentified developer" / "permission denied":** use the Terminal
  method above (`bash ` then drag the file in) — it bypasses both issues.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365 build
  of Word. Very old Office versions aren't supported.

---

*These packs register the add-in per-user and load it from the hosted web app
(GitHub Pages). They're produced by `scripts/package.ps1`; full IT/deployment
options are in `DISTRIBUTION.md`. Each zip also contains its own `INSTALL.md` /
`INSTALL-MAC.md` and a `FEATURES.md` overview.*
