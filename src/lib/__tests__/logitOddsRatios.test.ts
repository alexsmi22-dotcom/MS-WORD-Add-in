/**
 * Logit odds ratios (user decision 2026-10-28: lawyers and experts quote them): a table of exp(coefficient) with the
 * coefficient's own 95% bounds exponentiated and its p-value, an odds-ratio panel on a log axis, and the reading's
 * "multiplies the odds by about". Probit has none.
 */
import { fitLogit, fitProbit, fmtOddsRatio, logitProbitReport, oddsRatioRows, ODDS_RATIO_MAX } from "../logitProbit";
import { econLogitCalc, LOGIT_DEFAULT, LOGIT_SPEC_DEFAULT } from "../econCalcs";
import { readingProblems } from "../calcReading";
import { fmtFixed } from "../regTable";

const rows = LOGIT_DEFAULT.split("\n").slice(1).map((l) => l.split(" ").map(Number));
const y = rows.map((r) => r[0]);
const X = rows.map((r) => r.slice(1));
const names = ["GPA", "TUCE", "PSI"];
const read = (over: Record<string, string> = {}) => (k: string): string =>
  ({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes", ...over })[k] ?? "";

describe("logit odds ratios", () => {
  const m = fitLogit(y, X, names, { constant: true, se: "classical", depName: "grade" });

  test("each ratio is exp of the coefficient and its bounds; the constant is left out", () => {
    const or = oddsRatioRows(m)!;
    expect(or.map((r) => r.name)).toEqual(names);
    for (const r of or) {
      const t = m.terms.find((x) => x.name === r.name)!;
      expect(r.or).toBeCloseTo(Math.exp(t.coef), 12);
      expect(r.lo).toBeCloseTo(Math.exp(t.ciLo), 12);
      expect(r.hi).toBeCloseTo(Math.exp(t.ciHi), 12);
      expect(r.p).toBe(t.p);
      expect(r.lo).toBeLessThan(r.or);
      expect(r.or).toBeLessThan(r.hi);
    }
  });

  test("the report adds a five-column odds-ratio table for logit, none for probit", () => {
    const rep = logitProbitReport(m);
    const t = rep.tables.find((x) => x.label.startsWith("Odds ratios"))!;
    expect(t.rows[0]).toEqual(["Term", "Odds ratio", "95% CI low", "95% CI high", "p"]);
    expect(t.rows).toHaveLength(1 + names.length);
    // 4 significant figures since 2026-10-28 (bug test R5 MAJOR 3), not 4 decimals.
    expect(t.rows[1][1]).toBe(fmtOddsRatio(Math.exp(m.terms[0].coef)));
    expect(t.rows[1][1]).toBe("14.45");
    const p = fitProbit(y, X, names, { constant: true, se: "classical", depName: "grade" });
    expect(oddsRatioRows(p)).toBeUndefined();
    expect(logitProbitReport(p).tables.some((x) => x.label.startsWith("Odds ratios"))).toBe(false);
  });

  test("the calculator's reading quotes the table's odds ratio and keeps the rules", () => {
    const o = econLogitCalc(read());
    const t = o.tables!.find((x) => x.label.startsWith("Odds ratios"))!;
    const gpa = t.rows.find((r) => r[0] === "GPA")!;
    // Associational wording (bug test R5 BLOCKER 4), not "multiplies the odds".
    expect(o.reading).toContain(`goes with odds about ${gpa[1]} times as high`);
    expect(readingProblems(o.reading)).toEqual([]);
    expect(o.svg).toContain("Odds ratios, 95% CI (log scale)");
    const probit = econLogitCalc(read({ model: "probit" }));
    expect(probit.reading).not.toContain("odds");
    expect(probit.svg).not.toContain("Odds ratios");
  });

  test("a ratio too large to print leaves its ROW out, says so, and never refuses the model (R5 MAJOR 3)", () => {
    const big = { ...m, terms: m.terms.map((t, i) => (i === 0 ? { ...t, coef: 40, ciLo: 39, ciHi: 41 } : t)) };
    expect(Math.exp(41)).toBeGreaterThan(ODDS_RATIO_MAX);
    expect(oddsRatioRows(big)!.map((r) => r.name)).toEqual(["TUCE", "PSI"]);
    const rep = logitProbitReport(big);
    expect(rep.tables.find((x) => x.label.startsWith("Odds ratios"))!.rows.map((r) => r[0])).toEqual(["Term", "TUCE", "PSI"]);
    expect(rep.text).toContain("The odds-ratio table leaves out “GPA”");
    const all = { ...m, terms: m.terms.map((t) => (t.name === "Constant" ? t : { ...t, coef: 40, ciLo: 39, ciHi: 41 })) };
    expect(oddsRatioRows(all)).toBeUndefined();
    expect(logitProbitReport(all).tables.some((x) => x.label.startsWith("Odds ratios"))).toBe(false);
  });
});
