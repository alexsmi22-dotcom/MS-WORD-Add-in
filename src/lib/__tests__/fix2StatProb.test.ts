/**
 * Stats fix round 2 (reviewer S, findings2-S BLOCKER 1 and MAJOR 4): one rule for every reading that quotes a change
 * in a probability (lib/probChange.ts). Never a change of 1 or more; per one unit unless the per-unit change would be
 * impossible; never a rescaled 0/1 predictor; one step per sentence. Pinned to the reviewer's repros (S2\h.json,
 * S2\b.json): mlogit with income ÷ 1,000, tobit with educ ÷ 100, logit grade ~ PSI.
 */
import { readingProblems } from "../calcReading";
import { econLogitCalc, LOGIT_DEFAULT } from "../econCalcs";
import { econMlogitCalc, econTobitCalc } from "../limdepStatCalcs";
import { LIMDEP_MNL_DEFAULT, LIMDEP_TOBIT_DEFAULT } from "../limdepDefaults";
import { isBinaryColumn, probChangeStep } from "../probChange";
import { printedNumber } from "../pReading";

const rd = (o: Record<string, string>) => (k: string): string => o[k] ?? "";
const ok = (r: string | undefined): string => {
  expect(r).toBeDefined();
  expect(readingProblems(r)).toEqual([]);
  return r as string;
};
/** Divide one named column of a whitespace table by `f`. */
function scaleCol(table: string, col: string, f: number): string {
  const lines = table.split("\n");
  const head = lines[0].trim().split(/\s+/);
  const j = head.indexOf(col);
  return [lines[0], ...lines.slice(1).map((l) => l.trim().split(/\s+/).map((v, i) => (i === j && v !== "NA" ? String(Number(v) / f) : v)).join(" "))].join("\n");
}
/** Every "about N higher/lower" or "of about N in the probability" number in a reading that is a probability change. */
function probNumbers(r: string): number[] {
  const out: number[] = [];
  for (const m of r.matchAll(/(?:probability|chance)[^.;]*? about ([\d.,]+) (?:higher|lower|different)/g)) out.push(printedNumber(m[1]));
  for (const m of r.matchAll(/(?:rise|fall) of about ([\d.,]+) in the probability/g)) out.push(printedNumber(m[1]));
  return out;
}

describe("probChangeStep: the shared rule", () => {
  test("per one unit while the change prints below 1; rescaled only at 1 or more", () => {
    expect(probChangeStep(0.36)).toMatchObject({ step: 1, stepText: "1", scaledText: "0.3600", quotable: true, stepWords: "one-unit" });
    expect(probChangeStep(0.99994).step).toBe(1);
    // 0.99996 prints "1.0000": rescaled (0.099996 still prints 0.1000, so per 0.01)
    expect(probChangeStep(0.99996)).toMatchObject({ stepText: "0.01", scaledText: "0.0100" });
    expect(probChangeStep(-1.331)).toMatchObject({ stepText: "0.01", scaledText: "0.0133", stepWords: "0.01-unit" });
    expect(probChangeStep(5.2924)).toMatchObject({ stepText: "0.01", scaledText: "0.0529" });
    expect(probChangeStep(487).stepText).toBe("0.0001");
    expect(probChangeStep(3.2e9).stepText).toMatch(/×10⁻/);
    expect(printedNumber(probChangeStep(3.2e9).scaledText)).toBeLessThan(0.1);
  });
  test("a 0/1 predictor is never rescaled: below 1 per unit, at 1 or more not quotable", () => {
    expect(probChangeStep(0.25, { binary: true })).toMatchObject({ step: 1, quotable: true });
    expect(probChangeStep(1.4, { binary: true })).toMatchObject({ step: 1, quotable: false });
  });
  test("isBinaryColumn", () => {
    expect(isBinaryColumn([0, 1, 1, 0])).toBe(true);
    expect(isBinaryColumn([1, 1])).toBe(false);
    expect(isBinaryColumn([0, 1, 2])).toBe(false);
    expect(isBinaryColumn([0, 0.5, 1])).toBe(false);
  });
});

