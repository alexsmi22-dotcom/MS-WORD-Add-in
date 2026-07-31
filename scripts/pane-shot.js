/* eslint-disable no-undef */
// Screenshots the REAL built task pane at Word task-pane widths.
//
// The render check proves the pane works; nothing showed what it LOOKS like.
// Visual work on the pane was therefore unverifiable without opening Word, so
// this boots the same production bundle with the same Office stub and takes
// PNGs at the widths Word actually gives a task pane.
//
//   node scripts/pane-shot.js --out <dir> [--modes home,chemical,stats] [--width 360]
//
// Not a QC gate — a tool for looking. Kept beside render-check.js because it
// shares the harness contract with it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { makeProfile } = require("./headless-profile.js");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/** Same browser discovery as the other headless gates. */
function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

/**
 * Harness that boots the pane, then switches to one mode and freezes.
 * Mirrors writeHarness() in render-check.js — same stub, same bundle discovery.
 */
let PANE_WIDTH = 360;

function writeHarness(mode) {
  const htmlPath = path.join(DIST, "taskpane.html");
  if (!fs.existsSync(htmlPath)) throw new Error("dist/taskpane.html not found — run `npm run build` first.");
  let html = fs.readFileSync(htmlPath, "utf8");
  const bundle = /src="(taskpane\.[a-f0-9]+\.js)"/.exec(html);
  if (!bundle) throw new Error("Could not find the taskpane bundle in dist/taskpane.html.");

  html = html.replace(/<script[^>]*appsforoffice[^>]*><\/script>/g, "");
  html = html.replace(/<script[^>]*src="taskpane\.[a-f0-9]+\.js"[^>]*><\/script>/g, "");

  const stub =
    "<script>window.Office={HostType:{Word:'Word'},onReady:function(cb){window.__officeCb=cb;}," +
    "context:{requirements:{isSetSupported:function(){return true;}}}};" +
    "window.Word={run:function(){return Promise.resolve();}," +
    "InsertLocation:{replace:'replace',after:'after',end:'end'},SelectionMode:{end:'end'}};</script>";
  html = html.replace("</head>", stub + "</head>");

  // Pin the LAYOUT width, do not rely on --window-size.
  //
  // Headless did not apply --window-size to the layout viewport: the pane laid
  // out at 489px while the PNG was cropped to 360, which looks exactly like a
  // clipped two-column grid and is not one. A screenshot tool that lies about
  // width is worse than none, so the width is forced in CSS and the window is
  // merely made large enough to contain it.
  // Optional forced theme, so dark mode can be screenshotted.
  const themeAttr = arg("theme", "");
  if (themeAttr) {
    html = html.replace("<html", `<html data-theme="${themeAttr}"`);
  }
  html = html.replace(
    "</head>",
    `<style>html{width:${PANE_WIDTH}px!important;overflow-x:hidden}` +
      `body{width:${PANE_WIDTH}px!important;margin:0!important}</style></head>`,
  );

  // Boot Office, then select the mode through the real <select> so the pane's
  // own change handler does the work — no private internals touched.
  const drive = `<script>
(function(){
  function boot(){ if (window.__officeCb) window.__officeCb({host:'Word'}); }
  boot();
  setTimeout(function(){
    var sel = document.getElementById('mode-select');
    if (sel && ${JSON.stringify(mode)} !== 'home') {
      sel.value = ${JSON.stringify(mode)};
      sel.dispatchEvent(new Event('change', {bubbles:true}));
    }
    document.title = 'SHOT-READY';
  }, 400);
})();
</script>`;
  html = html.replace("</body>", `<script src="${bundle[1]}"></script>${drive}</body>`);

  const out = path.join(DIST, "shot-harness.html");
  fs.writeFileSync(out, html);
  return out;
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error("No Chromium-family browser found (set CHROME_PATH).");
    return 1;
  }
  const outDir = path.resolve(arg("out", path.join(os.tmpdir(), "jurislab-shots")));
  fs.mkdirSync(outDir, { recursive: true });
  const width = Number(arg("width", 360));
  PANE_WIDTH = width;
  const modes = arg("modes", "home").split(",").map((m) => m.trim()).filter(Boolean);

  const shotProfile = makeProfile("shot");
  try {
  for (const mode of modes) {
    const harness = writeHarness(mode);
    const out = path.join(outDir, `${mode}-${width}.png`);
    // One profile for the whole run, removed at the end — this loop launches the
    // browser once per mode, so without it a single invocation could leave two
    // dozen scoped_dir directories behind.
    execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        shotProfile.arg,
        "--hide-scrollbars",
        "--force-device-scale-factor=2", // legible text in the PNG
        `--window-size=${width + 40},2400`,
        "--virtual-time-budget=4000",
        "--screenshot=" + out,
        "file:///" + harness.replace(/\\/g, "/"),
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    console.log(`${mode} -> ${out}`);
  }
  } finally {
    shotProfile.cleanup();
  }
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error("FAIL: " + (e && e.message ? e.message : e));
  process.exit(1);
}
