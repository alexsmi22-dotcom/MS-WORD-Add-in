// v2.136.0 symbolic batch: INDEPENDENT adversarial review (docs/SCOPE-SYMBOLIC-BATCH.md).
//
// Each pin is a defect confirmed against an independent oracle (SymPy 1.14 / mpmath,
// statsmodels 0.15 proportion_confint, exact rational linear solves, or the HEAD
// v2.135.0 tree for regressions). Convention:
//   plain `it`     — FAILS today: a wrong answer, a hang, or a false claim on the page.
//   `it.failing`   — PASSES today and flips when fixed: a refusal where the answer is
//                    within the stated scope, or a cosmetic form. Remove `.failing` then.
// Assertions are on values and result fields, not on prose, because the integrator is
// still editing the pane-facing wording.

import { spawnSync } from "child_process";
import * as path from "path";
import { solveEquation, parseExpr, antiderivative, integrate } from "../solve";
import { casSimplifyReport } from "../cas";
import { radiusOfFunction } from "../radius";
import { tryProbability } from "../probability";
import { tryMarkov } from "../markov";
import { tryMultivar } from "../multivar";

const textOf = (v: { lines: { text: string }[] } | null): string => (v ? v.lines.map((l) => l.text).join("\n") : "");

/** "[a, b]" on the first line matching `re`. */
function interval(v: { lines: { text: string }[] } | null, re: RegExp): [number, number] | null {
  const line = v?.lines.map((l) => l.text).find((t) => re.test(t));
  const m = line ? /\[([-−\d.e]+),\s*([-−\d.e]+)\]/.exec(line) : null;
  return m ? [Number(m[1].replace("−", "-")), Number(m[2].replace("−", "-"))] : null;
}

// ---------------------------------------------------------------------------
// WRONG answers
// ---------------------------------------------------------------------------

describe("WRONG — roots", () => {
  it("x^20 + 100000000*x^19 - 1 = 0 prints finite roots (today: 20 × NaN under 'complete'; REGRESSION — v2.135.0 gave 0.379269019)", () => {
    // SymPy nroots: real roots −1e8 and 0.379269018997517; the rest complex.
    // polyRoots.numericRoots never checks its output for non-finite values.
    for (const q of ["x^20 + 100000000*x^19 - 1 = 0", "x^20 + 123456789*x^19 - 1 = 0"]) {
      const r = solveEquation(q)!;
      expect(r.roots.length).toBe(20);
      for (const root of r.roots) {
        expect(Number.isFinite(root.re)).toBe(true);
        expect(Number.isFinite(root.im)).toBe(true);
      }
    }
    const r = solveEquation("x^20 + 100000000*x^19 - 1 = 0")!;
    expect(r.roots.some((z) => z.im === 0 && Math.abs(z.re - 0.379269018997517) < 1e-9)).toBe(true);
  });

  it("x^30 + 1000000*x^29 - 1 = 0 prints finite roots (today NaN; pre-existing in v2.135.0, still shipped)", () => {
    const r = solveEquation("x^30 + 1000000*x^29 - 1 = 0")!;
    expect(r.roots.every((z) => Number.isFinite(z.re) && Number.isFinite(z.im))).toBe(true);
  });

  it("Wilkinson ∏(x − k), k = 1..20, + 1/10^10: roots are the integers to far better than 1e-6 (today 20.0000522986, 17.9989957642, … under '1e-12 relative')", () => {
    // Shift of root k is −1e-10/p′(k), |p′(k)| ≥ 9!·10! ≈ 1.3e12 → < 1e-22 (SymPy, 40 digits: 20.000000000…).
    // The '+ 1' variant prints the SAME digits: the coefficients were rounded to doubles (20! > 2^53).
    const w = Array.from({ length: 20 }, (_, k) => `(x-${k + 1})`).join("*");
    const r = solveEquation(`${w} + 1/10000000000 = 0`)!;
    expect(r.roots.length).toBe(20);
    for (const z of r.roots) {
      expect(z.im).toBe(0);
      expect(Math.abs(z.re - Math.round(z.re))).toBeLessThan(1e-6);
    }
  });
});

