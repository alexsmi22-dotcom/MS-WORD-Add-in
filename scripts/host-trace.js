/* eslint-disable no-undef */
// Host trace — records every Word/Office call the real pane makes, tool by tool,
// and diffs it against a golden trace.
//
//   node scripts/host-trace.js            diff against scripts/host-trace.golden.txt
//   node scripts/host-trace.js --write    (re)write the golden trace
//   node scripts/host-trace.js --out F    also write this run's trace to F
//
// Expects `npm run build` to have run. Exit 0 = identical, 1 = differs or the
// run failed, 2 = skipped (no browser).
//
// WHY THIS EXISTS. The host-adapter refactor (docs/SCOPE-HOST-ADAPTER.md) moves
// every Word.run out of taskpane.ts. A move that changes an insert location, a
// batch boundary, the order of a size and an alt-text set, or a settings key
// changes what lands in a user's document, and nothing else in this repo can
// see it: jest cannot load Office.js and the in-Word passes are the user's. The
// trace can. It is a "move only" instrument: during the refactor the diff must
// stay empty.
//
// It also reports COVERAGE: which Word.run call sites in the source the drive
// actually reached, mapped back through the bundle's source map. A green diff
// over a site the drive never entered proves nothing about that site.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { makeProfile } = require("./headless-profile.js");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const GOLDEN = path.join(__dirname, "host-trace.golden.txt");
const PANE_SRC = path.join(ROOT, "src", "taskpane", "taskpane.ts");

// Inputs for the tools whose Word-facing buttons refuse on an empty field.
// Keyed "mode/buttonId" (or just "buttonId"); each entry is [elementId, value]
// pairs set, in order, before the click.
const SEEDS = require("./host-trace-seeds.js");
const FIXTURES = require("./host-trace-fixtures.js");
const DIALOGS = FIXTURES.__dialogs || {};
delete FIXTURES.__dialogs;

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

/** All source files that may hold Word/Office calls: the pane and the host layer. */
const hostSources = require("./host-sources.js").hostSourceFiles;

/** Word enums dereferenced anywhere in the pane or host layer, derived not remembered. */
function deriveEnums() {
  const byNs = {};
  for (const f of hostSources()) {
    const src = fs.readFileSync(f, "utf8");
    for (const mm of src.matchAll(/\bWord\.([A-Z][A-Za-z]*)\.([A-Za-z]+)/g)) {
      (byNs[mm[1]] = byNs[mm[1]] || {})[mm[2]] = mm[2];
    }
  }
  return byNs;
}

/**
 * Buttons whose click can reach the document. Derived from the pane source:
 * every element bound with getElementById whose click listener line names an
 * insert/build/apply/scan/... handler. Over-inclusion is harmless (a button
 * that never calls Word records an empty segment); under-inclusion shows up as
 * an unreached site in the coverage report.
 */
