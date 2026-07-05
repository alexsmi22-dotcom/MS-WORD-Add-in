# Host the add-in on GitHub Pages (free, ~10 min, no admin)

This hosts the add-in's **web files only** (its UI + chemistry engine). No
document or patent content is ever sent there — that all stays on each user's
machine. The repo is public, but it only contains the tool's code.

## One-time setup

### 1. Create a GitHub repository

- Sign in at <https://github.com> (create a free account if needed).
- Click **New repository** → name it e.g. **`formula-inserter`** → **Public** →
  **Create repository**. Don't add a README (the project already has files).
- Note your **username** and the **repo name**. Your add-in URL will be:
  **`https://<username>.github.io/<repo>/`**
  (e.g. `https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/`).

### 2. Push this project to the repo

From the project folder (`C:\Users\AlexanderSmith\word-chem-formula`):

```powershell
git remote add origin https://github.com/<username>/<repo>.git
git branch -M main
git push -u origin main
```

(If prompted to sign in, use the GitHub browser/credential prompt.)

### 3. Turn on GitHub Pages

- In the repo on github.com: **Settings → Pages**.
- Under **Build and deployment → Source**, choose **GitHub Actions**.
- The included **Deploy to GitHub Pages** workflow runs automatically on push and
  publishes the built `dist/` files. Watch it under the repo's **Actions** tab;
  when it's green, your site is live at `https://<username>.github.io/<repo>/`.
- Confirm by opening **`https://<username>.github.io/<repo>/taskpane.html`** in a
  browser — you should see the add-in UI.

## Build the install package for your URL

Back in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -HostUrl https://<username>.github.io/<repo>
```

This stamps `manifest.xml` with your Pages URL and produces
`release\formula-inserter\` (+ `.zip`).

## Send to users

Email or share these three small files (from `release\formula-inserter\`):

- `manifest.xml`
- `install.ps1`
- `INSTALL.md`

Users run `install.bat` (or `install.ps1`) once — no admin — restart Word, and
pick **JurisLab** from **Insert → Add-ins → Developer Add-ins**.

## Updating later

Push changes to `main`; the Action rebuilds and republishes automatically. Users
get the new version next time they open the pane (the manifest/URL don't change,
so no need to re-send anything unless you change the manifest).
