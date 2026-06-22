# Install Formula Inserter in Word (macOS)

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

It installs just like the Windows version, with **one extra click the first
time**: macOS requires you to confirm you trust an installer it didn't deliver
itself. After that first time, it's an ordinary double-click.

> **Why the extra click?** Apple blocks any installer it hasn't personally
> notarized from running on a plain double-click — you have to right-click → Open
> once to approve it. This is Apple's rule for every app not sold through their
> process; it isn't specific to this add-in. (Windows has a milder version: the
> "Windows protected your PC → Run anyway" box.)

## Install (do this once)

You need modern Word (Microsoft 365 / Office 2019 or later). Open Word **once**
before installing so it creates its add-in folder.

1. **Unzip** the download and keep the files together in one folder.
2. **Right-click** (or Control-click) **`install.command`** and choose **Open**.
3. A box says macOS *can't verify the developer*. Click **Open**. (Safe — the
   installer only copies one file into Word's add-in folder.)
   - **No "Open" button (newer macOS)?** Go to **Apple menu → System Settings →
     Privacy & Security**, scroll down, click **Open Anyway**, then repeat step 2.
4. A Terminal window runs and prints **"Formula Inserter installed."** — press any
   key to close it.
5. **Fully quit Word** (**⌘-Q**, not just the red dot), then reopen it.
6. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → click
   **Formula Inserter**. The pane opens on the side.

From now on you can simply **double-click `install.command`** — the approval only
happens the first time.

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall
Right-click **`uninstall.command`** → **Open** (same as the install steps), then
restart Word.

## If the installer still won't open (rare)
You can install without the script by copying one file yourself:
1. Open **Terminal** (⌘-Space, type `Terminal`, Return).
2. Type `cd ` (with a space), drag this folder onto the window, press Return.
3. Paste this line and press Return:
   ```bash
   mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef && cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter installed."
   ```

## Troubleshooting
- **"Permission denied" when it runs:** the download stripped the file's run
  permission. Re-download the zip (the current build preserves it), or use the
  copy-paste method above.
- **Not under Add-ins after install:** make sure Word was *fully* quit with
  **⌘-Q** (not just closing the window), then reopened. Also confirm you launched
  Word at least once *before* installing.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365
  build of Word for Mac. Very old Office versions aren't supported.