function deriveTargets() {
  // The pane AND its helper modules (cadPane.ts wires the Drawing tool's
  // buttons itself, through a small `el<T>("id")` lookup): a button whose
  // listener lives outside taskpane.ts would otherwise never be clicked.
  const paneDir = path.dirname(PANE_SRC);
  const files = [PANE_SRC, ...fs.readdirSync(paneDir).filter((f) => f.endsWith(".ts") && f !== "taskpane.ts").map((f) => path.join(paneDir, f))];
  const ids = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const idOf = {};
    for (const mm of src.matchAll(/\b(\w+) = document\.getElementById\("([^"]+)"\)/g)) idOf[mm[1]] = mm[2];
    for (const mm of src.matchAll(/\b(\w+) = el<[^>]+>\("([^"]+)"\)/g)) idOf[mm[1]] = mm[2];
    const lines = src.split("\n");
    const re = /\b(\w+)\.addEventListener\("click",/;
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (!m || !idOf[m[1]]) continue;
      const ctx = lines.slice(i, i + 3).join(" ");
      if (/insert|Insert|Handler|apply|Apply|scan|Scan|runAudit|update|Update|readTable|detect|Detect|preview|Preview|Table|Citation|Dialog|readSelected/.test(ctx)) {
        if (!ids.includes(idOf[m[1]])) ids.push(idOf[m[1]]);
      }
    }
  }
  return ids;
}

/** Source lines of every real (non-comment) Word.run call, per file. */
function sitesInSource() {
  const sites = [];
  for (const f of hostSources()) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    // A site is a Word.run (pane or host) or a pane call into the host
    // (`docHost.method(`): the latter keeps coverage per CALLER once many
    // callers share one host transaction.
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      // (capability() is a synchronous probe that opens no batch, so no stack
      // can ever reach it; it is not a document site.)
      if (/Word\.run\(/.test(l) || /\bdocHost\.(?!capability\()\w+\(/.test(l)) {
        sites.push({ file: path.relative(ROOT, f).replace(/\\/g, "/"), line: i + 1 });
      }
    });
  }
  return sites;
}

function writeHarness() {
  const htmlPath = path.join(DIST, "taskpane.html");
  if (!fs.existsSync(htmlPath)) throw new Error("dist/taskpane.html not found — run `npm run build` first.");
  let html = fs.readFileSync(htmlPath, "utf8");
  const bundle = /src="(taskpane\.[a-f0-9]+\.js)"/.exec(html);
  if (!bundle) throw new Error("Could not find the taskpane bundle in dist/taskpane.html.");
  html = html.replace(/<script[^>]*appsforoffice[^>]*><\/script>/g, "");
  html = html.replace(/<script[^>]*src="taskpane\.[a-f0-9]+\.js"[^>]*><\/script>/g, "");
  const cssRef = /<link[^>]*href="([^"]+\.css)"[^>]*>/.exec(html);
  if (cssRef) {
    const cssPath = path.join(DIST, cssRef[1]);
    if (fs.existsSync(cssPath)) html = html.replace(cssRef[0], "<style>" + fs.readFileSync(cssPath, "utf8") + "</style>");
  }
  const cfg =
    "<script>window.__HT_ENUMS=" + JSON.stringify(deriveEnums()) +
    ";window.__HT_TARGETS=" + JSON.stringify(deriveTargets()) +
    ";window.__HT_SEEDS=" + JSON.stringify(SEEDS) +
    ";window.__HT_FIXTURES=" + JSON.stringify(FIXTURES) +
    ";window.__HT_DIALOGS=" + JSON.stringify(DIALOGS) +
    ";window.__HT_DEBUG=" + (process.env.HT_DEBUG ? "true" : "false") + ";</script>";
  html = html.replace("</head>", cfg + '<script src="htrec.js"></script></head>');
  html = html.replace("</body>", `<script src="${bundle[1]}"></script><script src="htdriver.js"></script></body>`);
  fs.writeFileSync(path.join(DIST, "host-trace-harness.html"), html);
  fs.copyFileSync(path.join(__dirname, "host-trace-recorder.js"), path.join(DIST, "htrec.js"));
  fs.copyFileSync(path.join(__dirname, "host-trace-driver.js"), path.join(DIST, "htdriver.js"));
  return bundle[1];
}

/**
 * Runs the harness and collects the driver's console output. The driver prints
 * its results as HTRESULT chunks and then HTEND; the browser is killed at HTEND.
 *
 * REAL TIME, NOT --virtual-time-budget. Virtual time races ahead of work the
 * browser does off the main timeline (decoding the SVG image a figure is
 * rasterised from), so a segment could be cut off before its picture landed,
 * and a page that never goes idle never drains the budget at all.
 */
function drive(browser, profileArg) {
  return new Promise((resolve) => {
    const child = spawn(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        profileArg,
        "--enable-logging=stderr",
        "--v=0",
        "file:///" + path.join(DIST, "host-trace-harness.html").replace(/\\/g, "/"),
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    const chunks = [];
    let buf = "";
    let done = false;
    const end = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => end(null), +(process.env.HT_TIMEOUT || 600000));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (process.env.HT_DEBUG && /"HT(JOB|TAKE|FINISH)/.test(line)) console.log(/"(HT[^"]*)"/.exec(line)[1]);
        const m = /"HTRESULT ([A-Za-z0-9+/=]+)"/.exec(line);
        if (m) chunks.push(m[1]);
        else if (/"HTEND"/.test(line)) end(JSON.parse(Buffer.from(chunks.join(""), "base64").toString("utf8")));
      }
    });
    child.on("exit", () => end(null));
  });
}

