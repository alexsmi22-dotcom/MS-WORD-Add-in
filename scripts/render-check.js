/* eslint-disable no-undef */
// Headless render check — the layer between the unit tests and the manual pass.
//
// Unit tests cover the engine but cannot see the pane; the manual in-Word script
// sees the pane but costs 30 minutes of a human. Everything in between — "does
// each tool actually render, and only its own section?" — was covered by nothing,
// which is how the Analyze controls came to sit under the Home tiles for six
// versions until a user noticed.
//
// This boots the REAL production bundle in headless Chromium against a stubbed
// Office, drives every mode, and asserts what renders. Word's task pane runs on
// WebView2, which is Chromium — the same engine — so this exercises the real
// rendering path, not a simulation of it.
//
// It does NOT replace the manual pass: it cannot see layout, styling, or
// anything that needs a live Word document (insertion, document scanning). It
// catches the wiring class of bug, which is the class that has actually shipped.
//
//   node scripts/render-check.js        (expects `npm run build` to have run)

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/** First Chromium-family browser we can find. */
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

/** Builds harness.html: the built pane, with Office stubbed and the driver appended. */
function writeHarness() {
  const htmlPath = path.join(DIST, "taskpane.html");
  if (!fs.existsSync(htmlPath)) {
    throw new Error("dist/taskpane.html not found — run `npm run build` first.");
  }
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
  html = html.replace("</body>", `<script src="${bundle[1]}"></script><script src="driver.js"></script></body>`);

  fs.writeFileSync(path.join(DIST, "harness.html"), html);
  // The driver lives in scripts/ (dist/ is gitignored); copy it beside the harness.
  fs.copyFileSync(path.join(__dirname, "render-driver.js"), path.join(DIST, "driver.js"));
}

