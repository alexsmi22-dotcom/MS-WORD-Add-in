# Install Formula Inserter in Word

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

## Install (Word desktop on Windows)

1. Keep **`manifest.xml`** and **`install.ps1`** together in the same folder.
2. **Right-click `install.ps1` → Run with PowerShell.**
   - If nothing happens when you double-click, that's normal — you must use
     **Run with PowerShell** (double-clicking just opens it in Notepad).
   - If it's blocked, open PowerShell and run:
     `powershell -ExecutionPolicy Bypass -File install.ps1`
   - You'll see "Formula Inserter installed for your user account."
3. **Fully close and reopen Word** (all windows).
4. **Insert** tab → **Add-ins** → under **Developer Add-ins**, click
   **Formula Inserter**. The pane opens on the right.

That's it. (First open may take a second while it loads.)

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall

Run **`uninstall.ps1`** the same way (Run with PowerShell), then restart Word.

## Troubleshooting

- **Double-clicking does nothing:** use **right-click → Run with PowerShell**.
- **Not under Developer Add-ins after install:** make sure Word was *fully* closed
  (no lingering WINWORD in Task Manager), then reopen.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires Microsoft 365 Word (modern
  build). Very old Office versions aren't supported.
