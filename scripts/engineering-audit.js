/* eslint-disable no-undef */
// Comprehensive Engineering audit — boots the real production bundle in headless
// Chromium and drives all 36 Engineering calculators.
//
// This exists because the unit suite is structurally blind to the layer where
// every Engineering defect that reached a user actually lived: not in the
// engines, which have ~5,700 tests behind them, but in the pane above them.
//
//   node scripts/engineering-audit.js        (expects `npm run build` to have run)
//
// Exit 0 = nothing found, 1 = findings, 2 = skipped (no browser).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { makeProfile } = require("./headless-profile.js");

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

function writeHarness() {
  const htmlPath = path.join(DIST, "taskpane.html");
  if (!fs.existsSync(htmlPath)) throw new Error("dist/taskpane.html not found — run `npm run build` first.");
  let html = fs.readFileSync(htmlPath, "utf8");
  const bundle = /src="(taskpane\.[a-f0-9]+\.js)"/.exec(html);
  if (!bundle) throw new Error("Could not find the taskpane bundle in dist/taskpane.html.");

  html = html.replace(/<script[^>]*appsforoffice[^>]*><\/script>/g, "");
  html = html.replace(/<script[^>]*src="taskpane\.[a-f0-9]+\.js"[^>]*><\/script>/g, "");
  // The stub must carry EVERY Word enum the pane dereferences. It first
  // carried only two, so `Word.RangeLocation.after` threw a TypeError on the
  // very first line of every insert handler and the audit reported all 36
  // tools as inserting nothing. A harness that is missing a constant reports
  // a product-wide catastrophe, so the enum list is derived from the source
  // rather than remembered.
  const paneSrc = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
  const enums = new Set();
  for (const mm of paneSrc.matchAll(/\bWord\.([A-Z][A-Za-z]*)\.([A-Za-z]+)/g)) {
    enums.add(mm[1] + "." + mm[2]);
  }
  const byNs = {};
  for (const e of enums) {
    const [ns, k] = e.split(".");
    (byNs[ns] = byNs[ns] || []).push(k);
  }
  const enumJs = Object.keys(byNs)
    .map((ns) => ns + ":{" + byNs[ns].map((k) => k + ":'" + k + "'").join(",") + "}")
    .join(",");
  const stub =
    "<script>window.Office={HostType:{Word:'Word'},onReady:function(cb){window.__officeCb=cb;}," +
    "context:{requirements:{isSetSupported:function(){return true;}}}};" +
    "window.Word={run:function(){return Promise.resolve();}," + enumJs + "};</script>";
  // INLINE THE STYLESHEET.
  //
  // The contrast check reads the real :hover rule out of document.styleSheets,
  // and on a file:// page Chromium refuses cssRules access to a stylesheet
  // loaded from a separate file — it throws SecurityError, which reads exactly
  // like "the rule does not exist". Inlining it makes the rules readable and
  // keeps the check honest about what the CSS actually declares.
  const cssRef = /<link[^>]*href="([^"]+\.css)"[^>]*>/.exec(html);
  if (cssRef) {
    const cssPath = path.join(DIST, cssRef[1]);
    if (fs.existsSync(cssPath)) {
      html = html.replace(cssRef[0], "<style>" + fs.readFileSync(cssPath, "utf8") + "</style>");
    }
  }
  html = html.replace("</head>", stub + "</head>");
  html = html.replace("</body>", `<script src="${bundle[1]}"></script><script src="engdriver.js"></script></body>`);

  fs.writeFileSync(path.join(DIST, "eng-harness.html"), html);
  fs.copyFileSync(path.join(__dirname, "engineering-audit-driver.js"), path.join(DIST, "engdriver.js"));
}

