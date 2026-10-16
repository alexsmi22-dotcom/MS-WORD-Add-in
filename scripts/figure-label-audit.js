// Figure LABEL-CONTENT gate (v2.143.0).
//
//   node scripts/figure-label-audit.js          (also run by scripts/qc.ps1)
//
// WHY A SECOND GATE. figure-layout-audit.js measures GEOMETRY only (COLLISION,
// STRIKETHROUGH, CLIPPED) and never reads what a label SAYS. Twelve tick labels
// that all read "2.0e+4" pass it as long as they do not overlap — that was live
// defect B.1 in docs/SCOPE-JOURNAL-FIGURES-2026-10.md. This gate reads the text
// of every label in the figure corpus (scripts/figure-layout-run.ts) and fails on:
//
//   HYPHEN    a hyphen-minus before a digit used as a minus sign ("-2.5"); the
//             display contract requires U+2212 ("−2.5")                   (B.3)
//   ENOTATION computer e-notation in a label: \de[+-]\d ("5.0e+5")        (B.2)
//   DUPLICATE the same numeric label twice in one axis row/column         (B.1)
//   DECIMALS  mixed decimal places in one axis row/column ("0, 0.5, 1")   (B.4)
//   PRESET    text below the preset's minimum at the preset's width, for
//             every corpus figure drawn under a figure style (name "preset
//             <id> <mm> mm …") — measured by figureStyle.checkSvgAgainstPreset
//
// A HARNESS REPORTS ITSELF FIRST. Before it looks at the corpus, every predicate
// is run on a known-bad SVG that it MUST flag and on a known-good SVG that it
// must NOT flag. If either fails, the gate exits 1 and reports nothing else:
// three earlier "everything is broken" runs elsewhere in this repo were the
// harness, not the product.
//
// RATCHET. The brief measured B.2 = 22, B.3 = 40, B.4 = 59 figures before the
// axis engine. Re-measured after it landed (2026-10-15, 259 figures): ENOTATION
// 0 (was 22), HYPHEN 3 (was 40), DECIMALS 0 (was 59, on linear axes), DUPLICATE
// 0 outside the four recorded allowances. The three HYPHEN figures were product
// text the adversarial review found the baseline hiding — the geometry vertex
// labels and the convergence-interval legend now print U+2212, and "-3 dB" is a
// corpus fixture string — so every baseline is now EMPTY.
//
// THE BASELINE IS A SET OF FIGURE NAMES, NOT A COUNT. A count let a NEW figure
// with a violation through whenever an old one was fixed in the same change
// (3 → 3). Any figure with a finding that is not named in its predicate's
// baseline fails; a named figure that is now clean prints "RATCHET DOWN" and
// is to be deleted here by hand. PRESET has no baseline: any violation fails.
//
// AXIS ROWS. An x-axis row is >= 3 numeric labels, centre-anchored, unrotated,
// on one baseline; a y-axis column is >= 3 numeric labels, end-anchored, at one
// x. Each is split where the gap jumps (> 3x the median), so two panels side
// by side are two rows, not one row with every tick twice. Translated groups are
// flattened first (figure-layout-audit.flattenTranslates).

const path = require("path");

require("./ts-require.js");
const { flattenTranslates, decodeEntities } = require("./figure-layout-audit.js");

// ---- Ratchet baselines: the FIGURE NAMES allowed a finding. Remove names; never add. ----
const BASELINE = {
  HYPHEN: [],
  ENOTATION: [],
  DUPLICATE: [],
  DECIMALS: [],
};

/**
 * Compare this run's findings ({pred: [[name, hits], ...]}) with the baseline
 * ({pred: [name, ...]}) figure by figure. fail: [pred, name] for each figure with
 * a finding the baseline does not name. down: [pred, name] for each baseline name
 * that no longer has one.
 */
function ratchet(byPred, baseline) {
  const fail = [];
  const down = [];
  for (const [k, list] of Object.entries(byPred)) {
    const allowed = new Set(baseline[k] || []);
    const now = new Set(list.map(([name]) => name));
    for (const name of now) if (!allowed.has(name)) fail.push([k, name]);
    for (const name of allowed) if (!now.has(name)) down.push([k, name]);
  }
  return { fail, down };
}

