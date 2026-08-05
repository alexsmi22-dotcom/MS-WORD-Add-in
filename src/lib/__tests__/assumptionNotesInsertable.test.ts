// The em-dash sentinel, one layer further out than the existing guard reaches.
//
// WHAT HAPPENED. `analyzeCalcText.test.ts` scans each calculator's `compute:`
// body for a LITERAL em dash, which is why the ANOVA effect-size line carries a
// comment saying "NO EM DASH … analyzeCalcText.test.ts guards this". Then
// `describeAssumptions` was wired in directly below that comment. It writes
// ordinary prose with em dashes of its own ("almost no power - it will fail to
// reject almost any data", diagnostics.ts:93), and that prose is CONCATENATED
// into the result text at run time.
//
// A source scan cannot see it. There is no em dash in taskpane.ts at those
// sites; it arrives from another module. So the two-sample t-test, the paired
// t-test and one-way ANOVA — three of the most-used calculators in the product
// — all silently lost their Insert button, and 9,332 tests stayed green.
//
// Found by the pane audit built for the chart campaign, on its first run, in
// the INSERT pass: `attempted[para=0,text=0,…] NOTHING_INSERTED`.
//
// THE SHAPE TO REMEMBER: a guard that lags the defect by one layer is not a
// guard. The existing test checks the text a calculator WRITES; this one checks
// the text a calculator SPLICES IN.

import * as fs from "fs";
import * as path from "path";
import { describeAssumptions } from "../diagnostics";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const EM_DASH = "—";

describe("prose spliced into a result cannot disable Insert", () => {
  // ANTI-VACUITY. If describeAssumptions ever stops emitting em dashes, the
  // call-site requirement below is still correct but this file is no longer
  // testing anything real — and a test that passes because its subject
  // disappeared is the failure mode this repo keeps meeting. So the hazard is
  // asserted to still exist, on data engineered to trigger the wordiest branch.
  test("describeAssumptions really does emit em dashes (the hazard is live)", () => {
    // Three tiny groups: too small for a normality test, which is the branch
    // whose text carries the em dashes.
    const notes = describeAssumptions([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join("\n")).toContain(EM_DASH);
  });

  test("the pane's sentinel scan still works the way this test assumes", () => {
    // If the reader stops blocking on the sentinel, this file is obsolete
    // rather than wrong. Pin the behaviour it defends.
    expect(PANE).toContain('!out.text.includes("');
    expect(PANE).toContain("function plainDashes");
  });

  // THE GATE. Every call site, not the three that were broken — the point is
  // that the NEXT one is covered too.
  test("every describeAssumptions call in the pane is made sentinel-safe", () => {
    const lines = PANE.split(/\r?\n/);
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (!/\bdescribeAssumptions\s*\(/.test(line)) return;
      // The import statement is not a call site.
      if (/^\s*import\b/.test(line)) return;
      // The whole statement can wrap onto the next line.
      const stmt = line + (lines[i + 1] ?? "");
      if (!/\.map\(plainDashes\)/.test(stmt)) {
        offenders.push(`taskpane.ts:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  // WHY .map(plainDashes) AND NOT plainDashes(wholeText).
  //
  // Running plainDashes over the assembled result would clear the false block
  // and destroy the real sentinel with it: assaySig returns the em dash for a
  // non-finite value, so a genuinely non-computable answer would be rewritten
  // to "-" and inserted into a document as though it were a number. The dash is
  // made plain only where it is punctuation.
  test("the sentinel survives: assaySig still marks a non-finite value with it", () => {
    expect(PANE).toContain('if (!Number.isFinite(x)) return "' + EM_DASH + '"');
  });

  test("no call site launders the numbers along with the prose", () => {
    // plainDashes applied to a whole assembled result at one of these sites
    // would be the bad fix. Catch it by shape.
    const bad = PANE.split(/\r?\n/).filter((l) =>
      /plainDashes\(\s*`/.test(l) && /describeAssumptions/.test(l),
    );
    expect(bad).toEqual([]);
  });
});
