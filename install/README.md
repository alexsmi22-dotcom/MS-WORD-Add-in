# Install Formula Inserter (Word) — Windows & macOS

Formula Inserter is a Microsoft Word add-in for STEM authoring (chemistry, math,
units, plotting, finance, DNA/sequence tools, and patent-drafting aids). It runs
**entirely on your machine** — nothing you type is sent anywhere — and needs **no
administrator rights**.

Pick your operating system below.

| Your OS | Download | Quick steps |
| --- | --- | --- |
| **Windows** | **[formula-inserter-windows.zip](formula-inserter-windows.zip)** | Unzip → right-click **`install.ps1` → Run with PowerShell** → restart Word |
| **macOS** | **[formula-inserter-mac.zip](formula-inserter-mac.zip)** | Unzip → **right-click `install.command` → Open → Open** → restart Word |

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

Like the Windows installer, with **one extra click the first time** — macOS makes
you confirm you trust an installer it didn't deliver itself. After that, it's a
normal double-click.

1. **Download** `formula-inserter-mac.zip` and **unzip** it.
2. **Right-click** (Control-click) **`install.command`** → **Open**.
3. A box says macOS *can't verify the developer* — click **Open**. (Safe; it only
   copies one file into Word's add-in folder.)
   - *No "Open" button on newer macOS?* **Apple menu → System Settings → Privacy &
     Security**, scroll down, click **Open Anyway**, then redo step 2.
4. Terminal prints **"Formula Inserter installed."** — press any key to close.
5. **Fully quit Word** (**⌘Q**, not just the red dot), then reopen it.
6. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → **Formula Inserter**.

From now on a plain **double-click** of `install.command` works — the approval is
first-time only. (Stuck? `START HERE - Install on Mac.txt` in the zip has a
no-script copy-paste fallback.)

**Uninstall:** right-click `uninstall.command` → **Open**, then restart Word.

---

## Quick test (either OS)
In the pane, with **Chemical** selected, type `H2O` and click **Insert formatted
text** — you should get H₂O in your document.

## Troubleshooting
- **Pane is blank / "can't load the add-in":** you need an internet connection the
  first time it loads (code is served over HTTPS). After that it works offline.
- **Not listed under Add-ins after installing:** make sure Word was *fully* closed
  (Windows) / quit with ⌘Q (Mac), then reopen.
- **macOS "can't be opened" / no Open button:** right-click → **Open** (not a
  plain double-click) the first time; on newer macOS use **System Settings →
  Privacy & Security → Open Anyway**. If it says **"permission denied,"**
  re-download the zip (the current build keeps the file runnable) or use the
  copy-paste fallback in `START HERE - Install on Mac.txt`.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365 build
  of Word. Very old Office versions aren't supported.

---

*These packs register the add-in per-user and load it from the hosted web app
(GitHub Pages). They're produced by `scripts/package.ps1`; full IT/deployment
options are in `DISTRIBUTION.md`. Each zip also contains its own `INSTALL.md` /
`INSTALL-MAC.md` and a `FEATURES.md` overview.*