// Corpus FIXTURE strings: typed by scripts/figure-layout-run.ts as user input
// (an axis title, a table cell), not produced by the product (brief §B, Method).
// The product draws a user's own text as typed. Matched by EXACT rendered text,
// so the predicates themselves are never loosened.
const FIXTURE_TEXTS = new Set([
  "Temperature (deg C)", // figure-layout-run.ts:398/419, a typed ylabel
  "response (dB, floored at -30)", // figure-layout-run.ts:962, a typed ylabel
  "n-BuLi in THF at -78 °C", // figure-layout-run.ts:1395, a typed table cell (truncated by the narrow table)
  "n-BuLi in THF at -78 °C under argon", // the same cell where the table is wide enough
  "-3 dB", // figure-layout-run.ts "opamp gain", a series label the corpus types (a pane label would print U+2212)
]);

// Recorded findings that are NOT the defect the predicate is for, by EXACT figure
// name and predicate, each with its reason AND the exact label texts it covers.
// A DUPLICATE hit is allowed only when it is in the named kind of group ("x-axis
// row" / "y-axis column") and EVERY label it reports as repeated is one of
// `labels`; any other finding in these figures still counts (v2.143.0 second
// review: the allowance used to exempt every finding of the predicate in the
// figure, whatever it said). A recorded allowance that matches nothing is
// reported "FIXED — delete it".
const BITS4 = Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0"));
const LABEL_ALLOWANCES = {
  // A head-to-tail mass spectrum mirrors its y axis about 0 (100 … 0 … 100): the
  // repeated labels are the design, one per half.
  "overlay ms acetone head-to-tail": { DUPLICATE: { reason: "mirrored head-to-tail axis (100 … 0 … 100)", kind: "y-axis column", labels: ["100", "50"] } },
  "overlay ms isotope pattern C2Cl4": { DUPLICATE: { reason: "mirrored head-to-tail axis (100 … 0 … 100)", kind: "y-axis column", labels: ["100", "50"] } },
  // Data cells, not ticks: a Turing-machine tape and a GF(16) multiplication
  // table are rows of evenly spaced numerals that legitimately repeat.
  "tm diagram + tape strip": { DUPLICATE: { reason: "tape cells (0 and 1), not tick labels", kind: "x-axis row", labels: ["0", "1"] } },
  "GF(16) multiplication table": { DUPLICATE: { reason: "table cells (4-bit field elements), not tick labels", kind: "x-axis row", labels: BITS4 } },
};

/**
 * Split one predicate's hits for one figure into those the allowance covers and
 * the rest. A DUPLICATE hit reads `<kind>: "t" ×n, "u" ×m`; it is covered only
 * when its kind is the allowance's and every repeated label is in its `labels`.
 * Any other predicate's hit is covered only by an exact entry in `hits`.
 */
function splitAllowed(pred, hits, allowance) {
  const allowed = [];
  const rest = [];
  for (const h of hits) {
    let ok = false;
    if (pred === "DUPLICATE" && Array.isArray(allowance.labels)) {
      const kind = h.slice(0, h.indexOf(":"));
      const repeated = [...h.matchAll(/"([^"]*)" ×\d+/g)].map((m) => m[1]);
      ok = (!allowance.kind || kind === allowance.kind) && repeated.length > 0 && repeated.every((t) => allowance.labels.includes(t));
    } else if (Array.isArray(allowance.hits)) {
      ok = allowance.hits.includes(h);
    }
    (ok ? allowed : rest).push(h);
  }
  return { allowed, rest };
}

const NUMERIC = /^[−-]?\d[\d\u2009\u202f ]*(?:\.(\d+))?(?:e[+-]?\d+)?(?:\s*×\s*10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?%?$/;

/** Every <text> run: content, x, y, anchor, rotated — after translates are flattened. */
function texts(svg) {
  const flat = flattenTranslates(svg);
  const out = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(flat))) {
    const attrs = m[1];
    const at = (name) => {
      const a = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
      return a ? a[1] : null;
    };
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, "")).trim();
    out.push({
      text,
      x: Number(at("x")),
      y: Number(at("y")),
      anchor: at("text-anchor") || "start",
      rotated: /rotate\(/.test(attrs),
    });
  }
  return out;
}

/** Split a sorted run of positions where the gap jumps (two panels side by side). */
function splitRuns(items, key) {
  if (items.length < 2) return [items];
  const s = items.slice().sort((a, b) => a[key] - b[key]);
  const gaps = [];
  for (let i = 1; i < s.length; i++) gaps.push(s[i][key] - s[i - 1][key]);
  const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const runs = [[s[0]]];
  for (let i = 1; i < s.length; i++) {
    if (med > 0 && gaps[i - 1] > 3 * med) runs.push([]);
    runs[runs.length - 1].push(s[i]);
  }
  return runs;
}

