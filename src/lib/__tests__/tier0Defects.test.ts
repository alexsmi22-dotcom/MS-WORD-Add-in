// Regression tests for the eight live defects found by the 2026-08-01 gap
// analysis (docs/GAP-ANALYSIS-2026-08-01.md). Each test is written to FAIL on
// the old behaviour, so it pins the fix rather than merely describing it.

import * as fs from "fs";
import * as path from "path";
import { predictNmr } from "../nmr";
import { analyzeData } from "../insights";
import { align } from "../align";
import { describeCrash, messageOf, trimStack, crashAdvice } from "../crashReport";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("0.1 NMR names heteronuclear coupling instead of dropping it", () => {
  const caveatsFor = (smiles: string): string => {
    const r = predictNmr(smiles, "1H");
    if (!r) throw new Error(`predictNmr returned null for ${smiles}`);
    return r.caveats.join(" ");
  };

  it("a fluorinated compound warns that 19F coupling is not in the multiplicities", () => {
    // 2-fluoroethanol: the CH2-F protons are a doublet in reality (2J ~ 47 Hz)
    // and the old model reported them with no coupling and no warning.
    const c = caveatsFor("OCCF");
    expect(c).toMatch(/¹⁹F/);
    expect(c).toMatch(/not included in the multiplicities/i);
  });

  it("fluorobenzene warns too — three-bond coupling counts", () => {
    expect(caveatsFor("c1ccc(F)cc1")).toMatch(/¹⁹F/);
  });

  it("a phosphorus compound warns about 31P", () => {
    expect(caveatsFor("CCOP(=O)(OCC)OCC")).toMatch(/³¹P/);
  });

  it("ordinary organics are NOT given the warning — it must stay specific", () => {
    for (const smiles of ["CCO", "c1ccccc1", "CC(=O)C", "CCCCN"]) {
      const c = caveatsFor(smiles);
      expect(c).not.toMatch(/¹⁹F|³¹P/);
    }
  });

  it("exchangeable OH/NH coupling is still correctly ignored, not warned about", () => {
    // The old comment's reasoning was right for O and N; the fix must not have
    // turned that into a false alarm.
    expect(caveatsFor("CCO")).not.toMatch(/not included in the multiplicities/i);
  });
});

describe("0.2 Insights corrects for multiple comparisons", () => {
  /** A table of `cols` pure-noise columns, deterministic. */
  function noiseTable(cols: number, rows = 12): string {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const head = Array.from({ length: cols }, (_, i) => `c${i + 1}`).join("\t");
    const body = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (rnd() * 100).toFixed(2)).join("\t"),
    );
    return [head, ...body].join("\n");
  }

  it("every correlation carries an adjusted p and the comparison count", () => {
    const r = analyzeData(noiseTable(5))!;
    expect(r.correlations.length).toBe(10); // 5 choose 2
    for (const c of r.correlations) {
      expect(c.comparisons).toBe(10);
      expect(c.pAdjusted).toBeGreaterThanOrEqual(c.p); // BH never lowers a p
      expect(Number.isFinite(c.pAdjusted)).toBe(true);
      expect(c.pAdjusted).toBeLessThanOrEqual(1);
    }
  });

  it("the narrative states how many pairs were tested and that it corrected", () => {
    const text = analyzeData(noiseTable(6))!.insights.join(" ");
    expect(text).toMatch(/15 pairs were tested at once/);
    expect(text).toMatch(/Benjamini-Hochberg/);
  });

  it("a single pair is not treated as a multiple-comparison problem", () => {
    const r = analyzeData("x\ty\n1\t2\n2\t4.1\n3\t5.9\n4\t8.2\n5\t9.8\n6\t12.1")!;
    expect(r.correlations[0].comparisons).toBe(1);
    expect(r.correlations[0].pAdjusted).toBeCloseTo(r.correlations[0].p, 12);
    expect(r.insights.join(" ")).not.toMatch(/pairs were tested at once/);
  });

  it("a real correlation still survives correction — the fix must not silence signal", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `${i}\t${2 * i + 1}\t${(i * 7919) % 13}`);
    const r = analyzeData(["x\ty\tnoise", ...rows].join("\n"))!;
    const xy = r.correlations.find((c) => (c.a === "x" && c.b === "y") || (c.a === "y" && c.b === "x"))!;
    expect(xy.pAdjusted).toBeLessThan(0.05);
    expect(r.insights.join(" ")).toMatch(/correlated/);
  });

  it("the causation caveat appears whenever a correlation is reported", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `${i}\t${2 * i + 1}`);
    const r = analyzeData(["x\ty", ...rows].join("\n"))!;
    expect(r.insights.join(" ")).toMatch(/Correlation is not causation/);
  });
});

