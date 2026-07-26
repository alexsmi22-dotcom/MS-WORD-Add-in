/* eslint-disable no-undef */
// Horizontal-overflow gate for the TASK PANE, at the widths Word actually uses.
//
// WHY THIS EXISTS
// The landing pages had a layout gate; the pane — the actual product — had none.
// The render check proves each mode renders its own section, and the id audit
// proves the wiring, but neither looks at geometry, so content could sit off the
// right edge and every gate stayed green.
//
// Horizontal overflow in a task pane is not a cosmetic wobble. The pane scrolls
// VERTICALLY; there is no horizontal scrollbar, so anything past the right edge
// is unreachable rather than merely awkward — a clipped button cannot be
// clicked. Word gives the pane ~320-500 CSS px and the user drags it narrower at
// will, so "it looks fine on my monitor" proves nothing.
//
// Same shape as check-landing-overlap.js: ONE browser launch, an iframe resized
// across the width range, every mode driven at each width.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// The range Word permits. 320 is about as narrow as the pane goes; beyond ~500
// the user is deliberately giving it half the document and nothing is at risk.
const WIDTHS = [320, 350, 375, 400, 450, 500];

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

/** The pane, with Office stubbed — same contract as render-check.js. */
function writePaneHarness(dir) {
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
    "InsertLocation:{replace:'replace',after:'after',end:'end'},SelectionMode:{end:'end'}};" +
    "window.__bootOffice=function(){if(window.__officeCb)window.__officeCb({host:'Word'});};</script>";
  html = html.replace("</head>", stub + "</head>");
  html = html.replace("</body>", `<script src="${bundle[1]}"></script></body>`);

  fs.writeFileSync(path.join(dir, "pane.html"), html);
  // The hashed bundle and the stylesheet must sit beside it.
  for (const f of fs.readdirSync(DIST)) {
    if (/^taskpane\.[a-f0-9]+\.js$/.test(f) || f === "taskpane.css" || /\.(css|woff2?)$/.test(f)) {
      fs.copyFileSync(path.join(DIST, f), path.join(dir, f));
    }
  }
  const assets = path.join(DIST, "assets");
  if (fs.existsSync(assets)) {
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    for (const f of fs.readdirSync(assets)) {
      fs.copyFileSync(path.join(assets, f), path.join(dir, "assets", f));
    }
  }
}

/** Outer page: resizes the iframe and measures inside it. */
function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
#f{border:0;display:block;height:1400px}
</style></head><body>
<iframe id="f" src="pane.html"></iframe>
<pre id="PANE-REPORT">PENDING</pre>
<script>
var WIDTHS = ${JSON.stringify(WIDTHS)};
function overflowing(doc, limit){
  var bad = [], all = doc.querySelectorAll("body *");
  for (var i=0;i<all.length;i++){
    var el = all[i];
    if (!el.offsetParent && el !== doc.body) continue;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > limit + 1) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className||"").toString().slice(0,50),
        right: Math.round(r.right),
        text: (el.textContent||"").trim().slice(0,34)
      });
    }
  }
  return bad;
}
function go(){
  var f = document.getElementById('f');
  var win = f.contentWindow, doc = f.contentDocument;
  var out = [];
  try {
    win.__bootOffice();
  } catch(e) { report("ERROR booting Office stub: " + e.message); return; }

  setTimeout(function(){
    var sel = doc.getElementById('mode-select');
    if (!sel) { report("ERROR: #mode-select not found — the pane did not boot."); return; }
    var modes = [].slice.call(sel.querySelectorAll('option')).map(function(o){return o.value;});

    for (var w=0; w<WIDTHS.length; w++){
      var width = WIDTHS[w];
      f.style.width = width + "px";
      // Force layout at the new width before measuring.
      void doc.body.offsetWidth;
      for (var m=0; m<modes.length; m++){
        sel.value = modes[m];
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        void doc.body.offsetWidth;
        var limit = doc.documentElement.clientWidth;
        var bad = overflowing(doc, limit);
        if (bad.length){
          // Outermost offender per class is enough to find the cause; a clipped
          // parent drags every child past the edge too.
          var seen = {}, top = [];
          for (var b=0;b<bad.length;b++){
            var k = bad[b].cls || bad[b].tag;
            if (seen[k]) continue;
            seen[k] = 1; top.push(bad[b]);
          }
          var line = width + "px " + modes[m] + ": " + bad.length + " element(s) past the edge";
          for (var t=0; t<Math.min(3, top.length); t++){
            line += "\\n      <" + top[t].tag + " class=\\"" + top[t].cls + "\\"> right=" + top[t].right + "/" + limit + " \\"" + top[t].text + "\\"";
          }
          out.push(line);
        }
      }
    }
    report(out.length ? out.join("\\n") : "CLEAN");
  }, 600);
}
function report(t){ document.getElementById('PANE-REPORT').textContent = t; document.title='DONE'; }
document.getElementById('f').addEventListener('load', function(){ setTimeout(go, 200); });
</script></body></html>`;
}

function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this check).");
    return 2; // never 0 — a check that inspected nothing must not read as a pass
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jurislab-pane-"));
  writePaneHarness(dir);
  fs.writeFileSync(path.join(dir, "harness.html"), harnessHtml());

  let dom;
  try {
    dom = execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--allow-file-access-from-files",
        "--virtual-time-budget=40000",
        "--window-size=1200,1600",
        "--user-data-dir=" + path.join(dir, "profile"),
        "--dump-dom",
        "file:///" + path.join(dir, "harness.html").replace(/\\/g, "/"),
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (e) {
    console.error("FAIL: browser run failed — " + e.message);
    return 1;
  }

  const m = /<pre id="PANE-REPORT">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) {
    console.error("FAIL: harness produced no report (the pane may not have loaded).");
    return 1;
  }
  const body = m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();

  if (body === "PENDING") {
    console.error("FAIL: the harness never finished measuring.");
    return 1;
  }
  if (body === "CLEAN") {
    console.log(`PASS: no pane content runs past the right edge at ${WIDTHS.join(", ")}px.`);
    return 0;
  }
  if (body.startsWith("ERROR")) {
    console.error("FAIL: " + body);
    return 1;
  }

  const lines = body.split("\n").filter((l) => l.trim());
  console.error("FAIL: pane content is unreachable off the right edge:");
  for (const l of lines.slice(0, 40)) console.error("  " + l);
  if (lines.length > 40) console.error(`  ...and ${lines.length - 40} more`);
  return 1;
}

try {
  process.exit(run());
} catch (err) {
  console.error("FAIL: " + (err && err.message ? err.message : err));
  process.exit(1);
}
