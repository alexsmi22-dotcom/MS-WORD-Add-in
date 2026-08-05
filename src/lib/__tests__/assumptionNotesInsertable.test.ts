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
    expect(PANE).toContain("function insertableResultText");
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

  // THERE IS NO "DOES A CALL SITE LAUNDER THE NUMBERS" TEST HERE, and the two
  // attempts at one are worth recording rather than a third.
  //
  // The first was vacuous — it required `plainDashes(` and
  // `describeAssumptions` on the SAME source line, which at every real call
  // site they never are, so it could only pass. An adversarial pass caught it.
  //
  // The second was wrong in the other direction: "the argument to plainDashes
  // is never a template literal" flags five legitimate sites that wrap ONE
  // prose note, `plainDashes(\`Note: ${n}\`)`, which is exactly the correct
  // usage. A gate that fires on correct code gets switched off.
  //
  // The property actually worth protecting is not "where is plainDashes
  // called", it is "can a non-finite value reach a document" — and that is
  // enforced directly, and much more strongly, by the gate tested below. A
  // structural proxy for a property you can assert outright is not worth the
  // false positives.
});

// ---------------------------------------------------------------------------
describe("a non-finite value cannot reach a document by a route the dash misses", () => {
  // FOUND BY AN ADVERSARIAL PASS OVER THE FIX ABOVE, which is the whole reason
  // this repo insists on one: the plainDashes fix was correct about prose and
  // removed an ACCIDENTAL guard while it was there.
  //
  // describeAssumptions prints the variance ratio with a bare toFixed, and the
  // ratio is max/min over the group variances — Infinity as soon as one group
  // is constant. toFixed renders that as the literal "Infinity", never as the
  // "—" sentinel. Before the fix that note happened to carry an em dash
  // elsewhere and was blocked; after it, "largest/smallest variance = Infinity"
  // was insertable.
  test("describeAssumptions really can emit a literal Infinity", () => {
    const constant = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7];
    const spread = [1, 3, 9, 14, 22, 31, 45, 60, 80, 110];
    const notes = describeAssumptions([constant, spread]).join("\n");
    expect(notes).toContain("Infinity");
    // And it is NOT the em-dash sentinel, which is the point.
    expect(/Infinity/.test(notes.replace(/—/g, ""))).toBe(true);
  });

  test("the pane's gate blocks NaN and Infinity by name, not just the dash", () => {
    expect(PANE).toContain("function insertableResultText");
    // EVERY registry goes through the shared gate. The recorded failure this
    // prevents is a guard that lags the defect by one registry: the em-dash
    // check covered Analyze, was extended to Stats after a regression, and
    // still missed Finance and Bio/Assay.
    const legacy = PANE.split(/\r?\n/).filter(
      (l) => /const insertable\b/.test(l) && !/insertableResultText/.test(l),
    );
    expect(legacy).toEqual([]);
  });

  test("the gate accepts an ordinary result and rejects each bad shape", () => {
    // A source scan proves the call sites; this proves the predicate. Both are
    // needed — a correctly-wired wrong function passes the first on its own.
    // The source is TypeScript, so the one type annotation is stripped before
    // it is evaluated. Nothing else in the function is TS.
    const src = /function insertableResultText\([\s\S]*?\n\}/
      .exec(PANE)![0]
      .replace("(text: string): boolean", "(text)");
    // eslint-disable-next-line no-new-func
    const gate = new Function(`${src}; return insertableResultText;`)() as (t: string) => boolean;
    expect(gate("t(8) = 2.31, p = .049")).toBe(true);
    expect(gate("")).toBe(false);
    expect(gate("ratio = Infinity")).toBe(false);
    expect(gate("d = NaN")).toBe(false);
    expect(gate("value = —")).toBe(false);
  });
});
