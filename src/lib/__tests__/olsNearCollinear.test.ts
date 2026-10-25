/**
 * OLS at high condition numbers (E2 fix round), against mpmath at 80 digits: fixtures/econ-ols-nearcollinear-oracle.json,
 * written by scripts/econ-ols-nearcollinear-oracle.py. p2 = p1 + η·noise with η chosen for a raw-design condition
 * number of 10⁶, 10⁸ and 10¹⁰ (n = 12 and 60), a no-constant design at 1.1×10⁹, and the two tables the adversarial
 * pass found (where the first build printed a robust F of 0.021 for an exact 2.652, and an intercept SE of 56.64 for
 * 12.74).
 *
 * Tolerance 10⁻⁶ relative everywhere. The fixture also records sens, the problem's own conditioning (the largest
 * relative change of any coefficient, SE or F when every data value moves by one unit in the last place, computed
 * exactly): about 10⁻⁶ at 10¹⁰, so no algorithm can PROMISE better there. Measured 2026-10-25, worst relative error
 * over every coefficient, SE and F of every SE type: 2×10⁻¹² (10⁶), 6×10⁻¹⁰ (10⁸), 5×10⁻⁸ (10¹⁰), 3×10⁻⁸ (no
 * constant), 3×10⁻¹¹ (the adversarial tables).
 */
import { fitOls, type SeType } from "../olsInference";
import oracle from "./fixtures/econ-ols-nearcollinear-oracle.json";

type Case = (typeof oracle.cases)[number];
const SE: SeType[] = ["classical", "hc0", "hc1", "hc2", "hc3", "cluster", "hac"];

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

describe("OLS matches exact (mpmath) values on near-collinear designs", () => {
  test("the oracle spans condition numbers 10⁶ to 10¹⁰ and includes the adversarial tables", () => {
    const conds = oracle.cases.map((c) => c.cond);
    expect(Math.min(...conds)).toBeLessThan(2e6);
    expect(Math.max(...conds)).toBeGreaterThan(9e9);
    expect(oracle.cases.filter((c) => c.name.startsWith("adversarial")).length).toBe(2);
  });
  for (const c of oracle.cases as Case[]) {
    for (const se of SE) {
      test(`${c.name}, ${se}`, () => {
        const r = fitOls({ y: c.y, depName: "y", X: c.X, names: c.names, constant: c.constant, se, clusters: c.clusters, clusterName: "g", hacLag: c.lag });
        if (!r.ok) throw new Error(r.reason);
        const ex = c.expected as unknown as Record<string, { se: number[]; F: number; df: number }> & { coef: number[] };
        const tol = 1e-6;
        const bad: string[] = [];
        r.model.terms.forEach((t, j) => {
          if (!(rel(t.coef, ex.coef[j]) <= tol)) bad.push(`coef ${t.name} ${t.coef} vs ${ex.coef[j]}`);
          if (!(rel(t.se, ex[se].se[j]) <= tol)) bad.push(`se ${t.name} ${t.se} vs ${ex[se].se[j]} (rel ${rel(t.se, ex[se].se[j]).toExponential(2)})`);
        });
        if (!r.f) bad.push(`no F: ${r.fWhy}`);
        else {
          if (!(rel(r.f.value, ex[se].F) <= tol)) bad.push(`F ${r.f.value} vs ${ex[se].F} (rel ${rel(r.f.value, ex[se].F).toExponential(2)})`);
          expect(r.f.df2).toBe(ex[se].df);
        }
        expect(bad).toEqual([]);
      });
    }
  }
});
