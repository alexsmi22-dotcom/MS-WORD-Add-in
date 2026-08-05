/* eslint-disable no-undef */
// THE WHOLE-LIBRARY FUZZ.
//
//   npm run fuzz            hostile scalars   (Infinity, NaN, 1e308, "", null, …)
//   npm run fuzz:extreme    valid but extreme (10k/100k arrays, long strings, 1e±15)
//
// Exit 0 = nothing that fails to return; 1 = findings; 2 = the self-test failed,
// in which case the run proves nothing and is not reported at all.
//
// -----------------------------------------------------------------------------
// WHY IT EXISTS, AND WHY IT IS COMMITTED THIS TIME
// -----------------------------------------------------------------------------
// A sweep of this kind was run once, at v2.18.0, over all 97 lib modules. It
// found SEVEN functions that never returned when handed a non-finite count. In a
// browser that is a hung tab; in a Word task pane it is a FROZEN WORD — no error,
// no message, no way back, with the user's document sitting behind it. This
// product treats that as worse than any wrong answer.
//
// The fuzzer itself was never committed. What survived was
// `src/lib/__tests__/unbounded.adversarial.test.ts`, a hardcoded list of about
// eleven functions. The library then grew from 97 modules to 151 — 54 modules,
// 56% growth — and none of them was ever swept: pca, curvefit, dataimport,
// heatmap, candlestick, insights and all four spectra predictors among them.
//
// So: THE MODULE LIST AND THE FUNCTION LIST ARE READ FROM THE FILESYSTEM, never
// written down. A hardcoded guard is precisely what rotted here.
//
// -----------------------------------------------------------------------------
// WHAT A FINDING IS
// -----------------------------------------------------------------------------
//   HANG   the call did not return in tens of seconds    — THE DEFECT
//   HEAP   the call exhausted the child's heap cap       — THE DEFECT
//   SLOW   it returned, but far too late for a pane      — a defect in a pane
//   HUGE   it returned promptly and enormously           — a defect in a pane
//   threw  it refused the input                          — CORRECT, NOT REPORTED
//
// Refusing bad input is what these functions are supposed to do. A thrown error
// is never a finding; only a failure to come back in time and in size is.
//
// HANG DOES NOT MEAN "INFINITE", and saying so would be overclaiming. A busy
// child pauses itself every YIELD_MS and the parent kills it CHILD_BUDGET_MS +
// KILL_HEADROOM_MS after spawn, so HANG means "still inside one call somewhere
// between 20 and 44 seconds in". SLOW and HANG are the same axis seen from
// either side of that line — `finance.xnpv` returning at 42,356 ms landed in
// SLOW only because it beat the killer. For a task pane the distinction barely
// matters: 20 seconds of a blocked UI thread is already a frozen Word.
//
// ARITY MATTERS WHEN READING A FINDING. Every parameter position is filled with
// the SAME value, so "3 arg(s) = number[100000]" means all three parameters got
// the same 100k array — which for `xnpv(rate, flows, dates)` is not a shape any
// caller produces. ONE-ARGUMENT findings are the candidates for real user
// reachability; multi-argument ones are reported for completeness and should be
// read as shape abuse until someone shows a caller that can produce them.
//
// -----------------------------------------------------------------------------
// WHAT THIS TOOL DOES **NOT** PROVE — read this before trusting a green run
// -----------------------------------------------------------------------------
// The v2.18.0 sweep drove HOSTILE SCALARS, and neither of the two frozen-Word
// defects found in the 2026-08-05 audit would have been caught by it, because
// neither input is hostile:
//
//   * `align()` allocates six (n+1)x(m+1) arrays with no clamp. At 5 kb x 5 kb
//     that is 8.3 s and 1.81 GB. The input is not hostile, it is merely LARGE —
//     an ordinary CDS or plasmid.
//   * The `tablechart` / `candlestick` tick loops used an ABSOLUTE 1e-9 slack
//     with no count cap, so data at 1e-15 magnitude produced 2,000,011 tick
//     labels and a 510 MB SVG. The input is not hostile, it is merely SMALL —
//     and the product deliberately ships fs, fF and fJ units.
//
// That is what `--extreme` is for, and it is a second SHAPE of sweep rather than
// more of the same values. Its own bound, stated so it is not mistaken for
// coverage: arguments are scalars, strings, arrays and string[][] grids. A
// function whose parameter is a SHAPED OBJECT — `buildChartPreviewSvg(chart,
// kind)`, `beamDiagramSvg({result, supports, loads})`, `barcodeSvg(res)` — will
// simply throw on every generated argument and is therefore NOT swept in any
// meaningful sense, however green it looks. The tick-loop defect above lives
// behind exactly such a signature. Object-shaped builders are covered instead by
// the figure corpus (`npm run check:figures`), which drives them through their
// real parsers. Neither instrument subsumes the other.
//
// -----------------------------------------------------------------------------
// HOW IT SURVIVES WHAT IT IS LOOKING FOR
// -----------------------------------------------------------------------------
// A hang blocks the event loop, so the hanging process cannot report on itself
// and no in-process timeout can fire. Therefore:
//
//   * every call runs in a CHILD PROCESS with `--max-old-space-size`;
//   * before each call the child writes a BEGIN record to a journal with a
//     synchronous write, so the record survives a kill -9 and an OOM abort;
//   * a child that is merely BUSY hands its budget back voluntarily (PAUSED)
//     between calls, so reaching the parent's hard timeout means one call did
//     not return. Without that, the timeout is a budget for the whole remaining
//     case list and every long module reports a phantom hang;
//   * on a timeout the last BEGIN with no matching END is the call that never
//     came back. The parent kills the child and RESUMES from the next case, so
//     one hang does not hide the rest of the module;
//   * a function that hangs or OOMs is not tried again with its remaining
//     arguments — the first triggering argument is the one worth reporting, and
//     without that rule a single bad function costs 36 process restarts.
//
// It needs no network and no browser. It is deliberately NOT on the publish path
// in pages.yml: kill-and-resume attribution is timing-sensitive, a flaky gate
// gets disabled, and a disabled gate is how this hole opened in the first place.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "src", "lib");
const SELFTEST = path.join(__dirname, "fuzz-selftest.ts");

