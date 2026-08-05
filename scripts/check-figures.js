/* eslint-disable no-undef */
// The figure-layout gate. `npm run check:figures`.
//
//   node scripts/check-figures.js
//
// Exit 0 = clean, 1 = findings.
//
// WHAT THIS FILE ADDS OVER figure-layout-audit.js
// The analyser measures collisions, strikethroughs and clipping in an SVG. It
// cannot tell you that a figure is MISSING, and it reports "ok" for an empty one
// — an empty page cannot overlap itself, which is this repo's recorded worst
// gate failure. So before the analyser runs, three things are checked here:
//
//   1. COVERAGE, derived from the filesystem. Every module under src/lib that
//      exports an SVG-building function must be imported by the corpus. Add a
//      new chart module and this gate goes red until a figure from it lands in
//      figure-layout-run.ts. A hardcoded list is what rotted the last time —
//      the corpus imported four modules while the product shipped thirteen.
//   2. NON-DEGENERACY. Every corpus entry must be a real SVG carrying at least
//      one <text> box, because a builder handed a wrong-shaped input returns a
//      blank frame and the analyser passes it silently. The corpus is
//      transpile-only (tsconfig covers src/**, not scripts/**), so a wrong shape
//      is a runtime fact rather than a compile error, and this is what catches it.
//   3. A FLOOR on the corpus size, so a figure quietly deleted from the list
//      fails rather than shrinking the gate.
//
// It needs NO BROWSER AND NO NETWORK, which is why it belongs on the publish
// path in .github/workflows/pages.yml as well as in `npm run qc`.

const fs = require("fs");
const path = require("path");

require("./ts-require.js");
const { runAudit, auditSvg } = require("./figure-layout-audit.js");

const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "src", "lib");
const CORPUS = path.join(__dirname, "figure-layout-run.ts");

// A ratchet, matching how the Engineering figure ratchet and the dead-export
// gate work: a COUNT, not a list of names, so it keeps covering things added
// after it was written. Raise it as figures are added; never lower it without a
// reason written next to the change.
// 130 as of 2026-08-05, when the corpus went 4 -> 13 modules and 71 -> 135
// figures. It was left at 120 on the way past, which let fifteen of the newly
// covered figures be removed without the gate noticing — a ratchet that trails
// the thing it ratchets is most of the way to not being one.
const CORPUS_FLOOR = 130;

// --- The allowance ratchet ----------------------------------------------------
//
// WHAT THIS IS. Extending the corpus past Engineering on 2026-08-05 found 22 real
// layout defects in code this gate had never looked at. They are in modules owned
// by other work in flight, so they are RECORDED here rather than silently
// tolerated or hidden by loosening the detector.
//
// A figure listed here must produce EXACTLY the findings listed, by text. Any
// additional or different finding fails the gate; so does any finding in a figure
// that is not listed. A finding that DISAPPEARS is reported as fixed, with an
// instruction to delete the line — it does not fail, because a concurrent fix
// should not turn the publish path red.
//
// Finding strings are compared with the "(N px²)" area stripped, so an unrelated
// nudge of a few pixels does not go red while the defect itself is unchanged.
//
// NEVER widen ADVANCE or the collision threshold in figure-layout-audit.js to
// make a figure pass. That de-fangs the detector for all 135 figures at once, and
// the whole point of this list is that debt stays visible and countable.
const ALLOWANCES = {
  // tablechart.ts — the legend truncator cuts a series name to a fixed CHARACTER
  // count and never measures the result against the space left beside the frame,
  // so the ellipsis lands past the canvas edge and the tail is cut off in Word.
  // Untruncated names that fit are fine; it is the truncated one that overflows.
  "tablechart column": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart bar": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart line": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart area": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart scatter": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart stacked-column": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart stacked-bar": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart stacked-area": ['CLIPPED  "Europe, Middle…" runs outside the 380x260 canvas'],
  "tablechart patent": ['CLIPPED  "Europe, Middle…" runs outside the 380x286 canvas'],

  // spectraChart.ts — a JCAMP-DX file's own title is placed unmeasured and
  // untruncated, so a real instrument title (which routinely carries sample,
  // technique and resolution) runs 36 px past a 380 px frame.
  "jcamp measured ir": ['CLIPPED  "Acetylsalicylic acid, KBr " runs outside the 380x240 canvas'],

  // beamChart.ts — a reaction/moment value label is drawn on the diagram at the
  // point it annotates, with no offset away from the shear or moment curve, so
  // the curve is drawn straight through the number. Worst where the curve is
  // steep at the label: mixed loading, and any magnitude that forces exponential
  // notation (a wider label meets the curve sooner).
  "beam mixed loads": [
    'STRIKETHROUGH  a line crosses "33.73 kN"',
    'STRIKETHROUGH  a line crosses "74.15 kN·m"',
  ],
  "beam micro": ['STRIKETHROUGH  a line crosses "4.00e-6 kN"'],

  // periodicChart.ts — the Bohr shell labels are end-anchored at x=14, which puts
  // a three-character label 1.7 px off the left edge for EVERY element, and the
  // shells of a heavy atom are spaced closer than the labels are tall, so from
  // uranium the occupancy labels overlap each other.
  "bohr H": ['CLIPPED  "K:1" runs outside the 320x320 canvas'],
  "bohr Fe": ['CLIPPED  "N:2" runs outside the 320x320 canvas'],
  "bohr U": [
    'COLLISION  "M:18" over "N:32"',
    'COLLISION  "N:32" over "O:22"',
    'COLLISION  "O:22" over "P:8"',
    'CLIPPED  "Q:2" runs outside the 320x320 canvas',
  ],

  // seqmapcirc.ts — a feature label on the circular map is placed radially with
  // no clamp to the canvas, so a long /label (which GenBank files routinely
  // carry) runs 90-105 px outside a 460 px square and is simply cut off.
  "seqmap circular": [
    'CLIPPED  "a rather long coding seque" runs outside the 460x460 canvas',
    'CLIPPED  "reverse element with a lon" runs outside the 460x460 canvas',
  ],

  // persistence.ts — the ε axis line is drawn through its own tick label.
  "persistence barcode": ['STRIKETHROUGH  a line crosses "2.05"'],
};

