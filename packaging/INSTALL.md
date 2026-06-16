# Install Formula Inserter in Word

This add-in adds an **Insert Formula** button to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere.

Pick the method for how you use Word.

---

## Word on the web (easiest — no script)

1. Open a document at **word.office.com**.
2. **Insert** tab → **Add-ins** → **Upload My Add-in**.
3. Browse to **`manifest.xml`** (from this package) → **Upload**.
4. The **Insert Formula** button appears on the Home tab.

## Word desktop on Windows

1. Make sure **`manifest.xml`** and **`install.ps1`** are in the same folder.
2. Right-click **`install.ps1`** → **Run with PowerShell**.
   (If blocked, open PowerShell and run:
   `powershell -ExecutionPolicy Bypass -File install.ps1`)
3. **Fully close and reopen Word.**
4. **Insert** tab → **Add-ins** (or **My Add-ins**) → **SHARED FOLDER** tab →
   choose **Formula Inserter** → **Add**.

No administrator rights are needed — it installs for your user only.

To remove it later: run **`uninstall.ps1`**, then restart Word.

## Word desktop on Mac

1. Copy **`manifest.xml`** to:
   `~/Library/Containers/com.microsoft.Word/Data/Documents/wef`
   (create the `wef` folder if it doesn't exist).
2. Restart Word → **Insert** → **Add-ins** → **My Add-ins** → choose it.

---

### Troubleshooting

- **"Shared Folder" tab is empty / add-in not listed:** restart Word completely
  (check Task Manager for lingering WINWORD). If it still doesn't appear, your
  Office build may require a network-share catalog — see `HOST-SETUP.md` for the
  share option, or use Word on the web.
- **Add-in pane is blank or won't load:** the web files may not be hosted yet, or
  the hosting URL in the manifest is wrong — see `HOST-SETUP.md` (this is a
  one-time setup by whoever hosts the files).
- **"This add-in could not be started" / compatibility:** requires Microsoft 365
  Word (modern build). Very old Office versions are not supported.
