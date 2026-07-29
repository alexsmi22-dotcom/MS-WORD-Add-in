// QC gate: the landing page must not overlap its own text or spill sideways,
// at any width, on any of the hero demo's tabs.
//
//   node scripts/check-landing-overlap.js            (part of `npm run qc`)
//   node scripts/check-landing-overlap.js --page X   check a different page
//
// Exits 0 clean, 1 on findings, and 2 when no Chromium-family browser is
// installed — same contract as scripts/render-check.js. Skip is NOT success:
// exit 0 there made qc.ps1 print "ALL AUTOMATED QC PASSED" having checked
// nothing, and this is one of only two gates that sees real rendered output.
//
// Everything runs in ONE browser launch. The page is loaded in an iframe and
// the iframe is resized between measurements, because media queries respond to
// the iframe's width. Launching Edge once per width took minutes; this takes
// seconds, which is the difference between a gate that gets run and one that
// gets skipped.
//
// The five hidden demo panels are the reason the tab loop exists: they are
// display:none until their tab is clicked, so a whole-page sweep only ever
// measures the Chemical panel. The one real bug this check was written after —
// a statistics table losing two columns below 940px — lived in a hidden panel
// and is invisible to any check that does not open each tab.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

/**
 * Distinct exit code for "the check could not run". A browser that will not
 * start and a page that genuinely overlaps are both failures, but they call for
 * opposite responses, and reporting them identically sent a real debugging
 * session after a layout regression that did not exist.
 */
const INFRA = 2;

const ROOT = path.join(__dirname, "..");

const WIDTHS = [1440, 1280, 1024, 940, 900, 820, 700, 600, 420];
const TAB_WIDTHS = [1280, 560];

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => fs.existsSync(p)) || null;
}

