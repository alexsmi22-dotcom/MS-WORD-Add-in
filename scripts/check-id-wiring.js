/* eslint-disable no-undef */
// Task-pane id wiring audit. `npm run check:idwiring`.
//
//   node scripts/check-id-wiring.js
//
// Exit 0 = every id the pane looks up exists; 1 = findings.
//
// Every `document.getElementById("x")` in taskpane.ts must have a matching
// `id="x"` in taskpane.html, or an element the pane creates and names itself at
// runtime (`bar.id = "update-banner"` — the lookup there is only a guard against
// creating the banner twice). A miss is not a type error and not a test failure:
// it is a `null` at runtime, and the handler that would have been attached to
// that element simply never is. That is how a control ends up doing nothing at
// all while every one of the 8,957 tests stays green.
//
// WHY IT IS A NODE SCRIPT AND NOT INLINE POWERSHELL
// It was inline PowerShell in scripts/qc.ps1, so it ran only on a Windows
// machine, only when someone ran `npm run qc`, and NOT on the publish path — the
// GitHub Pages gate runs on ubuntu. It needs no browser and no network, exactly
// like check-tool-pages.js and check-figures.js, so it belongs in the gate.
// qc.ps1 now calls this same file, so there is one implementation rather than
// two that drift.
//
// This script READS taskpane.ts and taskpane.html. It never writes to them.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TS = process.argv[2] || path.join(ROOT, "src", "taskpane", "taskpane.ts");
const HTML = process.argv[3] || path.join(ROOT, "src", "taskpane", "taskpane.html");

const uniq = (a) => [...new Set(a)].sort();
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

function audit(tsSource, htmlSource) {
  const looked = uniq(all(/getElementById\("([^"]+)"\)/g, tsSource));
  const authored = uniq(all(/\bid="([^"]+)"/g, htmlSource));
  // Elements the pane creates and names at runtime are wired correctly and must
  // not be reported: the id exists by the time anything looks it up.
  const runtime = uniq(all(/\.id\s*=\s*"([^"]+)"/g, tsSource));
  const known = new Set([...authored, ...runtime]);
  return { looked, authored, runtime, missing: looked.filter((id) => !known.has(id)) };
}

// SELF-TEST FIRST. This repo's recorded worst gate failure is one that showed
// green while verifying nothing, so the predicate is exercised on a known-bad
// payload — and on a known-GOOD one, because a check that flags everything is
// just as useless as one that flags nothing.
function selfTest() {
  const problems = [];
  const bad = audit(
    'const a = document.getElementById("real-one"); const b = document.getElementById("no-such-id");',
    '<div id="real-one"></div>',
  );
  if (!bad.missing.includes("no-such-id")) problems.push("a lookup with no matching id was NOT detected");
  if (bad.missing.includes("real-one")) problems.push("an authored id was wrongly reported missing");

  const dynamic = audit(
    'const bar = document.createElement("div"); bar.id = "update-banner"; document.getElementById("update-banner");',
    "<div></div>",
  );
  if (dynamic.missing.length) problems.push("a runtime-created id was wrongly reported missing: " + dynamic.missing.join(", "));
  return problems;
}

const problems = selfTest();
if (problems.length) {
  console.log("Task-pane id wiring audit\n");
  console.log("  FLAG  self-test FAILED — the result below would prove nothing.");
  for (const p of problems) console.log("          " + p);
  process.exit(1);
}

console.log("Task-pane id wiring audit\n");
console.log("  ok    self-test: a missing id is detected, an authored id and a runtime-created id are not.\n");

const r = audit(fs.readFileSync(TS, "utf8"), fs.readFileSync(HTML, "utf8"));
console.log(`  ${r.looked.length} id(s) looked up · ${r.authored.length} authored in the markup · ${r.runtime.length} created at runtime`);

if (!r.missing.length) {
  console.log(`\n  ok    every id the pane looks up exists.\n`);
  process.exit(0);
}
console.log(`\n  FLAG  ${r.missing.length} id(s) are looked up and never exist — the handler is silently never wired:`);
for (const id of r.missing) console.log(`          getElementById("${id}")`);
console.log("");
process.exit(1);
