// Loops that never end.
//
// A whole-library fuzz — every exported function in all 97 lib modules, called
// with hostile arguments in a child process with a heap cap and a 30s timeout —
// found seven functions that loop until the heap dies when handed a non-finite
// count. In a browser that is a hung tab. In a Word task pane it is a FROZEN
// WORD: no error, no message, no way back, and the user's document is sitting
// behind it. That failure mode is worse than any wrong answer, which is why
// these get their own file.
//
// The one that was genuinely reachable was the amortisation schedule: the pane
// passed `+r("t") * m` — years times payments per year — with no finite check,
// and `for (k = 1; k <= Infinity; k++)` never returns. The rest were guarded by
// their callers, which is exactly the arrangement that fails later: the bound
// lived in a different file from the loop, so the next caller would not know to
// repeat it. Each bound now sits on the function itself.
//
// Every test here asserts on TIME as well as value: a bug in this family does
// not return a wrong answer, it does not return at all.

import { amortizationSchedule, decliningBalanceSchedule, MAX_AMORT_PERIODS } from "../finance";
import { serialDilution, MAX_DILUTION_STEPS } from "../assay";
import { toRoman } from "../numbering";
import { logTicks } from "../plot";
import { reconcileSeqIds } from "../seqid";
import { lPow, lMono } from "../knots";
import {
  chernComplexProjectiveTangent, swRealProjectiveTangent, MAX_CHAR_CLASS_DIM,
  binomial, partitions, MAX_PARTITION_N,
} from "../topology2";
import { solveEquation, differentiate } from "../solve";

const HOSTILE = [Infinity, -Infinity, NaN, 1e308, Number.MAX_SAFE_INTEGER];

/** Runs `fn` and fails if it takes longer than a second. */
const quick = (label: string, fn: () => unknown): unknown => {
  const t0 = Date.now();
  const r = fn();
  const ms = Date.now() - t0;
  expect(`${label}: ${ms < 1000 ? "fast" : `SLOW ${ms}ms`}`).toBe(`${label}: fast`);
  return r;
};

describe("a non-finite count never starts an endless loop", () => {
  for (const n of HOSTILE) {
    it(`amortizationSchedule(…, ${n}) returns instead of freezing Word`, () => {
      const rows = quick(`amort ${n}`, () => amortizationSchedule(200000, 0.004, n)) as unknown[];
      expect(rows.length).toBeLessThanOrEqual(MAX_AMORT_PERIODS);
    });
    it(`serialDilution(…, ${n}) is bounded`, () => {
      const s = quick(`dil ${n}`, () => serialDilution(100, 10, n)) as unknown[];
      expect(s.length).toBeLessThanOrEqual(MAX_DILUTION_STEPS);
    });
    it(`toRoman(${n}) is bounded`, () => {
      const s = quick(`roman ${n}`, () => toRoman(n)) as string;
      expect(typeof s).toBe("string");
      expect(s.length).toBeLessThan(200000);
    });
    it(`logTicks at magnitude ${n} terminates`, () => {
      const t = quick(`ticks ${n}`, () => logTicks(n, n)) as { major: number[] };
      expect(Array.isArray(t.major)).toBe(true);
    });
    it(`reconcileSeqIds(…, ${n}) terminates`, () => {
      const r = quick(`seqid ${n}`, () => reconcileSeqIds([1, 2], n)) as { uncited: number[] };
      expect(r.uncited.length).toBeLessThanOrEqual(100000);
    });
    it(`lPow(…, ${n}) terminates`, () => {
      quick(`lPow ${n}`, () => lPow(lMono(1), n));
    });
    it(`decliningBalanceSchedule(…, ${n}) is bounded`, () => {
      const rows = quick(`decl ${n}`, () => decliningBalanceSchedule(10000, 500, n)) as unknown[];
      expect(rows.length).toBeLessThanOrEqual(MAX_AMORT_PERIODS);
    });
    it(`binomial at ${n} terminates`, () => {
      expect(quick(`binom ${n}`, () => binomial(n, n))).toBeDefined();
    });
    it(`partitions(${n}) terminates`, () => {
      const p = quick(`part ${n}`, () => partitions(n)) as unknown[];
      expect(Array.isArray(p)).toBe(true);
    });
    it(`characteristic classes at n = ${n} terminate`, () => {
      const c = quick(`chern ${n}`, () => chernComplexProjectiveTangent(n)) as number[];
      const w = quick(`sw ${n}`, () => swRealProjectiveTangent(n)) as number[];
      expect(c.length).toBeLessThanOrEqual(MAX_CHAR_CLASS_DIM + 1);
      expect(w.length).toBeLessThanOrEqual(MAX_CHAR_CLASS_DIM + 1);
    });
  }
});

describe("the ordinary answers are unchanged by the bounds", () => {
  it("a 30-year monthly mortgage still has 360 rows", () => {
    expect(amortizationSchedule(200000, 0.05 / 12, 360).length).toBe(360);
  });
  it("a 4-step dilution still has 4 steps", () => {
    expect(serialDilution(100, 10, 4).map((s) => s.concentration)).toEqual([100, 10, 1, 0.1]);
  });
  it("roman numerals still work", () => {
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(1987)).toBe("MCMLXXXVII");
  });
  it("log ticks over a normal domain are unchanged", () => {
    expect(logTicks(0, 3).major).toEqual([1, 10, 100, 1000]);
  });
  it("partitions and binomials are still right", () => {
    expect(partitions(4).length).toBe(5); // 4, 3+1, 2+2, 2+1+1, 1+1+1+1
    expect(binomial(6, 2)).toBe(15n);
    expect(MAX_PARTITION_N).toBeGreaterThan(20);
  });
  it("a 10-year declining balance still has 10 rows", () => {
    expect(decliningBalanceSchedule(10000, 500, 10).length).toBe(10);
  });
  it("w(T RP^5) and c(T CP^2) are still the classical answers", () => {
    // (1+a)^6 mod 2 = 1 + a^2 + a^4 truncated at degree 5.
    expect(swRealProjectiveTangent(5)).toEqual([1, 0, 1, 0, 1, 0]);
    // c(T CP^2) = 1 + 3x + 3x^2.
    expect(chernComplexProjectiveTangent(2)).toEqual([1, 3, 3]);
  });
});

describe("a numeric literal too large to represent is refused, not silently infinite", () => {
  // Blocking the identifiers "NaN" and "Infinity" did not cover this: 1e999 is
  // neither, and it overflowed to -Infinity, giving "Reduced to -Infinity = 0".
  for (const src of ["1e999", "-1e999", "1e999 = 0", "x + 1e400 = 0"]) {
    it(`"${src}" is refused`, () => {
      expect(solveEquation(src)).toBeNull();
    });
  }
  it("differentiating one is refused too", () => {
    expect(differentiate("-1e999")).toBeNull();
  });
  it("a large but representable literal still works", () => {
    const r = solveEquation("x - 1e300 = 0")!;
    expect(r.roots[0].re).toBe(1e300);
  });
});