describe("0.7 Align warns on a multi-record FASTA instead of aligning a chimera", () => {
  const two = ">a\nACGTACGTAC\n>b\nTTTTGGGGCC\n";

  it("warns, and names the record count", () => {
    const r = align(two, "ACGTACGTAC")!;
    expect(r.caveats.join(" ")).toMatch(/2 FASTA records/);
    expect(r.caveats[0]).toMatch(/joined into one sequence/);
  });

  it("warns for either input", () => {
    expect(align("ACGTACGTAC", two)!.caveats.join(" ")).toMatch(/second input holds 2/);
  });

  it("a single-record FASTA is silent — no false alarm", () => {
    const r = align(">one\nACGTACGTAC", ">two\nACGTACGTAC")!;
    expect(r.caveats.join(" ")).not.toMatch(/FASTA records/);
  });

  it("still aligns — the warning does not replace the result", () => {
    expect(align(two, "ACGTACGTAC")!.percentIdentity).toBeGreaterThan(0);
  });
});

describe("0.5 the crash reporter survives whatever is thrown at it", () => {
  it("extracts a message from every shape a throw can take", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf("plain string")).toBe("plain string");
    expect(messageOf({ message: "office-shaped" })).toBe("office-shaped");
    expect(messageOf({ code: 5001 })).toBe("code 5001");
    expect(messageOf(null)).toMatch(/null/);
    expect(messageOf(undefined)).toMatch(/undefined/);
    expect(messageOf(42)).toBe("42");
  });

  it("does not throw on a circular object", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => messageOf(a)).not.toThrow();
  });

  it("trims a stack to a pasteable size", () => {
    const e = new Error("x");
    e.stack = "Error: x\n" + Array.from({ length: 40 }, (_, i) => `    at f${i} (bundle.js:${i})`).join("\n");
    const t = trimStack(e);
    expect(t.split("\n").length).toBe(6);
    expect(t).not.toMatch(/Error: x/); // the message is reported separately
  });

  it("the report carries the version so a bug can be tied to a release", () => {
    const info = describeCrash(new Error("kaboom"), "an uncaught error", "2.64.0");
    expect(info.report).toMatch(/JurisLab 2\.64\.0/);
    expect(info.report).toMatch(/kaboom/);
    expect(info.detail).toBe("kaboom");
  });

  it("the advice answers the question a user actually has first", () => {
    expect(crashAdvice()).toMatch(/document has not been changed/i);
  });
});

describe("0.3 / 0.4 / 0.8 / 0.9 — claims that had drifted", () => {
  const pane = read("src/taskpane/taskpane.ts");

  it("0.3 the Engineering tile COUNTS its calculators rather than naming a number", () => {
    expect(pane).toMatch(/\$\{ENG_CALCS\.length\} calculators across/);
    // The stale literals must be gone from the tile.
    expect(pane).not.toMatch(/desc: "36 calculators/);
  });

  it("0.4 Finance is not hidden behind the legal audience chip", () => {
    expect(pane).not.toMatch(/\{ mode: "finance", audience: \["legal"\]/);
    expect(pane).toMatch(/\{ mode: "finance", label: "Finance"/);
  });

  it("0.5 the global handlers are installed at module scope, before Office.onReady", () => {
    const errAt = pane.indexOf('window.addEventListener("error"');
    const rejAt = pane.indexOf('window.addEventListener("unhandledrejection"');
    const readyAt = pane.indexOf("Office.onReady(");
    expect(errAt).toBeGreaterThan(-1);
    expect(rejAt).toBeGreaterThan(-1);
    // Ordering is the whole point: a failure DURING init is the case that
    // renders a blank pane, and it happens before onReady's body runs.
    expect(errAt).toBeLessThan(readyAt);
    expect(rejAt).toBeLessThan(readyAt);
  });

  it("0.5 the banner is built with DOM calls, never innerHTML", () => {
    const start = pane.indexOf("function showCrashBanner");
    // Slice to the END of the function, not a guessed character count — a fixed
    // window ran past it into unrelated code that legitimately uses innerHTML.
    const body = pane.slice(start, pane.indexOf('window.addEventListener("error"', start));
    expect(body.length).toBeGreaterThan(200); // anti-vacuity: we really sliced it
    expect(body).toMatch(/textContent/);
    // Assignment, not the word — the code comment legitimately mentions
    // innerHTML to explain why it is not used.
    expect(body).not.toMatch(/\.innerHTML\s*=/);
  });

  it("0.8 science.html no longer sells restriction sites on the sequence MAP", () => {
    const sci = read("landing/science.html");
    const card = sci.slice(sci.indexOf("Sequence maps"), sci.indexOf("Sequence maps") + 900);
    expect(card).toMatch(/DNA<\/strong> tool next door/);
  });

  it("0.9 the stale refusals are gone", () => {
    expect(read("src/lib/toa.ts")).not.toMatch(/Page numbers are intentionally omitted/);
    expect(read("src/lib/linalg.ts")).not.toMatch(/can be complex and are intentionally out of scope/);
    expect(read("ROADMAP.md")).not.toMatch(/## Where we are \(v1\.96\.0\)/);
  });

  it("0.9 the New-badge promise matches what is actually badged", () => {
    const idx = read("landing/index.html");
    expect(idx).toMatch(/are disciplines added since v2\.55/);
    expect(idx).not.toMatch(/arrived in the last few releases/);
  });
});