function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this check).");
    return 0;
  }
  writeHarness();

  const outFile = path.join(os.tmpdir(), "jurislab-render-dom.html");
  const dom = execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=20000",
      "--dump-dom",
      "file:///" + path.join(DIST, "harness.html").replace(/\\/g, "/"),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  fs.writeFileSync(outFile, dom);

  const m = /data-results="([^"]*)"/.exec(dom);
  if (!m) {
    console.error("FAIL: the pane did not finish booting — no results were produced.");
    console.error("      Rendered DOM saved to " + outFile);
    return 1;
  }
  const decode = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  const lines = decode(m[1]).split(" ||| ");

  const failures = [];
  const get = (prefix) => lines.find((l) => l.startsWith(prefix));

  const err = lines.find((l) => l.startsWith("ERROR:"));
  if (err) failures.push(err + " / " + (get("STACK:") || ""));

  // 1. The pane booted and found every section and mode.
  const booted = get("BOOTED");
  if (!booted) failures.push("the pane never booted");

  // 2. Home shows ONLY the tiles. This is the regression that shipped.
  const leaks = get("HOME_LEAKS=");
  if (leaks !== "HOME_LEAKS=none") failures.push("tool sections visible on Home -> " + leaks);

  // 3. Every tool has a Home tile.
  const tiles = Number((get("HOME_TILES=") || "").split("=")[1]);
  if (!(tiles >= 22)) failures.push("expected >=22 Home tiles, got " + tiles);

  // 4. Every mode shows exactly one section, and has help content.
  for (const line of lines.filter((l) => l.startsWith("MODE "))) {
    const mm = /^MODE (\S+) shown=(\S+) examples=(-?\d+)$/.exec(line);
    if (!mm) {
      failures.push("unparseable: " + line);
      continue;
    }
    const [, mode, shown, exLen] = mm;
    if (mode === "home") {
      if (shown !== "home-section") failures.push("Home shows " + shown);
      continue;
    }
    const parts = shown.split("+");
    if (parts.length !== 1) failures.push(`${mode} shows ${parts.length} sections: ${shown}`);
    // chemical and math intentionally share format-section.
    const expected = mode === "chemical" || mode === "math" ? "format-section" : `${mode}-section`;
    if (shown !== expected) failures.push(`${mode} shows "${shown}", expected "${expected}"`);
    if (Number(exLen) < 30) failures.push(`${mode} has no Examples & syntax content (${exLen} chars)`);
  }

  // 4b. The Home audience filter narrows the cards without stranding a tool.
  const total = Number((get("FILTER_DEFAULT=") || "").split("=")[1]);
  if (!(total >= 22)) failures.push(`Home shows ${total} cards by default, expected all 22 (nothing hidden until asked)`);
  const sci = get("FILTER_SCIENCE=") || "";
  if (!/citations=false/.test(sci)) failures.push("the Science filter still shows Citations — the exact clutter it exists to remove");
  if (!/spectra=true/.test(sci)) failures.push("the Science filter hides Spectra");
  if (!/math=true/.test(sci)) failures.push("the Science filter hides Math (an everyone tool)");
  if (!/sequence=true/.test(sci)) failures.push("the Science filter hides Sequence");
  const leg = get("FILTER_LEGAL=") || "";
  if (!/citations=true/.test(leg)) failures.push("the Patent/legal filter hides Citations");
  if (!/spectra=false/.test(leg)) failures.push("the Patent/legal filter still shows Spectra");
  // Sequence is ST.26 — a patent filing format. Hiding it from the legal filter
  // would strand the biotech patent attorney, who is the whole point.
  if (!/sequence=true/.test(leg)) failures.push("the Patent/legal filter hides Sequence (ST.26 is a patent format)");
  const dd = Number((get("FILTER_DROPDOWN=") || "").split("=")[1]);
  if (!(dd >= 23)) failures.push(`the dropdown lost entries under a filter (${dd}) — every tool must stay reachable`);
  const restored = Number((get("FILTER_RESTORED=") || "").split("=")[1]);
  if (restored !== total) failures.push(`"All tools" did not restore every card (${restored} vs ${total})`);

  // 4c. Sequence Map — the new file-reading surface.
  const gb = get("SEQMAP_GB") || "";
  if (!/svg=1/.test(gb)) failures.push("Sequence Map did not draw an SVG for a GenBank record");
  if (!/paths=2/.test(gb)) failures.push("Sequence Map drew the wrong number of features -> " + gb);
  if (!/insert=true/.test(gb)) failures.push("Sequence Map did not enable Insert for a valid record");
  if (!/file=true/.test(gb)) failures.push("Sequence Map is missing its file input");
  // Auto must follow the record's topology, both ways.
  if (!/circles=1/.test(get("SEQMAP_AUTO_CIRC") || "")) {
    failures.push("a circular record did not draw a circular map on Auto");
  }
  if (!/w=460/.test(get("SEQMAP_AUTO_CIRC") || "")) {
    failures.push("the circular map is not square — it would stretch when inserted");
  }
  if (!/circles=0/.test(get("SEQMAP_AUTO_LIN") || "")) {
    failures.push("a LINEAR record was drawn as a ring — that misrepresents the construct");
  }
  // Junk must never leave Insert armed — a bad figure in a paper is worse than none.
  if (!/insert=false/.test(get("SEQMAP_JUNK") || "")) {
    failures.push("Sequence Map left Insert enabled for an unparseable file");
  }

  // 5. Spectra computes and keeps its caveat.
  const rows = Number((get("SPECTRA_ROWS=") || "").split("=")[1]);
  if (!(rows >= 4)) failures.push("Spectra did not render signal rows for toluene (got " + rows + ")");
  if (get("SPECTRA_HAS_CAVEAT=") !== "SPECTRA_HAS_CAVEAT=true") {
    failures.push("the Spectra result lost its caveat — that is a correctness failure, not cosmetic");
  }

  // 6. The ODE tool solves its default, including the auto-reduction.
  const ode = get("ODE_TEXT=") || "";
  if (!/Auto-reduced/.test(ode)) failures.push("ODE did not auto-reduce y'' = -y");
  if (!/Solved over/.test(ode)) failures.push("ODE did not solve its default example");

  // 7. The chemical preview still formats.
  const chem = get("CHEM_PREVIEW=") || "";
  if (!/<sub>2<\/sub>/.test(chem)) failures.push("chemical preview did not subscript H2O -> " + chem);

  if (failures.length) {
    console.error("RENDER CHECK FAILED:");
    for (const f of failures) console.error("  - " + f);
    console.error("Rendered DOM saved to " + outFile);
    return 1;
  }

  const modeCount = lines.filter((l) => l.startsWith("MODE ")).length;
  console.log(`PASS: pane boots; ${modeCount} modes each render their own section with help content;`);
  console.log("      Home shows only tiles; Spectra computes with its caveat; ODE auto-reduces and solves.");
  return 0;
}

try {
  process.exit(run());
} catch (e) {
  console.error("RENDER CHECK ERROR: " + e.message);
  process.exit(1);
}