// --- Thresholds. The self-test below is calibrated against these, so changing
// one without re-checking the self-test is a change to what the tool can see.
const HEAP_MB = 512; // generous enough that module load itself never trips it
// Headroom on top of CHILD_BUDGET_MS before the parent kills a child. Because a
// busy child PAUSES itself every YIELD_MS, a child still alive at
// CHILD_BUDGET_MS + KILL_HEADROOM_MS is stuck inside ONE call.
const KILL_HEADROOM_MS = 4000;
const SLOW_MS = 1000; // a pane blocked this long is a visible freeze
const HUGE_CHARS = 2_000_000; // a 2 M-character string is not a figure, it is a hang with extra steps
const MAX_RESUMES = 40; // hangs tolerated per module, so the sweep terminates
const MAX_ARITY = 3; // positions filled; fn.length lies once a parameter is defaulted
const CHILD_BUDGET_MS = 40000; // process start-up + module load + a run of cases
// A child voluntarily PAUSES after this long and the parent resumes it from the
// next case. Without it the hard timeout below is a budget for the whole
// REMAINING case list rather than for one call, so a module with many slow-but-
// correct cases (assay ran 948) gets SIGTERM'd mid-call, the open BEGIN is
// misreported as a HANG, and the function is then skipped — one invented defect
// and one silent coverage hole per long module. It must stay comfortably under
// CHILD_BUDGET_MS so a pause always wins the race against the kill.
const YIELD_MS = 20000;
const MAX_PAUSES = 400; // pauses are progress, so this only bounds pathology

// =============================================================================
// ARGUMENTS
// =============================================================================

/** Hostile scalars: values a caller should never produce, and a pane sometimes does. */
function hostileArgs() {
  return [
    ["Infinity", () => Infinity],
    ["-Infinity", () => -Infinity],
    ["NaN", () => NaN],
    ["1e308", () => 1e308],
    ["Number.MAX_SAFE_INTEGER", () => Number.MAX_SAFE_INTEGER],
    ["0", () => 0],
    ["-1", () => -1],
    ['""', () => ""],
    ["null", () => null],
    ["undefined", () => undefined],
    ["[]", () => []],
    ["{}", () => ({})],
  ];
}

