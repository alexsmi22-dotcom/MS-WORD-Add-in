# Install Formula Inserter in Word (macOS)

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

## Install (Word desktop on macOS)

You need modern Word (Microsoft 365 / Office 2019 or later). Open Word **once**
before installing so it creates its add-in folder.

1. **Unzip** the download and keep the files together in one folder.
2. **Run the installer.** Use the **Terminal method** below — it always works.
   (A Finder double-click *can* also work, but a zip made on Windows often strips
   the file's "executable" flag, so the double-click silently fails or opens the
   file in TextEdit. Terminal avoids that entirely.)

   **Terminal (recommended — always works):**
   1. Open **Terminal** (press **⌘-Space**, type `Terminal`, press **Return**).
   2. Type `cd ` (with a trailing space), then **drag the unzipped
      `formula-inserter-mac` folder** from Finder onto the Terminal window and
      press **Return**.
   3. Copy-paste this one line and press **Return**:
      ```bash
      mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef && cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter installed."
      ```
      When it prints **"Formula Inserter installed."** you're done. (This does
      exactly what the installer script does — copies the manifest into Word's
      add-in folder — with nothing that can be blocked by a missing exec flag.)

   **Double-click (convenience):** double-click `install.command`. If it opens in
   TextEdit or says *"permission denied,"* the exec flag was stripped — use the
   Terminal method above instead. If macOS says *"unidentified developer,"*
   **right-click (Control-click) `install.command` → Open → Open**.
3. **Fully quit Word** (**Cmd-Q**, not just the red dot), then reopen it.
4. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → click
   **Formula Inserter**. The pane opens on the side.

That's it. (First open may take a second while it loads.)

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall

In **Terminal**, paste this and press **Return**, then restart Word:
```bash
rm -f ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter removed."
```
(Or run **`uninstall.command`** if its double-click works on your machine.)

## Troubleshooting

- **Installer won't run / opens in TextEdit / "permission denied" /
  "unidentified developer":** this is the stripped-executable-flag problem from a
  Windows-made zip. Don't fight the double-click — use the **Terminal method** in
  the Install section above. It needs no executable flag and bypasses Gatekeeper.
- **Not under Add-ins after install:** make sure Word was *fully* quit with
  **Cmd-Q** (not just closing the window), then reopen. Also confirm you had
  launched Word at least once *before* installing.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365
  build of Word for Mac. Very old Office versions aren't supported.
