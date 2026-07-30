// Limits that do not exist, integrals that were refused, and a 20-second freeze.
//
//   A9  the limit convergence test was `spread <= 1e-4 * (1 + |last|)`. That `1 +`
//       is an absolute floor bolted onto a relative tolerance, so ANY tail whose
//       values were smaller than about 1e-4 passed it however wildly it swung.
//       Multiplying by a positive constant therefore changed whether a limit
//       existed: sin(1/x) was correctly undetermined, 1e-5*sin(1/x) came back as
//       -6.11e-6.
//   B7  partial-fraction integration divided its answer by the denominator's
//       leading coefficient — which the basis polynomials already carry — so the
//       self-verification gate rejected every non-monic result and the integrator
//       returned null. A dozen textbook integrals were refused. Every monic sibling
//       worked, which is every test that existed.
//   B9  the rational-root search capped its DIVISOR search but not the CROSS
//       PRODUCT of divisors, reaching 1.6 million exact BigInt evaluations per
//       degree. 20.6 seconds of synchronous work in a task pane that recomputes on
//       every keystroke.
//
// A8 turned out to be already fixed: its symptom — `limit x^2 as x -> 0.0001`
// printing "= 0" — was the 6-decimal-place rounding in fmtNum removed in v2.40.0.
// The cases from the report are pinned below so it stays fixed.

import { limit } from "../analysis";
import { integrate, parseExpr, derivative, differentiate } from "../solve";
import { symbolicIntegrate } from "../casint";
import { ratPolyRoots, ratFromNumber, parseRatLiteral } from "../cas";

// ---------------------------------------------------------------------------
// A9 — a constant factor cannot create or destroy a limit
// ---------------------------------------------------------------------------

describe("A9: the oscillation test is scale-free", () => {
  test.each(["1", "0.5", "0.1", "1e-3", "1e-5", "1e-9", "1e-15", "1e-30"])(
    "%s * sin(1/x) has no limit at 0, whatever the constant",
    (k) => {
      const r = limit(`${k}*sin(1/x)`, "x", 0);
      // The reported value must be absent. Before, everything from 1e-5 down
      // returned a number — the last sample, presented as the answer.
      expect({ k, value: r?.value }).toEqual({ k, value: undefined });
    },
  );

  test("scaling an expression does not change whether it has a limit", () => {
    // The sharpest statement of the defect. This is an identity of limits, not a
    // numerical nicety: if c > 0 then lim c*f exists iff lim f exists.
    const base = limit("sin(1/x)", "x", 0);
    for (const k of ["1e-4", "1e-6", "1e-8", "1e-12"]) {
      const scaled = limit(`${k}*sin(1/x)`, "x", 0);
      expect({ k, same: (scaled?.value === undefined) === (base?.value === undefined) }).toEqual({
        k,
        same: true,
      });
    }
  });

  test("a DECAYING oscillation still converges to zero", () => {
    // The case the fix must not break: x*sin(1/x) genuinely tends to 0, and the
    // envelope trend is what separates it from a steady oscillation. Refusing it
    // would trade a wrong answer for a withheld correct one.
    for (const e of ["x*sin(1/x)", "x^2*sin(1/x)", "1e-6*x*sin(1/x)"]) {
      const r = limit(e, "x", 0);
      expect({ e, value: r?.value }).toEqual({ e, value: 0 });
    }
  });

  test("ordinary limits are untouched", () => {
    const cases: Array<[string, number, number]> = [
      ["sin(x)/x", 0, 1],
      ["(1-cos(x))/x^2", 0, 0.5],
      ["x^2", 2, 4],
      ["(x^2-1)/(x-1)", 1, 2],
      ["tan(x)/x", 0, 1],
      ["exp(x)", 0, 1],
      ["(exp(x)-1)/x", 0, 1],
      ["ln(1+x)/x", 0, 1],
    ];
    for (const [e, p, want] of cases) {
      const r = limit(e, "x", p);
      expect(r).not.toBeNull();
      expect({ e, ok: Math.abs((r!.value ?? NaN) - want) < 1e-6 }).toEqual({ e, ok: true });
    }
  });

  test("a genuinely tiny limit is still reported, not rounded to zero", () => {
    // The counterweight to the oscillation fix: a limit that really is 1e-20 must
    // come back as 1e-20. These are also the A8 reproductions.
    const cases: Array<[string, number, number]> = [
      ["1e-7 + x", 0, 1e-7],
      ["1e-10 + x", 0, 1e-10],
      ["1e-20 + x", 0, 1e-20],
      ["0.5e-6 + x", 0, 5e-7],
      ["x^2", 0.0001, 1e-8],
      ["x^2", 0.001, 1e-6],
    ];
    for (const [e, p, want] of cases) {
      const r = limit(e, "x", p);
      expect(r).not.toBeNull();
      const got = r!.value ?? NaN;
      expect({ e, rel: Math.abs(got / want - 1) < 1e-9 }).toEqual({ e, rel: true });
    }
  });

  test("a divergent limit still diverges", () => {
    for (const e of ["1/x^2", "1/abs(x)"]) {
      const r = limit(e, "x", 0);
      expect(r).not.toBeNull();
      expect({ e, finite: Number.isFinite(r!.value ?? NaN) }).toEqual({ e, finite: false });
    }
  });
});