async function mapCallSites(bundleName, frames) {
  const { SourceMapConsumer } = require("source-map");
  const map = JSON.parse(fs.readFileSync(path.join(DIST, bundleName + ".map"), "utf8"));
  const consumer = await new SourceMapConsumer(map);
  const hits = new Map();
  for (const stack of frames) {
    // Every frame of the stack counts once: the Word.run line in the host AND
    // the pane line that called the host method.
    const seen = new Set();
    for (const fr of stack.split("\n")) {
      const m = /:(\d+):(\d+)\)?\s*$/.exec(fr);
      if (!m) continue;
      const pos = consumer.originalPositionFor({ line: +m[1], column: +m[2] - 1 });
      if (!pos.source) continue;
      const src = pos.source.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "");
      seen.add(src + ":" + pos.line);
    }
    for (const key of seen) hits.set(key, (hits.get(key) || 0) + 1);
  }
  if (consumer.destroy) consumer.destroy();
  return hits;
}

function render(segments) {
  const out = [];
  for (const s of segments) {
    if (!s.ops.length) continue; // a click that never touched the document
    out.push("== " + s.label);
    for (const o of s.ops) out.push(o);
    out.push("   status: " + s.status.replace(/\s+/g, " ").trim());
  }
  return out.join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this gate).");
    return 2;
  }
  const bundleName = writeHarness();
  const profile = makeProfile("host-trace");
  let res;
  try {
    res = await drive(browser, profile.arg);
  } finally {
    profile.cleanup();
  }
  if (!res) {
    console.error("FAIL: the drive did not finish — no results (timed out).");
    return 1;
  }
  if (res.error) {
    console.error("FAIL: the driver threw:\n" + res.error);
    return 1;
  }
  const text = render(res.segments);
  const oi = args.indexOf("--out");
  if (oi >= 0) fs.writeFileSync(args[oi + 1], text);

  // ---- coverage ----
  const hits = await mapCallSites(bundleName, res.callSites);
  const sites = sitesInSource();
  const reached = sites.filter((s) => hits.has(s.file + ":" + s.line));
  const unreached = sites.filter((s) => !hits.has(s.file + ":" + s.line));
  const segs = res.segments.filter((s) => s.ops.length).length;
  console.log(`Host trace: ${segs} segments touched the document; ${text.split("\n").length} trace lines.`);
  console.log(`Coverage: ${reached.length} of ${sites.length} sites reached (Word.run batches + pane calls into the host).`);
  if (args.includes("--verbose")) {
    const idle = res.segments.filter((s) => !s.ops.length && s.label !== "(boot)");
    console.log(`Clicks that never touched the document (${idle.length}):`);
    for (const s of idle) console.log(`  ${s.label}  — ${s.status.replace(/\s+/g, " ").trim().slice(0, 90)}`);
  }
  if (unreached.length && args.includes("--verbose")) {
    for (const s of unreached) console.log(`  unreached  ${s.file}:${s.line}`);
  }
  const stray = [...hits.keys()].filter((k) => !sites.some((s) => s.file + ":" + s.line === k));
  if (stray.length) console.log(`  (call frames that map to no Word.run line: ${stray.slice(0, 5).join(", ")})`);

  if (args.includes("--write")) {
    fs.writeFileSync(GOLDEN, text);
    console.log("Wrote " + path.relative(ROOT, GOLDEN));
    return 0;
  }
  if (!fs.existsSync(GOLDEN)) {
    console.error("FAIL: no golden trace — run with --write on the pre-change code first.");
    return 1;
  }
  const gold = fs.readFileSync(GOLDEN, "utf8").replace(/\r\n/g, "\n");
  if (gold === text) {
    console.log("ok    trace identical to the golden trace.");
    return 0;
  }
  const a = gold.split("\n");
  const b = text.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let seg = "";
  for (let j = i; j >= 0; j--) if ((a[j] || "").startsWith("== ")) { seg = a[j]; break; }
  console.error("FAIL: trace differs from the golden trace.");
  console.error(`  first difference at line ${i + 1}, in ${seg || "(before any segment)"}`);
  for (let k = Math.max(0, i - 3); k < Math.min(Math.max(a.length, b.length), i + 6); k++) {
    if (a[k] === b[k]) console.error("    " + (a[k] || ""));
    else {
      if (a[k] !== undefined) console.error("  - " + a[k]);
      if (b[k] !== undefined) console.error("  + " + b[k]);
    }
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("host-trace failed: " + ((e && e.stack) || e));
    process.exit(1);
  }
);