function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this audit).");
    return 2;
  }
  writeHarness();

  // Without an explicit profile the browser leaves a scoped_dir behind in TEMP on
  // every launch. See scripts/headless-profile.js.
  const profile = makeProfile("audit");
  let dom;
  try {
    dom = execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        profile.arg,
        "--virtual-time-budget=60000",
        "--dump-dom",
        "file:///" + path.join(DIST, "eng-harness.html").replace(/\\/g, "/"),
      ],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 , timeout: 180000, killSignal: "SIGKILL" }
    );
  } finally {
    profile.cleanup();
  }

  const m = /data-results="([^"]*)"/.exec(dom);
  if (!m) {
    const outFile = path.join(os.tmpdir(), "jurislab-eng-audit-dom.html");
    fs.writeFileSync(outFile, dom);
    console.error("FAIL: the pane did not finish the audit — no results were produced.");
    console.error("      Rendered DOM saved to " + outFile);
    return 1;
  }
  const decode = (s) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const lines = decode(m[1]).split(" ||| ");

  const err = lines.find((l) => l.startsWith("ERROR:"));
  if (err) {
    console.error(err);
    console.error(lines.find((l) => l.startsWith("STACK:")) || "");
    return 1;
  }

  const toolCount = (lines.find((l) => l.startsWith("TOOLS=")) || "TOOLS=0").split("=")[1];
  const defaults = lines.filter((l) => l.startsWith("DEFAULT "));
  const blanks = lines.filter((l) => l.startsWith("BLANK "));
  const oneBlanks = lines.filter((l) => l.startsWith("ONEBLANK "));
  const options = lines.filter((l) => l.startsWith("OPTION "));
  const junk = lines.filter((l) => l.startsWith("JUNK "));
  const inserts = lines.filter((l) => l.startsWith("INSERT "));

  console.log(`Engineering audit — ${toolCount} tools driven in the real bundle\n`);

  const findings = [];

  // If the checks themselves are broken, every "ok" below is worthless, so this
  // is reported first and loudest rather than buried at the end.
  const self = lines.find((l) => l.startsWith("SELFTEST ")) || "SELFTEST MISSING";
  if (!/^SELFTEST ok$/.test(self)) {
    findings.push(self);
    console.log(`  FLAG  self-test: ${self.slice(9)} — the checks below prove nothing.\n`);
  } else {
    console.log("  ok    self-test: every check tripped on a known-bad payload.\n");
  }

  const menu = lines.find((l) => l.startsWith("MENU ")) || "";
  const loose = Number((/loose=(\d+)/.exec(menu) || [, "-1"])[1]);
  const grouped = Number((/grouped=(\d+)/.exec(menu) || [, "-1"])[1]);
  const menuOk = loose === 0 && grouped === Number(toolCount) && grouped > 0;
  if (!menuOk) findings.push(menu || "MENU MISSING");
  const panels = lines.find((l) => l.startsWith("PANELS ")) || "";
  const click = lines.find((l) => l.startsWith("PANELCLICK ")) || "";
  const panelCount = Number((/panels=(\d+)/.exec(panels) || [, "0"])[1]);
  const panelTools = Number((/tools=(\d+)/.exec(panels) || [, "0"])[1]);
  const openAtStart = Number((/openAtStart=(\d+)/.exec(panels) || [, "-1"])[1]);
  const panelsOk = panelCount > 1 && panelTools === Number(toolCount) && openAtStart === 1;
  const clickOk = / ok$/.test(click);
  if (!panelsOk) findings.push(panels || "PANELS MISSING");
  if (!clickOk) findings.push(click || "PANELCLICK MISSING");
  const contrast = lines.filter((l) => l.startsWith("CONTRAST "));
  console.log("--- Readability in both themes ---------------------------------");
  if (!contrast.length) findings.push("CONTRAST MISSING — the check did not run");
  for (const l of contrast) {
    const ok = / ok$/.test(l);
    if (!ok) findings.push(l);
    console.log(`  ${ok ? "ok  " : "FLAG"}  ${l.slice(9)}`);
  }
  console.log("        (WCAG AA body text is 4.5:1; below that is the dark-mode bug)");
  console.log("");

  console.log("--- Discipline panels (the control the user actually clicks) ---");
  console.log(`  ${panelsOk ? "ok  " : "FLAG"}  ${panels.slice(7) || "no PANELS line"}`);
  console.log(`  ${clickOk ? "ok  " : "FLAG"}  ${click.slice(11) || "no PANELCLICK line"}`);
  console.log("");

  console.log("--- The select behind them (still the state holder) ------------");
  console.log(`  ${menuOk ? "ok  " : "FLAG"}  ${menu.slice(5) || "no MENU line produced"}`);
  console.log("");

  const revisit = lines.find((l) => l.startsWith("REVISIT ")) || "";
  const revisitOk = / ok$/.test(revisit);
  if (!revisitOk) findings.push(revisit || "REVISIT MISSING");
  console.log(`  ${revisitOk ? "ok  " : "FLAG"}  leaving and re-entering Engineering 3x: ${revisit.slice(8) || "no result"}`);
  console.log("");

  console.log("--- On their own defaults -------------------------------------");
  for (const l of defaults) {
    const clean = / flags=clean /.test(l);
    if (!clean) findings.push(l);
    const tool = l.split(" ")[1];
    const flags = (/flags=(\S+)/.exec(l) || [, "?"])[1];
    const ins = (/insert=(\S+)/.exec(l) || [, "?"])[1];
    const len = (/len=(\d+)/.exec(l) || [, "?"])[1];
    console.log(`  ${clean ? "ok  " : "FLAG"}  ${tool.padEnd(20)} len=${String(len).padStart(5)} insert=${ins.padEnd(3)} ${flags}`);
    if (!clean) console.log(`        ${l.split(":: ")[1] || ""}`);
  }

  console.log("\n--- Every field blank -----------------------------------------");
  for (const l of blanks) {
    const ok = / issues=ok /.test(l);
    if (!ok) findings.push(l);
    const tool = l.split(" ")[1];
    const issues = (/issues=(\S+)/.exec(l) || [, "?"])[1];
    console.log(`  ${ok ? "ok  " : "FLAG"}  ${tool.padEnd(20)} ${issues}`);
    if (!ok) console.log(`        ${l.split(":: ")[1] || ""}`);
  }

  // ---------------------------------------------------------------------------
  // DIAGNOSTIC, NOT A GATE — and the reason is worth stating, because a gate that
  // cries wolf is worse than no gate.
  //
  // It exists because pass 2 clears EVERY field, which is not what a user does.
  // What they do is clear the one value they are unsure about, and that is how a
  // cleared thermal resistance became 0 K/W in v2.55.0 and silently deleted a
  // whole stage of a heat path.
  //
  // But "label does not say optional => blanking must refuse" turns out to be too
  // strong a convention for this codebase: `pipe` legitimately falls back to water
  // at 20 °C and SAYS so, a blank stress component is a defensible zero, and a
  // custom K only matters when the selector asks for it. It reports ~90 cases, of
  // which only a handful are the silent-zero defect.
  //
  // Telling them apart needs a judgement this script cannot make — the real
  // signature is whether the OUTPUT admits the substitution. So this prints for a
  // human and does NOT fail the build. Making it exact means curating a
  // required-fields list per tool, the way engineeringRouting.test.ts curates unit
  // contracts, and that is its own piece of work.
  // ---------------------------------------------------------------------------
  console.log("\n--- One required field blank (DIAGNOSTIC — needs human triage) -");
  {
    const bad = oneBlanks.filter((l) => !/ issues=ok /.test(l));
    const byTool = new Map();
    for (const l of bad) {
      const tool = l.split(" ")[1];
      byTool.set(tool, (byTool.get(tool) || 0) + 1);
    }
    console.log(
      `  ${bad.length} of ${oneBlanks.length} required-looking fields still computed when emptied alone,`,
    );
    console.log(`  across ${byTool.size} tools. Not a build failure: many are documented fallbacks`);
    console.log("  that state the substitution in their output. The ones to fix are those that");
    console.log("  do NOT say anything — that is the silent-zero defect.");
    const worst = [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [tool, n] of worst) console.log(`      ${tool.padEnd(20)} ${n}`);
  }

  // EVERY NON-DEFAULT DROPDOWN CHOICE, driven in the real bundle.
  //
  // A select is how this bench offers an alternative MODEL — a designed filter
  // edge, a density from a table, a power computed rather than typed — and the
  // defaults pass only ever sees whichever option the tool opens on. Every
  // other option is a code path nothing else in this audit enters, so a branch
  // that throws or returns nothing stays invisible until a user picks it.
  console.log("\n--- Every non-default select option ---------------------------");
  if (!options.length) {
    console.log("  ok    no tool has a second option to try");
  } else {
    const bad = options.filter((l) => !/ issues=ok /.test(l));
    for (const l of bad) findings.push(l);
    console.log(`  ${options.length - bad.length} of ${options.length} non-default options computed cleanly.`);
    for (const l of bad) {
      const parts = l.split(" ");
      console.log(`  FLAG  ${parts[1]} ${parts[2]}  ${(/issues=(\S+)/.exec(l) || [, "?"])[1]}`);
      console.log(`        ${l.split(":: ")[1] || ""}`);
    }
  }

  console.log("\n--- Rubbish in every field ------------------------------------");
  if (!junk.length) console.log("  ok    nothing produced a bad number or a sentinel");
  for (const l of junk) {
    findings.push(l);
    console.log(`  FLAG  ${l.slice(5)}`);
  }

  console.log("\n--- Inserting each result (against a recording Word mock) -----");
  for (const l of inserts) {
    const ok = /\bok$/.test(l);
    if (!ok) findings.push(l);
    console.log(`  ${ok ? "ok  " : "FLAG"}  ${l.slice(7)}`);
  }
  console.log("  NOTE: a mock always says yes. This proves the pane ATTEMPTS the right");
  console.log("        objects in the right order; it cannot prove Word honours them.");

  // ---------------------------------------------------------------------------
  // EVERY CALCULATOR SHOULD DRAW SOMETHING. A RATCHET, so it only goes up.
  //
  // The goal is a figure on every Engineering tool: a number in a document is
  // worth more beside the picture it came from, and for most of these the
  // picture IS the conventional way the result is communicated - a Mohr's
  // circle, a Goodman diagram, a drag polar, a P-v diagram.
  //
  // A ratchet on a COUNT rather than a list of names, matching how the
  // dead-export gate works and for the same reason: a hardcoded list stops
  // covering anything added after it was written.
  //
  // Raise this as disciplines are completed. Never lower it without a reason
  // written next to the change.
  const FIGURE_BASELINE = 34;
  const withFigure = inserts.filter((l) => /preview\[fig=[1-9]/.test(l));
  console.log("\n--- Figures (ratchet) -----------------------------------------");
  console.log(
    `  ${withFigure.length} of ${inserts.length} tools insert a figure (baseline ${FIGURE_BASELINE}).`,
  );
  if (withFigure.length < FIGURE_BASELINE) {
    findings.push(
      `FIGURES ${withFigure.length} tools draw, below the baseline of ${FIGURE_BASELINE} - a figure was removed`,
    );
    console.log(`  FLAG  a figure was LOST: ${withFigure.length} < ${FIGURE_BASELINE}`);
  } else if (withFigure.length > FIGURE_BASELINE) {
    console.log(`  RAISE the baseline to ${withFigure.length} in scripts/engineering-audit.js.`);
  }
  {
    const none = inserts
      .filter((l) => /preview\[fig=0/.test(l))
      .map((l) => l.split(" ")[1]);
    if (none.length) {
      console.log(`  Still text-only (${none.length}):`);
      for (let i = 0; i < none.length; i += 6) {
        console.log("      " + none.slice(i, i + 6).join("  "));
      }
    }
  }

  console.log("\n===============================================================");
  if (findings.length) {
    console.log(`${findings.length} finding(s) to look at.`);
    return 1;
  }
  console.log("No findings: every tool computes on its defaults, refuses cleanly when emptied,");
  console.log("and produces no NaN, Infinity or em-dash sentinel under rubbish input.");
  return 0;
}

let code = 1;
try {
  code = run();
} catch (e) {
  console.error("Audit failed to run: " + e.message);
  code = 1;
}
process.exit(code);