describe("BLOCKER 1: mlogit and tobit never print a probability change of 1 or more", () => {
  test("mlogit, income ÷ 1,000 (was 'about 5.2924 higher')", () => {
    const o = econMlogitCalc(rd({ data: scaleCol(LIMDEP_MNL_DEFAULT, "income", 1000), spec: "mode ~ income + age" }));
    const r = ok(o.reading);
    expect(r).not.toMatch(/5\.2924/);
    expect(r).toMatch(/^Each 0\.01-unit increase in income goes with a probability that mode = 2 about 0\.0529 higher/);
    expect(o.text).toContain("Per 0.01 of income: the average marginal effect 5.2924 × 0.01 = 0.0529 in P(mode = 2).");
    for (const v of probNumbers(r)) expect(v).toBeLessThan(1);
  });
  test("mlogit default: unchanged per one unit", () => {
    const o = econMlogitCalc(rd({ data: LIMDEP_MNL_DEFAULT, spec: "mode ~ income + age" }));
    expect(ok(o.reading)).toMatch(/^Each one-unit increase in income/);
    expect(o.text).not.toMatch(/^Per /m);
  });
  test("tobit, educ ÷ 100 (was 'chance … about 4.2686 higher')", () => {
    const o = econTobitCalc(rd({ data: scaleCol(LIMDEP_TOBIT_DEFAULT, "educ", 100), spec: "hours ~ educ + age + kids", lower: "0", constant: "yes" }));
    const r = ok(o.reading);
    expect(r).not.toMatch(/4\.2686/);
    expect(r).toMatch(/ Each 0\.01-unit increase in educ goes with a chance that hours is above 0 about 0\.0427 higher\.$/);
    expect(o.text).toContain("Per 0.01 of educ: the average marginal effect 4.2686 × 0.01 = 0.0427 in P(y > 0).");
    for (const v of probNumbers(r)) expect(v).toBeLessThan(1);
  });
  test("tobit default: the chance per one unit, no note", () => {
    const o = econTobitCalc(rd({ data: LIMDEP_TOBIT_DEFAULT, spec: "hours ~ educ + age + kids", lower: "0", constant: "yes" }));
    expect(ok(o.reading)).toMatch(/ It goes with a chance that hours is above 0 about 0\.\d{4} higher\.$/);
    expect(o.text).not.toMatch(/^Per /m);
  });
});

describe("MAJOR 4: econ-logit never rescales a 0/1 predictor, and one step per sentence", () => {
  test("grade ~ PSI: per one unit (was 'A 0.1-unit rise in PSI')", () => {
    const o = econLogitCalc(rd({ data: LOGIT_DEFAULT, spec: "grade ~ PSI", constant: "yes" }));
    const r = ok(o.reading);
    expect(r).not.toMatch(/0\.1-unit/);
    expect(r).toMatch(/^A one-unit rise in PSI goes with a rise of about 0\.2\d{3} in the probability that grade = 1/);
    expect(o.text).not.toMatch(/^Per /m);
  });
  test("probit grade ~ PSI + TUCE: per one unit", () => {
    const r = ok(econLogitCalc(rd({ data: LOGIT_DEFAULT, spec: "grade ~ PSI + TUCE", model: "probit", constant: "yes" })).reading);
    expect(r).not.toMatch(/0\.1-unit/);
  });
  test("a GPA in thousandths (÷ 1,000): rescaled, and no one-unit odds ratio in the same sentence", () => {
    const o = econLogitCalc(rd({ data: scaleCol(LOGIT_DEFAULT, "GPA", 1000), spec: "grade ~ GPA + TUCE + PSI", constant: "yes" }));
    const r = ok(o.reading);
    expect(r).toMatch(/^A 0\.0+1-unit rise in GPA/);
    expect(r).not.toMatch(/one-unit/);
    expect(r).not.toMatch(/odds about/);
    for (const v of probNumbers(r)) expect(v).toBeLessThan(0.1);
  });
});
