/* eslint-disable no-undef */
// QC gate: every tool has a detail page that the renderer can actually render.
//
// WHY THIS EXISTS
// tool.html?tool=engineering was broken from the day Engineering shipped and
// stayed broken for ten releases. The entry carried `body` and `limits`, but the
// renderer reads `does` and `examples` — so `for (const d of t.does)` threw on
// the first line, and the page rendered its title and tagline and then nothing:
// no capabilities, no examples, no honest-limits text, not even the prev/next
// nav. A page of carefully written prose, including the limits paragraph the
// product's honesty rests on, could not be reached by any user.
//
// Nothing caught it. check-landing-overlap.js measures layout, and a page with
// no content cannot overlap itself, so it passed. The doc-rot gate counts tools.
// Reading the diff could not catch it either: the entry is valid JavaScript and
// valid HTML, and it is only WRONG relative to what the renderer consumes.
//
// So this asserts the renderer's contract directly, and derives the tool list
// from ALL_MODES rather than from a list typed here — the same rule the rest of
// the gates follow.
//
//   node scripts/check-tool-pages.js               (part of `npm run qc`)
//   node scripts/check-tool-pages.js --file X      check a copy, to self-test
//
// The --file form exists so this gate can be pointed at a known-bad page and
// watched to FAIL. A gate that has never failed is a gate nobody has tested.
//
// Exits 0 clean, 1 on findings.

const fs = require("fs");
const path = require("path");
const { modes } = require("./tool-count.js");

const ROOT = path.join(__dirname, "..");
const fileArg = process.argv.indexOf("--file");
const TOOL_HTML = fileArg > -1 ? process.argv[fileArg + 1] : path.join(ROOT, "landing", "tool.html");

/**
 * The two ids that legitimately differ between the pane and the landing page.
 * They are spelled out rather than fuzzy-matched, so a genuine mismatch is a
 * failure instead of something a similarity heuristic quietly forgives.
 */
const MODE_TO_PAGE = { assay: "bioassay", ppt: "tablechart" };

const src = fs.readFileSync(TOOL_HTML, "utf8");
const problems = [];

const toolsBlock = /const TOOLS = \{([\s\S]*?)\n  \};/.exec(src);
if (!toolsBlock) {
  console.error("check-tool-pages: could not find the TOOLS object in landing/tool.html.");
  console.error("If it was renamed or reformatted, update this parser — do NOT delete the gate.");
  process.exit(1);
}

// Entries start at a four-space indent: `    id: {`.
const starts = [...toolsBlock[1].matchAll(/^ {4}([a-z0-9]+): \{/gm)];
const entries = new Map();
for (let i = 0; i < starts.length; i++) {
  const from = starts[i].index;
  const to = i + 1 < starts.length ? starts[i + 1].index : toolsBlock[1].length;
  entries.set(starts[i][1], toolsBlock[1].slice(from, to));
}

if (entries.size < 2) {
  console.error("check-tool-pages: parsed " + entries.size + " entries — the parser is wrong.");
  process.exit(1);
}

// 1. Every shipping mode needs a page, and every page needs a mode.
const expected = modes.map((m) => MODE_TO_PAGE[m] || m);
for (const id of expected) {
  if (!entries.has(id)) problems.push("No tool.html entry for shipping mode: " + id);
}
for (const id of entries.keys()) {
  if (!expected.includes(id)) problems.push("tool.html entry for a mode that does not ship: " + id);
}

// 2. THE RENDERER CONTRACT. It reads t.does and t.examples and nothing else, so
//    an entry without both renders a header and then throws.
for (const [id, body] of entries) {
  if (!/\bdoes:\s*\[/.test(body)) problems.push(id + ": no does[] — the page will throw and render blank");
  if (!/\bexamples:\s*\[/.test(body)) problems.push(id + ": no examples[] — the page will throw and render blank");
  if (!/\btitle:\s*"/.test(body)) problems.push(id + ": no title");
  if (!/\btagline:\s*"/.test(body)) problems.push(id + ": no tagline");
  // A key the renderer never reads is dead prose that looks maintained. This is
  // exactly how the Engineering limits paragraph became unreachable.
  for (const dead of ["body", "limits", "unused_body"]) {
    if (new RegExp("^\\s{6}" + dead + ":", "m").test(body)) {
      problems.push(id + ": has a `" + dead + ":` key, which the renderer never reads — fold it into does[]/examples[]");
    }
  }
}

// 3. ORDER drives prev/next; an id missing from it dead-ends the navigation.
const orderMatch = /const ORDER = \[([^\]]*)\]/.exec(src);
if (!orderMatch) {
  problems.push("could not find the ORDER array");
} else {
  const order = [...orderMatch[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
  for (const id of entries.keys()) {
    if (!order.includes(id)) problems.push(id + ": missing from ORDER — prev/next will dead-end");
  }
  for (const id of order) {
    if (!entries.has(id)) problems.push("ORDER names " + id + ", which has no TOOLS entry — prev/next will hit Tool not found");
  }
}

// 4. The manual's own table of contents must account for every tool. Engineering
//    was absent from manual.html entirely — no section, no ToC entry — and the
//    page still read as complete, because its section counts (5, 6, 2, 7, 4, 1)
//    only ever get compared to each other. Summing them against the mode list is
//    what makes a missing tool visible: they came to 25 for a 26-tool product.
const MANUAL = path.join(ROOT, "landing", "manual.html");
if (!fs.existsSync(MANUAL)) {
  problems.push("landing/manual.html not found");
} else {
  const manual = fs.readFileSync(MANUAL, "utf8");
  const toc = [...manual.matchAll(/\((\d+)\)<\/a>/g)].map((m) => Number(m[1]));
  if (!toc.length) {
    problems.push("manual.html: no ToC section counts found — update this parser rather than dropping the check");
  } else {
    const total = toc.reduce((a, b) => a + b, 0);
    if (total !== modes.length) {
      problems.push(
        "manual.html ToC accounts for " + total + " tools, but " + modes.length + " ship — " +
          "a tool is missing a section (the counts are " + toc.join(" + ") + ")",
      );
    }
  }
}

if (problems.length) {
  console.error("check-tool-pages: " + problems.length + " problem(s)\n");
  problems.forEach((p) => console.error("  - " + p));
  process.exit(1);
}
console.log("check-tool-pages: " + entries.size + " tool pages, all renderable, ORDER complete.");