describe("WRONG — integration", () => {
  it("∫₁^2.5 1/sqrt(-5/2 - x^2 + 7/2*x) dx = π (today 'does not exist on this interval', although the antiderivative asin(4x/3 − 7/3) is found)", () => {
    // Q = (x − 1)(5/2 − x) > 0 on the open interval; ∫ dx/√((x−a)(b−x)) = π. Pre-existing in
    // v2.135.0, but this release's asin rule makes it answerable and it still claims non-existence.
    const r = integrate("1/sqrt(-5/2 - x^2 + 7/2*x)", 1, 2.5, "x")!;
    expect(r.value).toBeCloseTo(Math.PI, 9);
    const r2 = integrate("1/sqrt(4*(x-1)*(2.5-x))", 1, 2.5, "x")!;
    expect(r2.value).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("WRONG — radius", () => {
  it("0*log(1-x) is identically 0: R is ∞ (or at worst a lower bound), never 'R = 1, diverges for |x| > 1'", () => {
    for (const f of ["0*log(1-x)", "log(1-x)*sin(0)"]) {
      const r = radiusOfFunction(f);
      expect(["infinite", "lowerBound"]).toContain(r.kind);
    }
  });
});

describe("WRONG — proportion CI computed at the wrong level", () => {
  it("'clopper pearson 80% 4/54' uses 80% (today it silently computes 95%)", () => {
    // statsmodels proportion_confint(4, 54, alpha=0.2): wilson (0.039929, 0.133363), beta (0.032697, 0.142604).
    // '80% clopper pearson 4/54' and 'clopper pearson interval 80% 4 out of 54' are right; only
    // 'clopper pearson <L>% …' drops the level.
    for (const q of ["clopper pearson 80% 4/54", "clopper pearson 80% 4 of 54"]) {
      const v = tryProbability(q);
      const w = interval(v, /^Wilson/);
      const cp = interval(v, /^Clopper/);
      expect(w).not.toBeNull();
      expect(cp).not.toBeNull();
      expect(w![0]).toBeCloseTo(0.039929, 5);
      expect(w![1]).toBeCloseTo(0.133363, 5);
      expect(cp![0]).toBeCloseTo(0.032697, 5);
      expect(cp![1]).toBeCloseTo(0.142604, 5);
    }
  });
});

describe("WRONG — Markov answers another question", () => {
  it("a 2-state chain asked for the hitting time to state 3 does not print a mean-first-passage matrix", () => {
    // Today: "M = [[2, 2]]   (row S1; columns S1, S2)" — a malformed 1×2 matrix for a question
    // about a state that does not exist. It must refuse naming the missing state.
    const v = tryMarkov("markov [[0.5,0.5],[0.5,0.5]] expected hitting time from 1 to 3");
    expect(textOf(v)).not.toMatch(/M = \[\[/);
  });
});

// ---------------------------------------------------------------------------
// HANG (regression)
// ---------------------------------------------------------------------------

describe("HANG", () => {
  it(
    "lagrange x^4*y^3 + y^5 - x subject to x^4 + y^6 + x^3*y^2 = 5 returns in < 4 s (today > 9 min; v2.135.0: 72 ms)",
    () => {
      // Run in a child: the call is synchronous, so an in-process hang could never be
      // interrupted by jest's timeout. Measured: resultant 99 ms (deg 52 in y),
      // exactPolyRoots 321 ms — the time goes after those, most likely the uncapped exact
      // Sturm chain (multivar sturmRealRootCount) or ratPolyGcd(R, R′) over ℚ at degree 52.
      const repo = path.resolve(__dirname, "../../..");
      const script =
        `require(${JSON.stringify(path.join(repo, "scripts", "ts-require.js"))});` +
        `const { tryMultivar } = require(${JSON.stringify(path.join(repo, "src", "lib", "multivar.ts"))});` +
        `const t = Date.now();` +
        `tryMultivar("lagrange x^4*y^3 + y^5 - x subject to x^4 + y^6 + x^3*y^2 = 5");` +
        `process.stdout.write(String(Date.now() - t));`;
      const res = spawnSync(process.execPath, ["-e", script], { timeout: 45_000, encoding: "utf8" });
      expect(res.error).toBeUndefined();
      expect(res.status).toBe(0);
      expect(Number(res.stdout)).toBeLessThan(4000);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// SILENT MISLABEL — a false claim on the page / in the API contract
// ---------------------------------------------------------------------------

describe("SILENT — casSimplifyReport.anyCancellation under-reports", () => {
  it("(x^2 - y^2)/(x - y) - x - y → 0 removes the points x = y: anyCancellation must be true", () => {
    // cas.ts documents the flag as CONSERVATIVE ("under-reporting would let a caller drop the
    // caveat"). A sum that cancels to 0 drops its denominator without passing the flag:
    // 28 of 194 random fractions (A·G/(B·G) − A/B) came back 0 with anyCancellation false.
    for (const s of ["(x^2 - y^2)/(x - y) - x - y", "1/x - 1/x", "(3*x - 3)/(18*x + 24) - (1 - x)/(-6*x - 8)"]) {
      const rep = casSimplifyReport(parseExpr(s));
      expect(rep.anyCancellation).toBe(true);
    }
  });
});

describe("SILENT — decimals under an 'exact' label (asin with an irrational scale)", () => {
  it("DEFINITE ∫₀¹ 1/sqrt(2 - x^2): the antiderivative shown under 'exact (symbolic)' has no 12-digit decimal (today asin(0.707106781187*x))", () => {
    // The INDEFINITE path was fixed in the tree during this review (now asin(sqrt(2)/2*x)); the
    // definite path still reports F = asin(0.707106781187*x) beside method "exact (symbolic)".
    const r = integrate("1/sqrt(2-x^2)", 0, 1, "x")!;
    expect(r.value).toBeCloseTo(Math.PI / 4, 12);
    if (/exact/.test(r.method)) expect(r.antiderivative ?? "").not.toMatch(/\d\.\d{6,}/);
  });

  it("guard (fixed during review): the indefinite forms carry sqrt, not decimals", () => {
    // Was: asin(0.707106781187*x) and 0.707106781187*asin(1.41421356237*x) "proved identically zero".
    for (const f of ["1/sqrt(2-x^2)", "1/sqrt(1-2*x^2)", "1/sqrt(5-x^2)"]) {
      const r = antiderivative(f, "x")!;
      expect(r).not.toBeNull();
      if (/exact/.test(r.method)) expect(r.antiderivative).not.toMatch(/\d\.\d{6,}/);
    }
  });
});

// ---------------------------------------------------------------------------
// REFUSAL WHERE ANSWERABLE (it.failing — passes today, flips when fixed)
// ---------------------------------------------------------------------------

describe("REFUSAL — answerable inside the stated scope", () => {
  it("guard (fixed in the tree during review; was null): antiderivative 1/sqrt(-x^2 + 8*x - 15) = asin(x - 4)", () => {
    const r = antiderivative("1/sqrt(-x^2 + 8*x - 15)", "x");
    expect(r).not.toBeNull();
    expect(r!.antiderivative.replace(/\s/g, "")).toBe("asin(x-4)");
  });

  it("antiderivative 1/sqrt(1-x^2) + 1/sqrt(4-x^2) = asin(x) + asin(x/2) (today null)", () => {
    expect(antiderivative("1/sqrt(1-x^2) + 1/sqrt(4-x^2)", "x")).not.toBeNull();
  });

  it("x^5 + 3x^4 + x^3 + 13x^2 - 9x - 3 = (x^2 + 3x - 3)(x^3 + 4x + 1) and x^6 + 1 get exact roots (§C: 'anything that factors over ℚ into pieces of degree ≤ 4')", () => {
    for (const q of ["x^5 + 3*x^4 + x^3 + 13*x^2 - 9*x - 3 = 0", "x^6 + 1 = 0", "x^8 - 1 = 0"]) {
      const r = solveEquation(q)!;
      expect(r.roots.every((z) => z.exact)).toBe(true);
    }
  });

  it("double integral of y/((x-0.3)^2 + 1e-8) over [0,1]² = 15705.5823156 (today: 'No closed form … not converged')", () => {
    const v = tryMultivar("double integral 1/((x-0.3)^2 + 1e-8)*y over x from 0 to 1, y from 0 to 1");
    expect(textOf(v)).toMatch(/15705\.58/);
  });

  it("the near-pole flagship in expanded form, 1/(x^2 - 0.6*x + 0.09000001), is not withheld (truth 31411.1646313)", () => {
    const v = tryMultivar("double integral 1/(x^2 - 0.6*x + 0.09000001) over x from 0 to 1, y from 0 to 1");
    expect(textOf(v)).toMatch(/31411\.16/);
  });

  it("a pole OUTSIDE the region does not veto the certificate: + 1/(x-2) → 31410.4714841 (SymPy), today withheld", () => {
    const v = tryMultivar("double integral 1/((x-0.3)^2 + 1e-8) + 1/(x-2) over x from 0 to 1, y from 0 to 1");
    expect(textOf(v)).toMatch(/31410\.47/);
  });

  it("lagrange x*y + 1 subject to x^2 + y^2 = pi → max 1 + pi/2, min 1 - pi/2 (today 'could not be solved'; 3.14159 on the right solves)", () => {
    const t = textOf(tryMultivar("lagrange x*y + 1 subject to x^2 + y^2 = pi"));
    expect(t).toMatch(/Maximum f/);
  });

  it("radius of sin(x)/(x - pi) is ∞ (removable); today refused because 'the zeros of x - pi are not determined'", () => {
    expect(radiusOfFunction("sin(x)/(x - pi)").kind).toBe("infinite");
  });
});

// ---------------------------------------------------------------------------
// COSMETIC (it.failing)
// ---------------------------------------------------------------------------

describe("COSMETIC", () => {
  it("maximize x y subject to x^2 + y^2 = 2*pi prints sqrt(pi), not sqrt(2*2*pi)/2", () => {
    expect(textOf(tryMultivar("maximize x y subject to x^2 + y^2 = 2*pi"))).not.toMatch(/2\*2\*pi/);
  });

  it("gradient x^y at (2, 0): |∇f| = ln(2), not sqrt(ln(2)^2)", () => {
    expect(textOf(tryMultivar("gradient x^y at (2, 0)"))).not.toMatch(/sqrt\(ln\(2\)\^2\)/);
  });

  it("hessian x^y at (2, 3): H(2, 3) has no unfolded 2^(3 - 2)", () => {
    expect(textOf(tryMultivar("hessian x^y at (2, 3)"))).not.toMatch(/2\^\(3 - [12]\)/);
  });

  it("radius of 1/(x^4 + 1) is exactly 1, not 'R ≈ 1'", () => {
    expect(radiusOfFunction("1/(x^4+1)").exact).toBe("1");
  });
});
