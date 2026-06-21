# Install Formula Inserter (Word) — Windows & macOS

Formula Inserter is a Microsoft Word add-in for STEM authoring (chemistry, math,
units, plotting, finance, DNA/sequence tools, and patent-drafting aids). It runs
**entirely on your machine** — nothing you type is sent anywhere — and needs **no
administrator rights**.

Pick your operating system below.

| Your OS | Download | Quick steps |
| --- | --- | --- |
| **Windows** | **[formula-inserter-windows.zip](formula-inserter-windows.zip)** | Unzip → right-click **`install.ps1` → Run with PowerShell** → restart Word |
| **macOS** | **[formula-inserter-mac.zip](formula-inserter-mac.zip)** | Unzip → double-click **`install.command`** (or use the Terminal step below) → restart Word |

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
2. **Run the installer.** Double-click **`install.command`** — a message says
   **"Formula Inserter installed…"**; press any key to close. (If macOS says
   *"unidentified developer,"* right-click it → **Open** → **Open**.)

   **If the double-click does nothing, opens TextEdit, or says "permission
   denied"** (an older download whose executable flag was stripped), use the
   foolproof Terminal method instead:
   - Open **Terminal** (Spotlight → type "Terminal").
   - Type `cd ` (with a trailing space), drag the unzipped
     **formula-inserter-mac** folder onto the Terminal window, press **Return**.
   - Paste this one line and press **Return**:
     ```bash
     mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef && cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter installed."
     ```
3. **Fully quit Word** (**⌘Q**, not just the red dot), then reopen it.
4. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → **Formula Inserter**.

**Uninstall:** double-click `uninstall.command`, or in Terminal paste
`rm -f ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml`, then restart Word.

---

## Quick test (either OS)
In the pane, with **Chemical** selected, type `H2O` and click **Insert formatted
text** — you should get H₂O in your document.

## Troubleshooting
- **Pane is blank / "can't load the add-in":** you need an internet connection the
  first time it loads (code is served over HTTPS). After that it works offline.
- **Not listed under Add-ins after installing:** make sure Word was *fully* closed
  (Windows) / quit with ⌘Q (Mac), then reopen.
- **macOS installer won't run / opens TextEdit / "permission denied" /
  "unidentified developer":** the download's executable flag was stripped — use
  the **Terminal one-liner** in the macOS section above. It needs no executable
  flag and bypasses Gatekeeper.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365 build
  of Word. Very old Office versions aren't supported.

---

*These packs register the add-in per-user and load it from the hosted web app
(GitHub Pages). They're produced by `scripts/package.ps1`; full IT/deployment
options are in `DISTRIBUTION.md`. Each zip also contains its own `INSTALL.md` /
`INSTALL-MAC.md` and a `FEATURES.md` overview.*