/**
 * Valid but extreme. Every value here is something a user can actually produce:
 * a pasted 100k-row table, a plasmid sequence, a femtosecond measurement.
 */
function extremeArgs() {
  return [
    ["1e-15", () => 1e-15],
    ["1e15", () => 1e15],
    ["1e-300", () => 1e-300],
    ["number[10000]", () => Array.from({ length: 10000 }, (_, i) => i * 0.37 - 1000)],
    ["number[100000]", () => Array.from({ length: 100000 }, (_, i) => Math.sin(i))],
    ["point[10000]", () => Array.from({ length: 10000 }, (_, i) => ({ x: i, y: Math.sin(i) }))],
    ["string[10000]", () => Array.from({ length: 10000 }, (_, i) => `row ${i}`)],
    ["string(100000)", () => "A".repeat(100000)],
    ["dna(100000)", () => "ACGT".repeat(25000)],
    // string[][] is the dominant parameter shape in this library — parseTableData,
    // cleanTableRows, buildTableFigureSvg, layoutFlowchart, buildTree and the rest
    // all take a grid of rows. A pasted Word table is exactly this, and it is
    // where the pagination and layout blow-ups live.
    ["string[][] 20000x3", () => Array.from({ length: 20000 }, (_, i) => [`r${i}`, String(i * 1.5), String(i % 7)])],
    ["string[][] long cells", () => Array.from({ length: 200 }, (_, i) => [`r${i}`, "x".repeat(5000)])],
  ];
}

// =============================================================================
// THE CHILD
// =============================================================================
// Loads one module, enumerates its exported functions from the live object, and
// walks a DETERMINISTIC case list so the parent can resume by index.

function caseList(mod, args) {
  const cases = [];
  for (const name of Object.keys(mod).sort()) {
    const fn = mod[name];
    if (typeof fn !== "function") continue;
    // A class is not callable without `new`; calling it only ever produces the
    // same TypeError and tells us nothing.
    if (/^\s*class[\s{]/.test(Function.prototype.toString.call(fn))) continue;
    const arity = Math.min(Math.max(fn.length, 1), MAX_ARITY);
    // Label outer, arity inner, so the three arity shapes of one argument are
    // consecutive and the value can be built once instead of three times. That
    // matters in --extreme, where building a 100k array is not free.
    for (const [label] of args) {
      for (let k = 1; k <= arity; k++) cases.push({ name, k, label });
    }
  }
  return cases;
}

function measureSize(v) {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") {
    let n = 0;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === "string") n += x.length;
      else if (Array.isArray(x)) n += x.length;
    }
    return n;
  }
  return 0;
}

function runChild() {
  const modulePath = process.argv[3];
  const journalPath = process.argv[4];
  const mode = process.argv[5];
  const startAt = Number(process.argv[6]) || 0;
  const skip = new Set(JSON.parse(process.env.FUZZ_SKIP || "[]"));

  const fd = fs.openSync(journalPath, "a");
  const say = (rec) => fs.writeSync(fd, JSON.stringify(rec) + "\n");

  // Module load is its own phase. A child that dies during `require` is a load
  // failure, not a function defect, and conflating the two invents a hang.
  say({ phase: "LOAD", at: startAt });
  require("./ts-require.js");
  let mod;
  try {
    mod = require(modulePath);
  } catch (e) {
    say({ phase: "LOADFAIL", message: String((e && e.message) || e).split("\n")[0] });
    fs.closeSync(fd);
    process.exit(0);
  }
  const args = mode === "extreme" ? extremeArgs() : hostileArgs();
  const makers = new Map(args);
  const cases = caseList(mod, args);
  say({ phase: "LOADED", total: cases.length });

  const childStart = Date.now();
  let memoKey = null;
  let memoValue;
  for (let i = startAt; i < cases.length; i++) {
    const c = cases[i];
    if (skip.has(c.name)) continue;
    let value;
    const key = c.name + "|" + c.label;
    if (key === memoKey) {
      value = memoValue;
    } else {
      try {
        value = makers.get(c.label)();
      } catch {
        continue; // could not even build the argument; nothing to say about the function
      }
      memoKey = key;
      memoValue = value;
    }
    const argv = new Array(c.k).fill(value);
    say({ phase: "BEGIN", i, name: c.name, k: c.k, label: c.label });
    const t0 = Date.now();
    try {
      const out = mod[c.name](...argv);
      say({ phase: "END", i, name: c.name, k: c.k, label: c.label, ms: Date.now() - t0, size: measureSize(out) });
    } catch (e) {
      say({ phase: "THREW", i, name: c.name, k: c.k, label: c.label, ms: Date.now() - t0, message: String((e && e.message) || e).split("\n")[0].slice(0, 90) });
    }
    // Hand the budget back BETWEEN calls, never during one. A pause is progress
    // and carries no finding; only a call that outlives the parent's hard
    // timeout is a hang.
    if (Date.now() - childStart > YIELD_MS && i + 1 < cases.length) {
      say({ phase: "PAUSED", next: i + 1 });
      fs.closeSync(fd);
      process.exit(0);
    }
  }
  say({ phase: "DONE", total: cases.length });
  fs.closeSync(fd);
  process.exit(0);
}