// ---------------------------------------------------------------------------
// B7 — non-monic rational integrals, against hand-computed values
// ---------------------------------------------------------------------------

describe("B7: a non-monic denominator no longer defeats partial fractions", () => {
  test("the CAS integrator now finds these at all", () => {
    for (const f of [
      "1/(2*x+3)", "1/(4*x^2-1)", "1/(3*x^2+5*x+2)", "x/(2*x+1)",
      "1/(9*x^2+1)", "1/(6*x^2-5*x+1)", "5/(2*x^2+3*x+1)", "1/(3-2*x)",
      "1/(4*x^2+4*x+2)", "(x^2+1)/(2*x+1)",
    ]) {
      const F = symbolicIntegrate(parseExpr(f), "x", derivative);
      expect({ f, found: F !== null }).toEqual({ f, found: true });
    }
  });

  test("and the values are right, against integrals worked out by hand", () => {
    // Every expected value below comes from elementary calculus, not from this code.
    const cases: Array<[string, number, number, number]> = [
      // ∫dx/(2x+3) = ½ln|2x+3|  ->  ½ln(9/7)
      ["1/(2*x+3)", 2, 3, 0.5 * Math.log(9 / 7)],
      // ∫dx/(4x²−1) = ¼ln|(2x−1)/(2x+1)|  ->  ¼ln(25/21)
      ["1/(4*x^2-1)", 2, 3, 0.25 * Math.log(25 / 21)],
      // 1/((3x+2)(x+1)) = 3/(3x+2) − 1/(x+1)  ->  ln|3x+2| − ln|x+1|
      ["1/(3*x^2+5*x+2)", 0, 0.5, Math.log(3.5 / 1.5) - Math.log(2)],
      // ∫x/(2x+1) = ½[x − ½ln|2x+1|]
      ["x/(2*x+1)", 0, 1, 0.5 * (1 - 0.5 * Math.log(3))],
      // ∫dx/(9x²+1) = ⅓atan(3x)
      ["1/(9*x^2+1)", 0, 1, Math.atan(3) / 3],
      // ∫dx/(3−2x) = −½ln|3−2x|
      ["1/(3-2*x)", 0, 1, -0.5 * (Math.log(1) - Math.log(3))],
    ];
    for (const [f, a, b, want] of cases) {
      const r = integrate(f, a, b);
      expect(r).not.toBeNull();
      expect({ f, method: r!.method }).toEqual({ f, method: "exact (symbolic)" });
      expect(Math.abs(r!.value - want)).toBeLessThan(1e-9);
    }
  });

  test("the antiderivative differentiates back to the integrand", () => {
    // The property that actually matters, checked on the expression that is shown.
    for (const f of ["1/(2*x+3)", "1/(4*x^2-1)", "x/(2*x+1)", "1/(9*x^2+1)"]) {
      const r = integrate(f, 2, 3);
      expect(r!.antiderivative).toBeTruthy();
      const back = differentiate(r!.antiderivative!);
      expect(back).not.toBeNull();
      // Compare numerically at points inside the interval.
      const F = parseExpr(back!.derivative);
      const target = parseExpr(f);
      for (const x of [2.1, 2.5, 2.9]) {
        const { evalAst } = require("../solve");
        const got = evalAst(F, { x });
        const wanted = evalAst(target, { x });
        expect({ f, x, close: Math.abs(got - wanted) < 1e-9 * Math.max(1, Math.abs(wanted)) }).toEqual({
          f, x, close: true,
        });
      }
    }
  });

  test("monic denominators are unaffected", () => {
    const cases: Array<[string, number, number, number]> = [
      ["1/(x+3)", 0, 1, Math.log(4 / 3)],
      ["1/(x^2+1)", 0, 1, Math.PI / 4],
      // integral dx/(x^2-1) = 1/2 * ln|(x-1)/(x+1)|, so from 2 to 3 this is
      // (1/2)[ln(2/4) - ln(1/3)]. My first attempt wrote (1/2)ln((1/2)/(2/4)),
      // which is (1/2)ln(1) = 0 — an arithmetic slip in the TEST, not the code.
      ["1/(x^2-1)", 2, 3, 0.5 * (Math.log(2 / 4) - Math.log(1 / 3))],
      ["1/(x^2+x+1)", 0, 1, (2 / Math.sqrt(3)) * (Math.atan(3 / Math.sqrt(3)) - Math.atan(1 / Math.sqrt(3)))],
    ];
    for (const [f, a, b, want] of cases) {
      const r = integrate(f, a, b);
      expect(r).not.toBeNull();
      expect({ f, close: Math.abs(r!.value - want) < 1e-8 }).toEqual({ f, close: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B9 — a clamp that bounds the search does not bound the time
// ---------------------------------------------------------------------------

describe("B9: the rational-root candidate set is capped", () => {
  // 963761198400 has 6720 divisors, 905 of them at or below the divisor-search
  // bound, so the uncapped cross product reached 1,638,050 candidates.
  const H = () => parseRatLiteral("963761198400")!;
  const H1 = () => parseRatLiteral("963761198401")!;

  test("a highly composite polynomial returns promptly", () => {
    const t0 = Date.now();
    const r = ratPolyRoots([H(), H1(), H()]);
    const ms = Date.now() - t0;
    // Was 1710 ms.
    expect(ms).toBeLessThan(500);
    // and it must ADMIT the search was not exhaustive rather than implying there
    // are no rational roots
    expect(r.incomplete).toBe(true);
  });

  test("integration over such a polynomial no longer freezes", () => {
    // Was 2408 ms at degree 2, 10881 at degree 6 and 20639 at degree 8 — a task
    // pane recomputing on every keystroke cannot afford any of those.
    const t0 = Date.now();
    for (const d of [2, 4, 6, 8]) {
      const mid = d > 1 ? ` + 963761198401*x` : "";
      integrate(`1/(963761198400*x^${d}${mid} + 963761198400)`, 0, 1);
    }
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  test("ordinary rational roots are still found, and marked complete", () => {
    const n = (v: number) => ratFromNumber(v);
    const cases: Array<[number[], number]> = [
      [[-6, 11, -6, 1], 3],   // (x-1)(x-2)(x-3)
      [[-1, 0, 1], 2],        // (x-1)(x+1)
      [[2, -3, 1], 2],        // (x-1)(x-2)
      [[6, -5, 1], 2],        // (x-2)(x-3)
      [[0, 0, 1], 1],         // x^2, a double root at 0
      [[1, 0, 1], 0],         // x^2+1, no rational roots
    ];
    for (const [coeffs, want] of cases) {
      const r = ratPolyRoots(coeffs.map(n));
      expect({ coeffs, n: r.roots.length, incomplete: r.incomplete }).toEqual({
        coeffs,
        n: want,
        incomplete: false,
      });
    }
  });

  test("`incomplete` distinguishes a capped search from a proof of no roots", () => {
    // Without the flag, a truncated search returning nothing is indistinguishable
    // from "this polynomial has no rational roots" — a false statement dressed as a
    // result. x^2+1 genuinely has none, and says so completely.
    const genuine = ratPolyRoots([ratFromNumber(1), ratFromNumber(0), ratFromNumber(1)]);
    expect({ n: genuine.roots.length, incomplete: genuine.incomplete }).toEqual({
      n: 0,
      incomplete: false,
    });
    const capped = ratPolyRoots([H(), H1(), H()]);
    expect({ n: capped.roots.length, incomplete: capped.incomplete }).toEqual({
      n: 0,
      incomplete: true,
    });
  });
});
