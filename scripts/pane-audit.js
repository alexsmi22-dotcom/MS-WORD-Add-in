/* eslint-disable no-undef */
// Pane audit — boots the real production bundle in headless Chromium and drives
// the four calculator registries that the Engineering audit does not reach:
// Statistics, Analyze, Bio/Assay and Finance.
//
//   node scripts/pane-audit.js        (expects `npm run build` to have run)
//
// Exit 0 = nothing found, 1 = findings, 2 = skipped (no browser).
//
// WHY THIS EXISTS. `engineering-audit.js` carries FIGURE_BASELINE = 130 and a
// driver that iterates `#engineering-calc` only, so the ratchet that made
// "every Engineering calculator draws" a FACT rather than a claim sees none of
// the other 84 calculators. GAP-ANALYSIS-2026-08-05 §1.1 named this the highest
// value-per-hour item in the document, and the user's own report agrees from
// the other direction: "feedback i have been getting from users is a large lack
// of charts. the landing page shows them but yet jurislab does not seem to have
// them."
//
// This is the instrument for the chart campaign (docs/CHART-CAMPAIGN-2026-08-05.md).
// It is deliberately built BEFORE any figure is wired, because 65 figures added
// behind no gate would reproduce the very defect the campaign exists to fix.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { makeProfile } = require("./headless-profile.js");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// ---------------------------------------------------------------------------
// THE FIGURE RATCHET, PER REGISTRY.
//
// A count, not a list of names — the same shape as the Engineering ratchet and
// the dead-export gate, and for the same reason: a hardcoded list stops
// covering anything added after it was written.
//
// These start at the numbers MEASURED at v2.89.0, so the gate is honest from
// the first run: it does not claim the campaign is done, it pins where it
// started and fails if a figure is ever lost.
//
// RAISE THESE as each batch lands. A ratchet that trails the thing it ratchets
// is most of the way to not being one — check-figures.js was left at 120 while
// the corpus held 135, and fifteen figures could have been deleted silently.
//
// `total` is the tool count each registry had when the baseline was taken, and
// it IS enforced below. It was documented as making "a registry that loses a
// calculator visible" and then never read — the report printed the measured
// count against the measured count, so a registry could silently lose ten
// calculators and still print a tidy "5 of 11 draw" and pass. A field that
// describes a guarantee nothing implements is worse than no field.
const BASELINES = {
  // STATISTICS IS COMPLETE: 21 of 21. Raise this only if a calculator is added,
  // and a new one must ship with a figure or this count passes it silently at
  // 22 — the same rule the Engineering baseline carries.
  stats: { label: "Statistics", figures: 21, total: 21 },
  // ANALYZE IS COMPLETE: 23 of 23. It measured 8 when this gate was written —
  // a source scan counted 9, because the heat, wave and Laplace solvers each
  // BUILT a figure that an em dash in their own output suppressed before it
  // could be drawn. Measuring, not counting, is the whole point of this file.
  analyze: { label: "Analyze", figures: 23, total: 23 },
  // BIO/ASSAY IS COMPLETE: 16 of 16. The eleven that were added are not curve
  // fits, which is why `AssayOutput` grew a raw `svg` route beside `plot`.
  assay: { label: "Bio/Assay", figures: 16, total: 16 },
  // The plumbing proof: FinCalc.compute could return only a bare string, so
  // Finance had nowhere to put a figure. One wired calculator (amortisation)
  // lands with the type change, so the path is proven before 23 more are
  // written against it.
  finance: { label: "Finance", figures: 1, total: 24 },
};

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

  // The stub must carry EVERY Word enum the pane dereferences. The Engineering
  // harness first carried only two, so `Word.RangeLocation.after` threw on the
  // first line of every insert handler and the audit reported all 36 tools as
  // inserting nothing — a harness gap that reads as a product-wide catastrophe.
  // So the enum list is DERIVED from the source rather than remembered.
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

  const cssRef = /<link[^>]*href="([^"]+\.css)"[^>]*>/.exec(html);
  if (cssRef) {
    const cssPath = path.join(DIST, cssRef[1]);
    if (fs.existsSync(cssPath)) {
      html = html.replace(cssRef[0], "<style>" + fs.readFileSync(cssPath, "utf8") + "</style>");
    }
  }
  html = html.replace("</head>", stub + "</head>");
  html = html.replace("</body>", `<script src="${bundle[1]}"></script><script src="panedriver.js"></script></body>`);

  fs.writeFileSync(path.join(DIST, "pane-harness.html"), html);
  fs.copyFileSync(path.join(__dirname, "pane-audit-driver.js"), path.join(DIST, "panedriver.js"));
}