/** Axis rows and columns of numeric labels. */
function axisGroups(ts) {
  const numeric = ts.filter((t) => !t.rotated && Number.isFinite(t.x) && Number.isFinite(t.y) && NUMERIC.test(t.text));
  const groups = [];
  const by = (list, keyFn) => {
    const map = new Map();
    for (const t of list) {
      const k = keyFn(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    return [...map.values()];
  };
  for (const row of by(numeric.filter((t) => t.anchor === "middle"), (t) => t.y.toFixed(1))) {
    for (const run of splitRuns(row, "x")) if (run.length >= 3) groups.push({ kind: "x-axis row", labels: run });
  }
  for (const col of by(numeric.filter((t) => t.anchor === "end"), (t) => t.x.toFixed(1))) {
    for (const run of splitRuns(col, "y")) if (run.length >= 3) groups.push({ kind: "y-axis column", labels: run });
  }
  return groups;
}

const decimals = (t) => {
  const m = NUMERIC.exec(t);
  return m && m[1] ? m[1].length : 0;
};

/** The label's value (U+2212 or hyphen minus, thin-space groups, ×10ⁿ, %). NaN if unreadable. */
function labelValue(t) {
  const SUP = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  const m = /^([−-]?\d[\d\u2009\u202f ]*(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s*×\s*10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?%?$/.exec(t);
  if (!m) return NaN;
  const mant = Number(m[1].replace(/[\u2009\u202f ]/g, "").replace("−", "-"));
  const exp = m[2] ? Number([...m[2]].map((c) => SUP[c]).join("")) : 0;
  return mant * Math.pow(10, exp);
}

/**
 * A LINEAR axis: the values are strictly monotonic and evenly spaced in value AND
 * in position (each to 1 % of the span). Only these are held to one decimal count:
 * a log axis (0.1, 0.2, 0.5, 1, 2) correctly labels each decade at its own
 * precision, and a heat map's cell values are data, not ticks.
 */
function isLinearAxis(labels, posKey) {
  const s = labels.slice().sort((a, b) => a[posKey] - b[posKey]);
  const v = s.map((l) => labelValue(l.text));
  if (v.some((x) => !Number.isFinite(x))) return false;
  const n = v.length;
  const span = v[n - 1] - v[0];
  const pspan = s[n - 1][posKey] - s[0][posKey];
  if (span === 0 || pspan === 0) return false;
  for (let i = 1; i < n; i++) {
    const dv = (v[i] - v[i - 1]) / span;
    const dp = (s[i][posKey] - s[i - 1][posKey]) / pspan;
    if (!(dv * Math.sign(span) > 0)) return false;
    if (Math.abs(Math.abs(dv) - 1 / (n - 1)) > 0.01 || Math.abs(dp - 1 / (n - 1)) > 0.01) return false;
  }
  return true;
}

/** Findings for one SVG: { HYPHEN: [...], ENOTATION: [...], DUPLICATE: [...], DECIMALS: [...] }. */
function auditLabels(svg) {
  const ts = texts(svg).filter((t) => !FIXTURE_TEXTS.has(t.text));
  const f = { HYPHEN: [], ENOTATION: [], DUPLICATE: [], DECIMALS: [] };
  for (const t of ts) {
    // A hyphen-minus used as a MINUS: before a digit, and not joining two words
    // or numbers ("IL-6", "5-7", "R-134a" are hyphens, not minus signs).
    if (/(^|[^\p{L}\p{N}.])-\.?\d/u.test(t.text)) f.HYPHEN.push(t.text);
    if (/\de[+-]\d/i.test(t.text)) f.ENOTATION.push(t.text);
  }
  for (const g of axisGroups(ts)) {
    const seen = new Map();
    for (const l of g.labels) seen.set(l.text, (seen.get(l.text) || 0) + 1);
    const dup = [...seen].filter(([, n]) => n > 1).map(([t, n]) => `"${t}" ×${n}`);
    if (dup.length) f.DUPLICATE.push(`${g.kind}: ${dup.join(", ")}`);
    const dec = new Set(g.labels.map((l) => decimals(l.text)));
    if (dec.size > 1 && isLinearAxis(g.labels, g.kind === "x-axis row" ? "x" : "y")) {
      f.DECIMALS.push(`${g.kind}: ${g.labels.map((l) => l.text).join(", ")}`);
    }
  }
  return f;
}

/** PRESET: figures named "preset <id> <mm> mm …" must meet that preset at that width. */
function presetProblems(name, svg) {
  const m = /^preset (\w+) ([\d.]+) mm\b/.exec(name);
  if (!m) return null;
  const { getPreset, checkSvgAgainstPreset } = require("../src/lib/figureStyle");
  const p = getPreset(m[1]);
  if (!p) return [`unknown preset "${m[1]}" in the figure name`];
  const c = checkSvgAgainstPreset(svg, p, Number(m[2]));
  return c.problems;
}

// ---------------------------------------------------------------------------
// Self-test: every predicate on a known-bad and a known-good payload.
// ---------------------------------------------------------------------------

function selfTest() {
  const fails = [];
  const xRow = (labels, y = 200) =>
    labels.map((l, i) => `<text x="${50 + i * 40}" y="${y}" text-anchor="middle">${l}</text>`).join("");
  const yCol = (labels) => labels.map((l, i) => `<text x="40" y="${20 + i * 30}" text-anchor="end">${l}</text>`).join("");
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">${body}</svg>`;
  const bad = {
    HYPHEN: svg(xRow(["−2", "-1", "0", "1"])),
    ENOTATION: svg(xRow(["0", "5.0e+5", "1.0e+6"])),
    // B.1's repro: twelve labels on a 20000–20050 axis that all read the same.
    DUPLICATE: svg(xRow(["20000", "20000", "20000", "20000"])),
    DECIMALS: svg(yCol(["0", "0.5", "1"])),
  };
  const good = svg(
    xRow(["−1.0", "−0.5", "0.0", "0.5", "1.0"]) +
      yCol(["0", "200", "400", "600"]) +
      // Two panels side by side with the same ticks: two rows, not duplicates.
      xRow(["0", "5", "10"], 260) +
      xRow(["0", "5", "10"].map((x) => x), 260).replace(/x="(\d+)"/g, (_m, v) => `x="${Number(v) + 300}"`) +
      `<text x="5" y="290">IL-6 and 5-7 pt and R-134a</text>` +
      // A log axis labels each decade at its own precision: not a DECIMALS finding.
      xRow(["0.1", "0.2", "0.5", "1"], 230) +
      `<g transform="translate(0,10)"><text x="60" y="100" text-anchor="middle">20 000</text><text x="100" y="100" text-anchor="middle">20 010</text><text x="140" y="100" text-anchor="middle">20 020</text></g>`,
  );
  for (const [pred, s] of Object.entries(bad)) {
    if (!auditLabels(s)[pred].length) fails.push(`${pred} did not fire on its known-bad payload`);
  }
  const g = auditLabels(good);
  for (const [pred, hits] of Object.entries(g)) if (hits.length) fails.push(`${pred} fired on the known-good payload: ${hits[0]}`);
  // The fixture exclusion is exact-text only: the same minus in other words still fires.
  if (auditLabels(svg(`<text x="5" y="20">response (dB, floored at -30)</text>`)).HYPHEN.length) fails.push("the fixture text was not excluded");
  if (!auditLabels(svg(`<text x="5" y="20">response (dB, floored at -31)</text>`)).HYPHEN.length) fails.push("the fixture exclusion is not exact");
  // Translates are applied: the same label in two translated rows is not one row.
  const tr = svg(
    `<g transform="translate(0,0)">${xRow(["0", "1", "2"])}</g><g transform="translate(0,40)">${xRow(["0", "1", "2"])}</g>`,
  );
  if (auditLabels(tr).DUPLICATE.length) fails.push("translate groups were not flattened before grouping rows");
  // ALLOWANCES are label-specific: a mirrored 100 … 0 … 100 column is covered,
  // a NEW, different duplicate in the same figure is not — nor is a hit that
  // repeats an allowed label together with one that is not, nor the right
  // labels in the wrong kind of group.
  const mirror = { reason: "self-test", kind: "y-axis column", labels: ["100", "50"] };
  const mirrored = auditLabels(svg(yCol(["100", "50", "0", "50", "100"]))).DUPLICATE;
  if (mirrored.length !== 1 || splitAllowed("DUPLICATE", mirrored, mirror).rest.length) fails.push("an allowance did not cover the exact finding it names");
  const plusNew = auditLabels(svg(yCol(["100", "50", "0", "50", "100"]) + xRow(["7", "7", "7"]))).DUPLICATE;
  const sNew = splitAllowed("DUPLICATE", plusNew, mirror);
  if (sNew.allowed.length !== 1 || sNew.rest.length !== 1) fails.push("an allowance exempted a NEW, different finding in the same figure");
  if (!splitAllowed("DUPLICATE", ['y-axis column: "100" ×2, "7" ×2'], mirror).rest.length) fails.push("an allowance covered a hit that repeats a label it does not name");
  if (!splitAllowed("DUPLICATE", ['x-axis row: "100" ×2'], mirror).rest.length) fails.push("an allowance covered the right label in the wrong kind of group");
  if (splitAllowed("HYPHEN", ["-3"], { reason: "self-test", hits: ["-3"] }).rest.length || !splitAllowed("HYPHEN", ["-4"], { reason: "self-test", hits: ["-3"] }).rest.length) {
    fails.push("an exact-hit allowance is not exact");
  }
  // PRESET: a 4 pt label at Nature's 89 mm must fail, a 6 pt one must pass.
  const W = (89 / 25.4) * 96;
  const pt = (n) => (n * 96) / 72;
  const mk = (n) => `<svg width="${W}" height="100" viewBox="0 0 ${W} 100"><text x="10" y="50" font-family="Arial, Helvetica, sans-serif" font-size="${pt(n)}">a</text></svg>`;
  const small = presetProblems("preset nature 89 mm self-test", mk(4));
  if (!small || !small.length) fails.push("PRESET did not fire on 4 pt text at Nature 89 mm");
  const fine = presetProblems("preset nature 89 mm self-test", mk(6));
  if (!fine || fine.length) fails.push(`PRESET fired on 6 pt text at Nature 89 mm: ${fine && fine[0]}`);
  return fails;
}

// ---------------------------------------------------------------------------

function main() {
  console.log("Figure label-content audit\n");
  const fails = selfTest();
  if (fails.length) {
    console.log("  FLAG  self-test FAILED — the results below would prove nothing");
    for (const f of fails) console.log("          " + f);
    return 1;
  }
  console.log("  ok    self-test: HYPHEN, ENOTATION, DUPLICATE, DECIMALS and PRESET each fire on a known-bad");
  console.log("        payload and stay silent on a known-good one; translates are applied; fixtures are exact;");
  console.log("        allowances cover only the labels they name (a new finding in an allowed figure still fails).\n");

  const { figures } = require(path.join(__dirname, "figure-layout-run.ts"));
  const byPred = { HYPHEN: [], ENOTATION: [], DUPLICATE: [], DECIMALS: [] };
  let bad = 0;
  let presetFigures = 0;
  let recorded = 0;
  for (const name of Object.keys(LABEL_ALLOWANCES)) {
    if (!figures.some(([n]) => n === name)) {
      bad++;
      console.log(`  FAIL  LABEL_ALLOWANCES names "${name}", which is not in the corpus`);
    }
  }
  for (const [name, svg] of figures) {
    const f = auditLabels(svg);
    const allowed = LABEL_ALLOWANCES[name] || {};
    for (const k of Object.keys(byPred)) {
      let hits = f[k];
      if (allowed[k]) {
        const s = splitAllowed(k, hits, allowed[k]);
        if (s.allowed.length) recorded++;
        else console.log(`  FIXED ${name}: the recorded ${k} finding (${allowed[k].reason}) is gone — delete it from LABEL_ALLOWANCES`);
        hits = s.rest; // anything the allowance does not name still counts
      }
      if (hits.length) byPred[k].push([name, hits]);
    }
    const pp = presetProblems(name, svg);
    if (pp !== null) {
      presetFigures++;
      if (pp.length) {
        bad++;
        console.log(`  FAIL  PRESET  ${name}: ${pp.join("; ")}`);
      }
    }
  }
  console.log(`  ${figures.length} figures read; ${presetFigures} drawn under a figure style; ${recorded} recorded finding(s) in LABEL_ALLOWANCES, each with its reason.\n`);
  const rt = ratchet(byPred, BASELINE);
  for (const [k, list] of Object.entries(byPred)) {
    const n = list.length;
    const newOnes = rt.fail.filter(([p]) => p === k).map(([, name]) => name);
    const gone = rt.down.filter(([p]) => p === k).map(([, name]) => name);
    const status = newOnes.length ? "FAIL " : gone.length ? "DOWN " : "ok   ";
    console.log(`  ${status} ${k.padEnd(9)} ${n} figure(s) (baseline ${BASELINE[k].length})`);
    if (newOnes.length) bad++;
    for (const name of newOnes) console.log(`          NEW: "${name}" is not in BASELINE.${k}`);
    for (const name of gone) console.log(`          RATCHET DOWN: delete "${name}" from BASELINE.${k} in scripts/figure-label-audit.js`);
    if (n) for (const [name, hits] of list.slice(0, 40)) console.log(`          ${name}: ${hits.slice(0, 3).join(" | ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`);
  }
  console.log(bad ? "\nLabel audit FAILED." : "\nLabel audit passed.");
  return bad ? 1 : 0;
}

module.exports = { auditLabels, presetProblems, selfTest, texts, ratchet, splitAllowed, BASELINE, LABEL_ALLOWANCES };

if (require.main === module) process.exit(main());
