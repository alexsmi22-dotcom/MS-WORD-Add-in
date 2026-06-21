# Install Formula Inserter in Word (macOS)

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

Installing is a single copy-paste command. (We don't ship a double-click
installer for Mac on purpose: macOS blocks unsigned downloaded scripts with a
scary *"cannot verify it is free of malware"* warning. The command below copies
one file into Word's add-in folder — nothing for macOS to flag.)

## Install (Word desktop on macOS)

You need modern Word (Microsoft 365 / Office 2019 or later). Open Word **once**
before installing so it creates its add-in folder.

1. **Unzip** the download and keep `manifest.xml` in the folder.
2. Open **Terminal** (press **⌘-Space**, type `Terminal`, press **Return**).
3. Type `cd ` (with a trailing space), then **drag the unzipped
   `formula-inserter-mac` folder** from Finder onto the Terminal window and press
   **Return**.
4. Copy-paste this one line and press **Return**:
   ```bash
   mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef && cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter installed."
   ```
   When it prints **"Formula Inserter installed."** the file is in place.
5. **Fully quit Word** (**⌘-Q**, not just the red dot), then reopen it.
6. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → click
   **Formula Inserter**. The pane opens on the side.

That's it. (First open may take a second while it loads.)

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall

Open **Terminal**, paste this, and press **Return**, then restart Word:
```bash
rm -f ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/formula-inserter.manifest.xml && echo "Formula Inserter removed."
```

## Troubleshooting

- **The install command did nothing / "No such file or directory":** make sure
  step 3 put you in the unzipped folder (run `ls` — you should see
  `manifest.xml`), then rerun the command in step 4.
- **Not under Add-ins after install:** make sure Word was *fully* quit with
  **⌘-Q** (not just closing the window), then reopen. Also confirm you had
  launched Word at least once *before* installing.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365
  build of Word for Mac. Very old Office versions aren't supported.
