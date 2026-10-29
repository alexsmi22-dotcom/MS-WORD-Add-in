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
// 139 as of 2026-08-05, when the chart campaign added four statchart stress
// figures. AND THE FLOOR WAS LEFT AT 130 WHILE THAT HAPPENED — the identical
// mistake the paragraph above records, made again by the person who had just
// read it. The gate stays green when the count RISES, so nothing complains;
// the four new figures could then have been deleted silently. Re-derive this
// number whenever figures are added, not only when they are removed.
// 156 as of 2026-08-09 (v2.106.0): the geometry suite added 14 plain-geometry
// figures (triangles incl. the SSA pair and a sliver, polygon/point-in-polygon,
// three conics, circle-through-3-points, sector/reflex/segment/arc/tangent) —
// and the floor was raised IN THE SAME COMMIT, per the two paragraphs above.
// 159 as of 2026-08-09 (v2.107.0): three draw-to-solve surface states
// (triangle, composite with a cutout, pending circle with the rubber preview).
// 162 as of 2026-08-09 (v2.108.0): three placement-faithful drawn figures
// (composite at true placement, single circle, segment pair).
// 164 same day: the two layouts the independent pass broke (asymmetric
// segment crossing, touching tiny cutouts), pinned in the corpus.
// 167 as of 2026-08-09 (v2.109.0): sketch-data surface + two fit overlays
// (linear, and a log fit whose curve breaks honestly at x ≤ 0).
// 171 as of 2026-08-09 (v2.118.0): four 3D molecular model figures (mol3d:
// benzene ball-and-stick + spacefill, ethanol stick + hidden-H refit).
// 172 as of 2026-08-09 (v2.119.0): acetone pins the parallel-rod double bond
// and the heteroatom label.
// 175 as of 2026-10-12 (v2.124.0): three discrete-math figures (a graph with a
// highlighted shortest path, the 24-vertex dot-and-radial-label layout, a DFA).
// 179 as of 2026-10-14 (v2.131.0): four probability figures (two pmf bar
// charts, a Bayes tree, a Markov state diagram).
// 189 as of 2026-10-14 (v2.134.0): six statistics figures (RM ANOVA profile,
// one-way and mixed; the Cox log-axis forest and adjusted survival panels; two
// log-axis forest stress cases: three decades with long labels, one decade).
// 200 as of 2026-10-14 (v2.136.0): six symbolic-batch figures (the radius disc
// with complex poles, the Taylor disc, a half-open interval of convergence, the
// proportion-interval bars twice — p̂ = 0 puts a zero-width Wald bar on the
// edge — and the Markov diagram with the hitting target ringed).
// 205 as of 2026-10-14 (v2.137.0): five chemistry figures (conservation bars,
// neutral and ionic; the non-unique-balancing basis table, short and long;
// the stoichiometry available-vs-needed chart from the calculator's default).
// 218 as of 2026-10-14 (v2.138.0): set to the MEASURED corpus (216 before this
// release, the floor had lagged) plus two numerics/topology figures — the
// 𝔽₂ | 𝔽₃ compare barcode (two stacked panels, censored bars) and the
// Cartesian pendulum DAE solution (index 3, five series).
// 229 as of 2026-10-14 (v2.139.0): eleven spectroscopy figures — a measured
// NMR peak table drawn as sticks (never joined into a trace), seven
// measured-vs-predicted overlays (¹H, ¹³C with a user reference peak, IR, IR
// with a very long file title, UV λmax marker, EI MS head-to-tail, and Mass
// Spec's isotope pattern head-to-tail) and three isotope stick charts (C₂Cl₄
// with its M+2 base peak, ferrocene's M−2 below M, chlorophyll a's long
// formula). overlayChart measures and truncates its title, so the long-title
// case passes with NO new CLIPPED waiver.
// 259 as of 2026-10-14 (v2.140.0): thirty audio, video and light figures, each
// a calculator's shipped default or a named stress case drawn by avFigures.ts
// (the functions the pane calls): three level ladders (voltage with a dBFS
// alignment, sound pressure, sound power), level-sum shares, A-weighted
// octave bands, coherent total against phase, the dither budget, size against
// duration with the WAV ceiling, loudness bars, the K-weighting curve, gated
// blocks, loudspeaker SPL, absorption with a target, an LR2 crossover, damping
// against cable length, timecode drift (29.97 DF and a driftless 25), two
// pulldown cadences (fields and 60p frames), letterbox and pillarbox frames,
// BT.1886 and PQ transfer curves, SDI interface bars, and six light figures
// (illuminance at 30°, cone flux, screen luminance, depth of field, the
// exposure line, the daylight locus).
// 280 as of 2026-10-15 (v2.143.0): twenty-one journal-grade figures, each built
// by the lib call the pane makes — the Plot figure under all five journal styles,
// Okabe–Ito Table→Chart series under Nature (double), Elsevier and Cell, three
// USPTO patent drawings at the 170 mm sight, five significance-bracket figures
// (t-test, Tukey exact p and stars with ns hidden, Dunn after Kruskal–Wallis,
// Tukey under Nature), four multi-panel figures (as drawn, Nature a/b, Cell
// A/B/C, USPTO FIG. 1A/1B) and the Okabe–Ito marker swatch. Panels scaled into
// their cells are measured through the audit's uniform-scale flattening.
// 397 as of v2.187.0 (Release B): thin films, Fresnel and Jones (11), materials
// testing and quality (13), control design (25), titration and CV (16) and the
// new Plot kinds (20), each calculator at its defaults plus the layouts that crowd.
// 1024 as of v2.206.0: fifty-nine Spaceflight & missions figures (each calculator at its defaults and its layout
// variants, then the spaceflightCharts.ts builders at their edges).
const CORPUS_FLOOR = 1024;

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
  // "tablechart patent" REMOVED in v2.143.0, reviewed: patent mode now draws at
  // the USPTO text size (figureStyle, 1.84(p)(3)), the truncator cuts the name
  // to "Europe, …", and the shorter label fits. The legend is still drawn (all
  // five series names are in the figure); the finding went because it was fixed.

  // "jcamp measured ir" REMOVED 2026-10-28: plot.ts now wraps a long title onto
  // two lines (figure-style fix), so the JCAMP-DX file's own title fits the frame.

  // beamChart.ts — a reaction/moment value label is drawn on the diagram at the
  // point it annotates, with no offset away from the shear or moment curve, so
  // the curve is drawn straight through the number. Worst where the curve is
  // steep at the label: mixed loading, and any magnitude that forces exponential
  // notation (a wider label meets the curve sooner).
  "beam mixed loads": [
    'STRIKETHROUGH  a line crosses "33.73 kN"',
    'STRIKETHROUGH  a line crosses "74.15 kN·m"',
  ],
  // v2.143.0: the axis engine relabelled the SAME defect "4.00e-6 kN" ->
  // "4.00×10⁻⁶ kN" (display contract). Same strikethrough, same cause; the
  // string was updated, the finding was not re-baselined away.
  "beam micro": ['STRIKETHROUGH  a line crosses "4.00×10⁻⁶ kN"'],

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

  // "seqmap circular" (long labels clipped at the canvas edge) was FIXED in bio fix
  // round 2: the canvas widens to hold every label, names past 32 characters are
  // cut with an ellipsis; entry removed.
  // "persistence barcode" (the ε axis line through its own tick label) was
  // FIXED in v2.138.0 by the barcode redraw in persistence.ts; entry removed.
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