function harnessHtml(pageFile) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0}#frame{border:0;display:block;height:3200px}</style>
<script src="landing-overlap-driver.js"></script>
</head><body>
<iframe id="frame" src="${pageFile}" width="1280"></iframe>
<pre id="OVERLAP-REPORT"></pre>
<script>
(function(){
  var WIDTHS = ${JSON.stringify(WIDTHS)};
  var TAB_WIDTHS = ${JSON.stringify(TAB_WIDTHS)};
  var f = document.getElementById('frame');
  var report = document.getElementById('OVERLAP-REPORT');
  var found = [];

  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function setW(w){ f.style.width = w + 'px'; f.width = w; return wait(140); }

  async function go(){
    var doc = f.contentDocument, win = f.contentWindow;
    if(!doc || !win){ report.textContent = 'ERROR: cannot reach the iframe document ' +
      '(needs --allow-file-access-from-files)'; document.title = 'DONE'; return; }

    // Kill transitions/animations inside the page: a box captured mid-transition
    // is not a layout fact, and produced a phantom finding once already.
    var st = doc.createElement('style');
    st.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    doc.head.appendChild(st);

    for(var i=0;i<WIDTHS.length;i++){
      await setW(WIDTHS[i]);
      found = found.concat(window.__overlapDetect(doc, win, '[w=' + WIDTHS[i] + ']'));
    }

    var tabs = Array.prototype.slice.call(doc.querySelectorAll('[role="tab"]'));
    for(var t=0;t<TAB_WIDTHS.length;t++){
      await setW(TAB_WIDTHS[t]);
      for(var k=0;k<tabs.length;k++){
        tabs[k].click();                 // also stops the auto-rotation
        await wait(90);
        var name = tabs[k].id || ('tab' + k);
        found = found.concat(window.__overlapDetect(doc, win, '[w=' + TAB_WIDTHS[t] + ' ' + name + ']'));
      }
    }

    report.textContent = found.length ? found.join('\\n') : 'CLEAN';
    document.title = 'DONE';
  }
  f.addEventListener('load', function(){ setTimeout(go, 150); });
})();
</script></body></html>`;
}

/**
 * Every published landing page, discovered rather than listed.
 *
 * All five deploy together and are equally public. Hardcoding the list is how
 * index.html ended up as the only one checked; globbing means a new page is
 * covered the moment it exists.
 */
/** index.html is the only page with the interactive hero demo tabs. */
function isIndex(p) {
  return path.basename(p) === "index.html";
}

function landingPages() {
  const dir = path.join(ROOT, "landing");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Layout-checks one page. Returns 0 clean, 1 on problems. */
function checkPage(browser, pageSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jurislab-overlap-"));
  fs.copyFileSync(pageSrc, path.join(dir, "page.html"));
  fs.copyFileSync(path.join(__dirname, "landing-overlap-driver.js"),
                  path.join(dir, "landing-overlap-driver.js"));
  fs.writeFileSync(path.join(dir, "harness.html"), harnessHtml("page.html"));

  let dom;
  try {
    dom = execFileSync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",   // the harness reads into the iframe
      "--virtual-time-budget=30000",
      "--window-size=1600,3400",
      "--user-data-dir=" + path.join(dir, "profile"),
      "--dump-dom",
      "file:///" + path.join(dir, "harness.html").replace(/\\/g, "/"),
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] , timeout: 180000, killSignal: "SIGKILL" });
  } catch (e) {
    // INFRASTRUCTURE, NOT LAYOUT. Returning the same code as a real overlap made
    // a browser that would not start report as "1 of 5 landing pages have layout
    // problems" — so the pages looked broken when nothing had been measured at
    // all. Two cycles were spent hunting a layout regression that did not exist.
    // A check that cannot run must say so in different words from a check that
    // ran and found something.
    console.error("BROWSER FAILED TO START — nothing was measured on " + path.basename(pageSrc));
    console.error("  " + String(e.message).split("\n")[0]);
    return INFRA;
  }

  const m = /<pre id="OVERLAP-REPORT">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) {
    console.error("HARNESS PRODUCED NO REPORT for " + path.basename(pageSrc) + " — the page did not load.");
    console.error("  This is a harness problem, not a layout problem: nothing was measured.");
    return INFRA;
  }
  const body = m[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .trim();

  if (body === "CLEAN") {
    console.log(`  PASS ${path.basename(pageSrc)} — no overlaps or overflow across ` +
                `${WIDTHS.length} widths (${WIDTHS.join(", ")}px)` +
                `${isIndex(pageSrc) ? ` and every hero demo tab at ${TAB_WIDTHS.join(" and ")}px` : ""}.`);
    return 0;
  }
  if (body.startsWith("ERROR")) {
    console.error("FAIL: " + body);
    return 1;
  }

  const lines = body.split("\n").filter((l) => l.trim());
  console.error(`  FAIL ${path.relative(ROOT, pageSrc)} — ${lines.length} layout problem(s):`);
  for (const l of lines.slice(0, 40)) console.error("    " + l);
  if (lines.length > 40) console.error(`    ...and ${lines.length - 40} more`);
  return 1;
}

function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this check).");
    // Exit 2, NOT 0. Returning 0 made the caller record a PASS for a check
    // that inspected nothing — and these two are the only gates that see
    // the real rendered output, so a false green here is the worst kind.
    return 2;
  }

  const argIdx = process.argv.indexOf("--page");
  const pages = argIdx !== -1 ? [path.resolve(process.argv[argIdx + 1])] : landingPages();

  const missing = pages.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error("FAIL: page not found: " + missing.join(", "));
    return 1;
  }
  if (!pages.length) {
    // An empty glob must not read as success.
    console.error("FAIL: no landing pages found to check.");
    return 1;
  }

  console.log(`Checking ${pages.length} landing page(s):`);
  let failed = 0;
  let infra = 0;
  for (const p of pages) {
    const code = checkPage(browser, p);
    if (code === INFRA) infra++;
    else if (code !== 0) failed++;
  }

  // Report the two causes separately. Both still fail the gate — a check that
  // could not run must never pass — but they call for opposite responses: one
  // means fix the page, the other means fix the machine.
  if (infra) {
    console.error(
      `FAIL: the browser could not run on ${infra} of ${pages.length} page(s), so they were NOT CHECKED.`
    );
    console.error("  This is an environment problem, not a layout problem.");
    console.error("  Commonest cause: leftover headless browser processes from an earlier run.");
    console.error("  On Windows, clear only the headless ones (leave your own browser alone):");
    console.error(
      "    Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" |" +
        " Where-Object { $_.CommandLine -like '*--headless*' } | Stop-Process -Force"
    );
    console.error("  Then remove any stale profiles: Remove-Item $env:TEMP\\jurislab-* -Recurse -Force");
  }
  if (failed) {
    console.error(`FAIL: ${failed} of ${pages.length} landing page(s) have layout problems.`);
  }
  if (infra || failed) return 1;
  console.log(`PASS: all ${pages.length} landing pages are clean.`);
  return 0;
}

try {
  process.exit(run());
} catch (err) {
  console.error("FAIL: " + (err && err.message ? err.message : err));
  process.exit(1);
}
