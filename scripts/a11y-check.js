/* eslint-disable no-undef */
// Accessibility gate (hit-list #14): axe-core over the REAL production pane in headless Chromium, Home and every tool,
// light and dark theme. WCAG 2.0/2.1 A and AA rules; the gate passes only with ZERO violations.
//
// Same harness as scripts/render-check.js (the built pane with Office stubbed); Word's task pane runs on WebView2,
// which is Chromium, so this checks the rendering the user's screen reader actually meets. It does not replace a pass
// with a screen reader: it sees each tool as it opens (names, roles, contrast, labels), not every state behind a click.
//
//   node scripts/a11y-check.js        (expects `npm run build` to have run)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { makeProfile, sweepStaleProfiles } = require("./headless-profile.js");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** a11y-harness.html: the built pane, Office stubbed, axe and the driver appended. */
function writeHarness() {
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
  // Settled styles only: a 0.13 s button transition measured mid-way read the old grey fill under the new white text.
  const still = "<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>";
  html = html.replace("</head>", stub + still + "</head>");
  html = html.replace("</body>", `<script src="${bundle[1]}"></script><script src="a11y-axe.js"></script><script src="a11y-driver.js"></script></body>`);
  fs.writeFileSync(path.join(DIST, "a11y-harness.html"), html);
  fs.copyFileSync(require.resolve("axe-core/axe.min.js"), path.join(DIST, "a11y-axe.js"));
  fs.copyFileSync(path.join(__dirname, "a11y-driver.js"), path.join(DIST, "a11y-driver.js"));
}

function cleanup() {
  for (const f of ["a11y-harness.html", "a11y-axe.js", "a11y-driver.js"]) fs.rmSync(path.join(DIST, f), { force: true });
}

function run() {
  sweepStaleProfiles();
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this check).");
    return 2;
  }
  writeHarness();
  const profile = makeProfile("a11y");
  let dom;
  try {
    dom = execFileSync(
      browser,
      ["--headless=new", "--disable-gpu", "--no-sandbox", profile.arg, "--virtual-time-budget=180000", "--dump-dom", "file:///" + path.join(DIST, "a11y-harness.html").replace(/\\/g, "/")],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "ignore"] },
    );
  } finally {
    profile.cleanup();
    cleanup();
  }
  const m = /data-a11y="([^"]*)"/.exec(dom);
  if (!m) {
    console.error("FAIL: the accessibility pass did not finish — no results were produced.");
    return 1;
  }
  const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const lines = decode(m[1]).split(" ||| ");
  const failures = [];
  const err = lines.find((l) => l.startsWith("ERROR"));
  if (err) failures.push(err);
  if (!lines.includes("CANARY ok")) failures.push("axe did not flag the canary <img> with no alt — the gate itself is broken");
  const checked = lines.find((l) => l.startsWith("CHECKED "));
  const cm = checked && /^CHECKED (\d+) modes=(\d+)$/.exec(checked);
  if (!cm || Number(cm[1]) !== 2 * Number(cm[2]) || Number(cm[2]) < 10) failures.push(`not every tool was checked in both themes (${checked || "no count"})`);
  const violations = lines.filter((l) => l.startsWith("VIOLATION\t"));
  for (const v of violations) {
    const [, theme, mode, id, impact, n, where] = v.split("\t");
    failures.push(`${theme} · ${mode}: ${id} (${impact}, ${n} element${n === "1" ? "" : "s"}) — ${where}`);
  }
  if (failures.length) {
    console.error(`FAIL: ${failures.length} accessibility problem${failures.length === 1 ? "" : "s"}:`);
    for (const f of failures) console.error("  - " + f);
    return 1;
  }
  console.log(`PASS: no WCAG 2.1 A/AA violations in ${cm[1]} views (${cm[2]} tools × light and dark).`);
  return 0;
}

process.exitCode = run();