function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this audit).");
    return 2;
  }
  writeHarness();

  const profile = makeProfile("pane-audit");
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
        "file:///" + path.join(DIST, "pane-harness.html").replace(/\\/g, "/"),
      ],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 180000, killSignal: "SIGKILL" }
    );
  } finally {
    profile.cleanup();
  }

  const m = /data-results="([^"]*)"/.exec(dom);
  if (!m) {
    const outFile = path.join(os.tmpdir(), "jurislab-pane-audit-dom.html");
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

  const findings = [];

  console.log("Pane audit — Statistics, Analyze, Bio/Assay and Finance in the real bundle");
  console.log("(Engineering has its own driver; it is not re-run here.)\n");

  // If the checks themselves are broken, every "ok" below is worthless, so this
  // is reported first and loudest rather than buried at the end.
  const self = lines.find((l) => l.startsWith("SELFTEST ")) || "SELFTEST MISSING";
  if (!/^SELFTEST ok$/.test(self)) {
    findings.push(self);
    console.log(`  FLAG  self-test: ${self.slice(9)} — the checks below prove nothing.\n`);
  } else {
    console.log("  ok    self-test: every check tripped on a known-bad payload.\n");
  }

  // A registry that failed to open is the one failure that must never read as a
  // pass: no tools driven means no findings, which looks identical to clean.
  const seen = new Set();
  for (const l of lines.filter((x) => x.startsWith("REGISTRY "))) {
    const mode = l.split(" ")[1];
    if (/BROKEN/.test(l)) {
      findings.push(l);
      console.log(`  FLAG  ${l.slice(9)}`);
      continue;
    }
    seen.add(mode);
  }
  for (const mode of Object.keys(BASELINES)) {
    if (!seen.has(mode)) {
      findings.push(`REGISTRY ${mode} NEVER RAN — the audit covered nothing for it`);
      console.log(`  FLAG  ${mode}: never ran, so its section below is vacuous`);
    }
  }

  const section = (title, prefix, isOk, detail) => {
    console.log(`\n--- ${title} ${"-".repeat(Math.max(0, 58 - title.length))}`);
    for (const l of lines.filter((x) => x.startsWith(prefix))) {
      const ok = isOk(l);
      if (!ok) findings.push(l);
      console.log(`  ${ok ? "ok  " : "FLAG"}  ${detail(l)}`);
    }
  };

  // `note:` flags are diagnostics, not findings — see the em-dash reasoning in
  // the driver. A line carrying only notes is clean.
  // A MISSING VERDICT IS NOT A PASS.
  //
  // The first version defaulted the token to "" when the regex did not match,
  // and `"".split("+").filter(Boolean)` is the empty array, on which `.every`
  // is vacuously true. Driver EXCEPTION lines carry neither `flags=` nor
  // `issues=` — so a calculator that THREW while being selected was reported
  // "ok" by four of the six sections. A gate whose default is "pass" is the
  // "empty page cannot overlap itself" failure wearing different clothes.
  const benign = (list) => {
    if (list === null) return false; // no verdict at all: report it, never pass it
    const parts = list.split("+").filter(Boolean);
    if (!parts.length) return false;
    return parts.every((f) => f === "clean" || f === "ok" || f.indexOf("note:") === 0);
  };
  const token = (l, key) => {
    const m = new RegExp(key + "=(\\S+)").exec(l);
    return m ? m[1] : null;
  };
  const onlyNotes = (l) => benign(token(l, "flags"));
  const noIssues = (l) => benign(token(l, "issues"));

  // THE RUNNER'S OWN NEGATIVE CONTROL.
  //
  // The driver self-tests every predicate it owns on a known-bad payload; this
  // verdict logic had none, and that is exactly where the worst bug in the
  // first version lived — an EXCEPTION line carries neither `flags=` nor
  // `issues=`, the token defaulted to "", and `[].every()` is true, so a
  // calculator that threw during selection was reported clean by four of the
  // six sections. It took a hand-simulation by a reviewer to find. It does not
  // need to again.
  {
    const broken = [];
    const exceptionLine = "DEFAULT stats foo EXCEPTION Cannot read properties of null";
    if (onlyNotes(exceptionLine)) broken.push("a verdict-less EXCEPTION line reads as ok");
    if (noIssues(exceptionLine)) broken.push("a verdict-less line passes the issues check");
    if (!onlyNotes("DEFAULT stats foo len=10 fig=1 flags=clean :: x")) broken.push("a clean line reads as a finding");
    if (!onlyNotes("DEFAULT stats foo len=10 fig=0 flags=note:emdash :: x")) broken.push("a note-only line reads as a finding");
    if (onlyNotes("DEFAULT stats foo len=10 fig=0 flags=BADNUMBER :: x")) broken.push("a real flag reads as ok");
    if (!noIssues("BLANK stats foo insert=OFF issues=ok :: x")) broken.push("an ok line reads as a finding");
    if (noIssues("BLANK stats foo insert=on issues=EMDASH_BLOCKS_INSERT :: x")) broken.push("a real issue reads as ok");
    if (broken.length) {
      console.log(`  FLAG  runner self-test: ${broken.join("; ")} — every verdict below is worthless.\n`);
      findings.push(`RUNNER SELFTEST BROKEN=${broken.join(",")}`);
    } else {
      console.log("  ok    runner self-test: a verdict-less line is a finding, not a pass.");
    }
  }

  section(
    "On their own defaults",
    "DEFAULT ",
    (l) => onlyNotes(l),
    (l) => {
      const p = l.split(" ");
      const fig = (/fig=(\d+)/.exec(l) || [, "?"])[1];
      const flags = (/flags=(\S+)/.exec(l) || [, "?"])[1];
      const len = (/len=(\d+)/.exec(l) || [, "?"])[1];
      return `${p[1].padEnd(8)} ${p[2].padEnd(18)} len=${String(len).padStart(5)} fig=${fig} ${flags}` +
        (onlyNotes(l) ? "" : `\n        ${l.split(":: ")[1] || ""}`);
    }
  );

  section(
    "Every non-default dropdown option",
    "OPTION ",
    (l) => noIssues(l),
    (l) => l.slice(7)
  );

  section(
    "Every field blank (it must refuse, not compute)",
    "BLANK ",
    (l) => noIssues(l),
    (l) => l.slice(6)
  );

  section(
    "Rubbish in every field (it must refuse without emitting NaN)",
    "JUNK ",
    (l) => noIssues(l),
    (l) => l.slice(5)
  );

  const inserts = lines.filter((l) => l.startsWith("INSERT "));
  console.log("\n--- Inserting each result (against a recording Word mock) -----");
  for (const l of inserts) {
    const ok = /\bok$/.test(l);
    if (!ok) findings.push(l);
    console.log(`  ${ok ? "ok  " : "FLAG"}  ${l.slice(7)}`);
  }
  console.log("  NOTE: a mock always says yes. This proves the pane ATTEMPTS the right");
  console.log("        objects in the right order; it cannot prove Word honours them.");

  // ---------------------------------------------------------------------------
  // THE RATCHET.
  console.log("\n--- Figures, per registry (ratchet) ---------------------------");
  let raise = [];
  for (const mode of Object.keys(BASELINES)) {
    const base = BASELINES[mode];
    const mine = inserts.filter((l) => l.startsWith("INSERT " + mode + " "));
    const drawn = mine.filter((l) => /preview\[fig=[1-9]/.test(l));
    const flag = drawn.length < base.figures;
    if (flag) {
      findings.push(
        `FIGURES ${mode}: ${drawn.length} draw, below the baseline of ${base.figures} — a figure was LOST`
      );
    }
    if (drawn.length > base.figures) raise.push(`${mode} -> ${drawn.length}`);
    // A LOST CALCULATOR IS A FINDING, not a smaller denominator. Gaining one is
    // ordinary and only prompts the baseline to be updated.
    if (mine.length < base.total) {
      findings.push(
        `TOOLS ${mode}: ${mine.length} calculators driven, was ${base.total} — one has been LOST`,
      );
      console.log(`  FLAG  ${base.label.padEnd(12)} ${mine.length} calculators, down from ${base.total}`);
    } else if (mine.length > base.total) {
      raise.push(`${mode}.total -> ${mine.length}`);
    }
    console.log(
      `  ${flag ? "FLAG" : "ok  "}  ${base.label.padEnd(12)} ${String(drawn.length).padStart(3)} of ${String(mine.length).padStart(3)} draw` +
        `   (baseline ${base.figures}${drawn.length > base.figures ? ", RAISE IT" : ""})`
    );
    const none = mine.filter((l) => /preview\[fig=0/.test(l)).map((l) => l.split(" ")[2]);
    if (none.length) {
      for (let i = 0; i < none.length; i += 6) {
        console.log("          text-only: " + none.slice(i, i + 6).join("  "));
      }
    }
  }
  const totalDrawn = inserts.filter((l) => /preview\[fig=[1-9]/.test(l)).length;
  const totalBase = Object.values(BASELINES).reduce((s, b) => s + b.figures, 0);
  console.log(`\n  Campaign total: ${totalDrawn} of ${inserts.length} draw (was ${totalBase} at v2.89.0).`);
  if (raise.length) {
    console.log(`  RAISE the baselines in scripts/pane-audit.js: ${raise.join(", ")}`);
  }

  console.log("\n===============================================================");
  if (findings.length) {
    console.log(`${findings.length} finding(s) to look at.`);
    return 1;
  }
  console.log("No findings: every calculator computes on its defaults, refuses cleanly when");
  console.log("emptied, emits no NaN under rubbish input, and inserts every figure it shows.");
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
