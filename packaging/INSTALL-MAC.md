# Install Formula Inserter in Word (macOS)

This adds an **Insert Formula** button/pane to Word for chemical formulas, math
equations, and 2D chemical structures. It runs entirely on your machine — nothing
you type is sent anywhere. No administrator rights are needed.

## Install (Word desktop on macOS)

You need modern Word (Microsoft 365 / Office 2019 or later). Open Word **once**
before installing so it creates its add-in folder.

1. **Unzip** the download and keep the files together in one folder.
2. **Run the installer.** Either way works — if a double-click fails (common
   after a Windows-made zip strips the "executable" flag), use the Terminal
   method, which always works.

   **Terminal (most reliable):** Open **Terminal** (Spotlight → type "Terminal").
   Type `bash ` (with a trailing space), then **drag `install.command` from
   Finder onto the Terminal window** and press **Return**.

   **Double-click:** double-click `install.command`. If macOS says
   *"unidentified developer,"* **right-click (Control-click) it → Open → Open**.

   Either way, a message says "Formula Inserter installed…" — press any key to
   close.
3. **Fully quit Word** (**Cmd-Q**, not just the red dot), then reopen it.
4. **Insert** tab → **Add-ins** (the *My Add-ins* dropdown) → click
   **Formula Inserter**. The pane opens on the side.

That's it. (First open may take a second while it loads.)

### Quick test
In the pane, with **Chemical** selected, type `H2O` and click
**Insert formatted text** — you should get H₂O in your document.

## Uninstall

Run **`uninstall.command`** the same way you ran the installer (double-click, or
`bash uninstall.command` in Terminal), then restart Word.

## Troubleshooting

- **"Unidentified developer" / won't open / "permission denied":** use the
  Terminal method above (`bash ` then drag the file in). It bypasses both the
  Gatekeeper prompt and the missing-executable-flag problem.
- **Not under Add-ins after install:** make sure Word was *fully* quit with
  **Cmd-Q** (not just closing the window), then reopen. Also confirm you had
  launched Word at least once *before* installing.
- **Pane is blank:** you need an internet connection the first time it loads (the
  add-in's code is served over HTTPS). After that it works offline.
- **"Could not be started" / compatibility:** requires a modern Microsoft 365
  build of Word for Mac. Very old Office versions aren't supported.
