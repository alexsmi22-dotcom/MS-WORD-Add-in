# Install JurisLab in Word

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

## Install (Word desktop on Windows)

Nothing to install first — Windows already has everything needed.

1. **Extract** all the files from the zip into a folder (keep them together).
2. **Double-click `install.bat`.**
   - If Windows shows a blue "Windows protected your PC" box, click
     **More info → Run anyway** (it's just because the file was downloaded).
   - A window says "JurisLab installed…" — press a key to close it.
3. **Fully close and reopen Word** (all windows).
4. **Insert** tab → **Add-ins** → under **Developer Add-ins**, click
   **JurisLab**. The pane opens on the right.

That's it. (First open may take a second while it loads.)

> Prefer PowerShell? `install.ps1` does the same thing — right-click it →
> **Run with PowerShell** (don't double-click — that just opens Notepad).

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall

Double-click **`uninstall.bat`**, then restart Word.

## Troubleshooting

- **Double-clicking does nothing:** use **right-click → Run with PowerShell**.
- **Not under Developer Add-ins after install:** make sure Word was *fully* closed
  (no lingering WINWORD in Task Manager), then reopen.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires Microsoft 365 Word (modern
  build). Very old Office versions aren't supported.