/** Findings compare without their pixel-area parenthetical. */
const normalise = (f) => f.replace(/\s*\(\d+(?:\.\d+)? px²\)/, "").trim();

let bad = 0;
const fail = (msg) => {
  bad++;
  console.log("  FLAG  " + msg);
};

// --- 1. Coverage --------------------------------------------------------------
console.log("Figure corpus coverage (derived from src/lib, not from a list)\n");

const svgModules = [];
for (const f of fs.readdirSync(LIB)) {
  if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
  const src = fs.readFileSync(path.join(LIB, f), "utf8");
  // A module that BUILDS a figure: an exported function whose name ends in Svg.
  if (/^export function [A-Za-z0-9_]*Svg\s*[(<]/m.test(src)) svgModules.push(f.replace(/\.ts$/, ""));
}
const corpusSrc = fs.readFileSync(CORPUS, "utf8");
const imported = new Set();
for (const m of corpusSrc.matchAll(/from "\.\.\/src\/lib\/([A-Za-z0-9_]+)"/g)) imported.add(m[1]);

for (const m of svgModules.sort()) {
  if (imported.has(m)) {
    console.log("  ok    " + m);
  } else {
    fail(`${m}.ts exports an SVG builder and is NOT in the corpus (scripts/figure-layout-run.ts)`);
  }
}
console.log(`\n  ${svgModules.length} SVG-producing module(s) on disk, ${svgModules.filter((m) => imported.has(m)).length} in the corpus.\n`);

// --- 2 & 3. Load the corpus, then guard against degenerate entries -------------
const { figures } = require(CORPUS);

console.log("Corpus shape\n");
if (!Array.isArray(figures)) {
  fail("the corpus did not export an array of figures");
  process.exit(1);
}
if (figures.length < CORPUS_FLOOR) {
  fail(`the corpus is ${figures.length} figures, below the floor of ${CORPUS_FLOOR} — a figure was removed`);
} else {
  console.log(`  ok    ${figures.length} figures (floor ${CORPUS_FLOOR}).`);
  if (figures.length > CORPUS_FLOOR + 15) {
    console.log(`  RAISE the floor toward ${figures.length} in scripts/check-figures.js.`);
  }
}

const seen = new Set();
for (const entry of figures) {
  const [name, svg] = Array.isArray(entry) ? entry : ["(malformed entry)", null];
  if (typeof name !== "string" || !name) {
    fail("a corpus entry has no name");
    continue;
  }
  if (seen.has(name)) fail(`two corpus entries are both named "${name}" — one of them is not being audited as itself`);
  seen.add(name);
  if (typeof svg !== "string" || !svg.includes("<svg") || !svg.trim().endsWith("</svg>")) {
    fail(`"${name}" is not an SVG — the builder returned ${svg === null ? "null" : typeof svg}, so this figure proves nothing`);
    continue;
  }
  const { textCount } = auditSvg(name, svg);
  if (textCount === 0) {
    fail(`"${name}" is a BLANK figure: no text at all. An empty figure cannot collide with itself, so the layout audit would pass it silently.`);
  }
}
if (!bad) console.log("  ok    every figure is a real SVG carrying at least one label.\n");
else console.log("");

// --- 4. The layout audit itself ------------------------------------------------
// runAudit self-tests each of its detectors on a known-bad payload first and
// refuses to report anything if a detector fails to trip.
const auditable = figures.filter(([name]) => !(name in ALLOWANCES));
bad += runAudit(auditable);

console.log("\n--- Recorded defects (allowance ratchet) ----------------------");
let accepted = 0;
for (const [name, expected] of Object.entries(ALLOWANCES)) {
  const entry = figures.find(([n]) => n === name);
  if (!entry) {
    fail(`the allowance for "${name}" names a figure that is not in the corpus — delete it or restore the figure`);
    continue;
  }
  const remaining = expected.map(normalise);
  const extra = [];
  for (const f of auditSvg(name, entry[1]).found.map(normalise)) {
    const i = remaining.indexOf(f);
    if (i >= 0) remaining.splice(i, 1);
    else extra.push(f);
  }
  accepted += expected.length - remaining.length;
  if (extra.length) {
    fail(`${name}: ${extra.length} finding(s) beyond the recorded set`);
    for (const f of extra) console.log("          NEW  " + f);
  }
  if (remaining.length) {
    // Not a failure: a concurrent fix must not turn the publish path red.
    console.log(`  FIXED ${name.padEnd(22)} ${remaining.length} recorded finding(s) are gone — delete them from ALLOWANCES in scripts/check-figures.js`);
    for (const f of remaining) console.log("          " + f);
  }
  if (!extra.length && !remaining.length) {
    console.log(`  ok    ${name.padEnd(22)} ${expected.length} recorded finding(s), unchanged`);
  }
}
console.log(`\n  ${accepted} recorded layout defect(s) still present across ${Object.keys(ALLOWANCES).length} figure(s).`);
console.log("  These are REAL and are listed with their cause in scripts/check-figures.js.");

console.log("");
process.exit(bad ? 1 : 0);
