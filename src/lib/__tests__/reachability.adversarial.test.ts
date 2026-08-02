// Can a user actually reach the code we ship?
//
// This repo's worst recorded failure: three Solve features were fully
// implemented and fully unit-tested while the pane could not reach any of them.
// A green engine suite says the mathematics is right. It says nothing about
// whether anyone can run it, and "tested" is exactly the word that stops anyone
// checking.
//
// Nothing checked that at scale until now. The audit that produced this file
// found ZERO broken wiring — no pane feature is unable to reach its engine — and
// 26 exports that are dead everywhere in src/, twenty of them with tests. Those
// are unsurfaced capabilities rather than broken wiring, so they are not failures
// here; the guard is a RATCHET that stops the number growing.
//
// A ratchet on a COUNT, not a list of names, on purpose. This repo has twice been
// bitten by a guard that was a hardcoded list and then never grew:
// `unbounded.adversarial.test.ts` covered none of the exports added after it was
// written, and the first documentation guard hardcoded the discipline names in
// the very check whose comment boasted about avoiding hardcoded lists.
//
// If you delete dead code or surface it, LOWER the number. If this fails because
// you added an export, either wire it up or ask whether it should exist.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const LIB = path.join(ROOT, "src", "lib");
const read = (p: string): string => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/** Every module in src/lib, plus the pane. */
function sources(): { lib: Map<string, string>; all: string } {
  const lib = new Map<string, string>();
  for (const f of fs.readdirSync(LIB)) {
    if (f.endsWith(".ts")) lib.set(f.replace(/\.ts$/, ""), read(path.join(LIB, f)));
  }
  const pane = read(path.join(ROOT, "src", "taskpane", "taskpane.ts"));
  return { lib, all: pane + "\n" + [...lib.values()].join("\n") };
}

/**
 * Exported functions that appear nowhere in src/ but their own definition.
 *
 * Counts NAMES rather than import statements, so a module pulled in by a dynamic
 * `await import()` is covered. An earlier version of this audit built a static
 * import graph and wrongly reported `ppt.ts` as unreachable — it is reached that
 * way from the pane. The lesson is in the method: count uses, not edges.
 */
function deadExports(): string[] {
  const { lib, all } = sources();
  const dead: string[] = [];
  for (const [mod, text] of lib) {
    const names = [
      ...[...text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]),
      ...[...text.matchAll(/^export\s+const\s+([A-Za-z0-9_]+)\s*[:=]\s*(?:\(|async|function)/gm)].map((m) => m[1]),
    ];
    for (const name of names) {
      const uses = all.match(new RegExp(`\\b${name}\\b`, "g"));
      if (!uses || uses.length <= 1) dead.push(`${mod}.${name}`);
    }
  }
  return dead.sort();
}

describe("everything shipped is reachable", () => {
  test("the audit finds the exports at all — it cannot pass vacuously", () => {
    const { lib } = sources();
    expect(lib.size).toBeGreaterThan(100);
    let exported = 0;
    for (const text of lib.values()) {
      exported += [...text.matchAll(/^export\s+(?:async\s+)?function\s+/gm)].length;
    }
    expect(exported).toBeGreaterThan(400);
  });

  test("dead exports do not increase", () => {
    // 26 at HEAD ec1d802. Lower this when you surface or delete one; never raise
    // it without a reason written next to the change.
    //
    // 17 as of v2.71.0: seqid.formatSeqIdRefs (SEQ ID ranges) is now called by the
    // pane. 18 as of v2.69.0; the tier-1 wiring releases
    // surfaced nine before that:
    // the eight finance functions (annuities, perpetuities, CAGR, rate
    // conversions, straight-line depreciation) now have calculators,
    // assay.substrateInhibitionV has a fitter, align.countFastaRecords warns,
    // quantum.BELL_STATES is a preset, and vibration.rayleighDamping is called
    // by the code that used to duplicate its formula inline. Ratchets are only
    // worth having if they are tightened when the debt is actually paid.
    //
    // 27 as of v2.63.0: flame.cpMolar is exported FOR the committed data
    // cross-check (flame.crosscheck.test.ts validates the fetched NASA-7
    // coefficients against CODATA/JANAF cp landmarks and a cp-integration
    // identity). The engine itself only needs h(T); cp is exported so the
    // data's provenance stays verifiable, which is the condition under which
    // bundled thermodynamic data was accepted at all.
    const BASELINE = 17;
    const dead = deadExports();
    expect({ count: dead.length, over: dead.length > BASELINE ? dead : [] }).toEqual({
      count: dead.length <= BASELINE ? dead.length : BASELINE,
      over: [],
    });
  });

  test("no module is orphaned entirely", () => {
    // A whole module nothing names is a stronger signal than a single function.
    const { lib, all } = sources();
    const orphaned: string[] = [];
    for (const mod of lib.keys()) {
      // Its own file mentions its name only in comments, if at all; look for the
      // module being imported or dynamically imported anywhere else.
      const referenced = new RegExp(`["'\\./]${mod}["']`).test(all);
      if (!referenced) orphaned.push(mod);
    }
    expect(orphaned).toEqual([]);
  });
});