// =============================================================================
// THE PARENT
// =============================================================================

function readJournal(p) {
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn last line is what a kill during a write looks like */
    }
  }
  return out;
}

/**
 * Sweeps one module, resuming past every hang, and returns its findings.
 *
 * Returns { findings, loaded, loadError, calls }.
 */
function sweepModule(modulePath, label, mode, tmpDir) {
  const journal = path.join(tmpDir, "journal-" + label.replace(/[^\w.-]/g, "_") + ".ndjson");
  if (fs.existsSync(journal)) fs.unlinkSync(journal);

  const findings = [];
  const skip = [];
  let startAt = 0;
  let loaded = false;
  let loadError = null;
  let calls = 0;
  let resumes = 0;
  let pauses = 0;

  for (;;) {
    const res = spawnSync(
      process.execPath,
      [`--max-old-space-size=${HEAP_MB}`, __filename, "--child", modulePath, journal, mode, String(startAt)],
      {
        cwd: ROOT,
        env: { ...process.env, FUZZ_SKIP: JSON.stringify(skip) },
        // The parent cannot poll a blocked child, so the budget is a hard
        // timeout on each RUN. A child that is merely busy hands the budget back
        // itself (PAUSED), so reaching this timeout means one call did not
        // return. Progress is journalled, so a kill never loses completed cases.
        timeout: CHILD_BUDGET_MS + KILL_HEADROOM_MS,
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const stderr = String(res.stderr || "");
    const recs = readJournal(journal);
    calls = recs.filter((r) => r.phase === "END" || r.phase === "THREW").length;

    const loadFail = recs.find((r) => r.phase === "LOADFAIL");
    if (loadFail) return { findings, loaded: false, loadError: loadFail.message, calls };
    if (recs.some((r) => r.phase === "LOADED")) loaded = true;

    const last = recs[recs.length - 1];
    if (last && last.phase === "DONE") break;

    // A VOLUNTARY PAUSE IS PROGRESS, NOT A FINDING. This branch must come before
    // hang attribution, or every long module reports a phantom HANG and then
    // drops the function it blamed.
    if (last && last.phase === "PAUSED") {
      startAt = last.next;
      if (++pauses > MAX_PAUSES) {
        findings.push({
          kind: "ABORTED",
          name: "(module)",
          k: 0,
          label: "-",
          detail: `gave up after ${MAX_PAUSES} pauses; the rest of this module was not swept`,
        });
        break;
      }
      continue;
    }

    // The child stopped without finishing and without pausing. The last BEGIN
    // with no matching END or THREW is the call it did not come back from.
    let open = null;
    for (const r of recs) {
      if (r.phase === "BEGIN") open = r;
      else if (r.phase === "END" || r.phase === "THREW") open = null;
    }
    if (!open) {
      if (!loaded) {
        loadError = stderr.split("\n").find((l) => l.trim()) || `child exited ${res.status}`;
        return { findings, loaded: false, loadError, calls };
      }
      // No open call and no DONE: the child died between cases. Nothing can be
      // attributed, so stop rather than invent a culprit.
      findings.push({
        kind: "CRASH",
        name: "(module)",
        k: 0,
        label: "-",
        detail: `child exited ${res.status ?? res.signal} with no open call — ${stderr.split("\n")[0] || "no stderr"}`,
      });
      break;
    }

    const heap = /heap out of memory|Allocation failed|JavaScript heap/i.test(stderr);
    findings.push({
      kind: heap ? "HEAP" : "HANG",
      name: open.name,
      k: open.k,
      label: open.label,
      detail: heap
        ? `exhausted a ${HEAP_MB} MB heap`
        : `still inside this one call ${YIELD_MS / 1000}-${(CHILD_BUDGET_MS + KILL_HEADROOM_MS) / 1000} s after it started, and was killed`,
    });
    skip.push(open.name);
    startAt = open.i + 1;
    if (++resumes > MAX_RESUMES) {
      findings.push({
        kind: "ABORTED",
        name: "(module)",
        k: 0,
        label: "-",
        detail: `gave up after ${MAX_RESUMES} restarts; the rest of this module was not swept`,
      });
      break;
    }
  }

  // Slow and huge come from COMPLETED calls, so unlike a hang they repeat for
  // every argument. Report once per function per kind, naming the WORST case and
  // how many arguments reached it — a wall of 12 identical lines per function
  // buries the one function that matters.
  const worst = new Map();
  for (const r of readJournal(journal)) {
    if (r.phase !== "END") continue;
    for (const [kind, value, unit] of [
      ["SLOW", r.ms, "ms"],
      ["HUGE", r.size, "characters/elements"],
    ]) {
      if (kind === "SLOW" ? value < SLOW_MS : value < HUGE_CHARS) continue;
      const key = kind + "|" + r.name;
      const prev = worst.get(key);
      if (!prev) worst.set(key, { kind, name: r.name, k: r.k, label: r.label, value, unit, n: 1 });
      else {
        prev.n++;
        if (value > prev.value) {
          prev.value = value;
          prev.label = r.label;
          prev.k = r.k;
        }
      }
    }
  }
  for (const w of worst.values()) {
    findings.push({
      kind: w.kind,
      name: w.name,
      k: w.k,
      label: w.label,
      detail:
        (w.kind === "SLOW" ? `returned after ${w.value} ${w.unit}` : `returned ${w.value.toLocaleString()} ${w.unit}`) +
        (w.n > 1 ? ` (worst of ${w.n} argument(s) that tripped it)` : ""),
    });
  }
  return { findings, loaded, loadError, calls };
}

// =============================================================================
// THE SELF-TEST
// =============================================================================

function selfTest(mode, tmpDir) {
  const want = {
    neverReturns: "HANG",
    eatsTheHeap: "HEAP",
    slowButReturns: "SLOW",
    hugeString: "HUGE",
  };
  const mustBeSilent = ["alwaysThrows", "returnsFine"];

  const r = sweepModule(SELFTEST, "selftest", mode, tmpDir);
  const problems = [];
  if (!r.loaded) problems.push("the fixture module did not even load: " + r.loadError);

  const byName = new Map();
  for (const f of r.findings) if (!byName.has(f.name)) byName.set(f.name, f.kind);

  for (const [name, kind] of Object.entries(want)) {
    const got = byName.get(name);
    if (got !== kind) problems.push(`${name}: expected ${kind}, got ${got || "NOTHING — the detector is blind to it"}`);
  }
  for (const name of mustBeSilent) {
    if (byName.has(name)) {
      problems.push(`${name}: reported ${byName.get(name)}, but refusing bad input is CORRECT and must never be a finding`);
    }
  }
  return { problems, findings: r.findings };
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const mode = process.argv.includes("--extreme") ? "extreme" : "hostile";
  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "jurislab-fuzz-"));

  console.log(`Whole-library fuzz — ${mode === "extreme" ? "VALID BUT EXTREME" : "HOSTILE SCALARS"}`);
  console.log(
    `heap cap ${HEAP_MB} MB · a call is a HANG at ${YIELD_MS / 1000}-${(CHILD_BUDGET_MS + KILL_HEADROOM_MS) / 1000} s · slow ≥ ${SLOW_MS} ms · huge ≥ ${HUGE_CHARS.toLocaleString()}\n`,
  );

  // SELF-TEST FIRST, and refuse to report anything if it fails. Every detector
  // must trip on a known-bad payload AND stay silent on a function that is
  // behaving correctly — the second half matters more, because without it the
  // tool reports tens of thousands of false defects and gets switched off.
  const st = selfTest(mode, tmpDir);
  if (st.problems.length) {
    console.log("  FLAG  self-test FAILED — this run proves NOTHING and is not reported.");
    for (const p of st.problems) console.log("          " + p);
    process.exit(2);
  }
  console.log("  ok    self-test: hang, heap, slow and huge each detected on a known-bad payload,");
  console.log("        and a function that simply throws was correctly NOT reported.\n");
  for (const f of st.findings) console.log(`        ${f.kind.padEnd(8)}${f.name} (${f.label}) — ${f.detail}`);
  // `--selftest` exists to prove the harness itself, notably that PAUSE/RESUME is
  // LOSSLESS: set YIELD_MS to 1 so the child pauses after every single case, and
  // all four detections must still be present. If one goes missing, resume is
  // dropping cases and every green module in a real run is worthless.
  if (process.argv.includes("--selftest")) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  }
  console.log("");

  const files = fs
    .readdirSync(LIB)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();

  console.log(`${files.length} module(s) on disk under src/lib.\n`);

  const findings = [];
  const notSwept = [];
  let totalCalls = 0;
  let loadedCount = 0;

  files.forEach((f, idx) => {
    const label = f.replace(/\.ts$/, "");
    process.stdout.write(`  [${String(idx + 1).padStart(3)}/${files.length}] ${label.padEnd(24)}`);
    const r = sweepModule(path.join(LIB, f), label, mode, tmpDir);
    totalCalls += r.calls;
    if (!r.loaded) {
      // NOT A SKIP. A module that will not load contributed zero functions, and
      // reporting green over a subset is the rot this tool exists to prevent.
      notSwept.push({ label, why: r.loadError });
      console.log(`NOT SWEPT — ${String(r.why || r.loadError).slice(0, 60)}`);
      return;
    }
    loadedCount++;
    if (r.findings.length) {
      console.log(`${r.calls} calls · ${r.findings.length} FINDING(S)`);
      for (const x of r.findings) findings.push({ module: label, ...x });
    } else {
      console.log(`${r.calls} calls · ok`);
    }
  });

  console.log("\n===============================================================");
  console.log(`Swept ${loadedCount} of ${files.length} modules · ${totalCalls.toLocaleString()} calls.`);
  if (notSwept.length) {
    console.log(`\n${notSwept.length} MODULE(S) NOT SWEPT — these are findings, not skips:`);
    for (const n of notSwept) console.log(`  ${n.label.padEnd(24)} ${n.why}`);
  }

  const order = ["HANG", "HEAP", "ABORTED", "CRASH", "SLOW", "HUGE"];
  const hard = findings.filter((f) => f.kind === "HANG" || f.kind === "HEAP" || f.kind === "CRASH" || f.kind === "ABORTED");
  if (!findings.length) {
    console.log("\nNo function failed to return, and none returned too late or too large.");
  } else {
    for (const kind of order) {
      const of = findings.filter((f) => f.kind === kind);
      if (!of.length) continue;
      console.log(`\n--- ${kind} (${of.length}) ---`);
      for (const f of of) {
        console.log(`  ${f.module}.${f.name}  ${f.k} arg(s) = ${f.label}`);
        console.log(`      ${f.detail}`);
      }
    }
  }
  console.log(
    `\n${hard.length} function(s) failed to return. A thrown error is NOT counted: refusing bad input is correct.`,
  );

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* a leftover temp dir is not worth failing over */
  }
  process.exit(findings.length || notSwept.length ? 1 : 0);
}

if (process.argv[2] === "--child") runChild();
else main();
