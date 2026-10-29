/**
 * Regression tests for the independent review of the medical section (v2.206.0, review of medical @ c6144d6): one test
 * per finding, each with the reviewer's own repro. BLOCKER 1–5, MAJOR 1–10, then the MINOR groups. Oracle values for
 * the new cases (B1 large-count binomial test, B4 per-ratio Haldane, B5 Mantel–Haenszel RD) are in
 * fixtures/clinical-oracle.json, written by scripts/clinical-oracle.py (scipy binomtest, statsmodels Table2x2 with
 * shift_zeros off, and the Greenland–Robins formulas in numpy).
 */
import * as fs from "fs";
import * as path from "path";
import { CLINICAL_STAT_CALCS } from "../clinicalStatCalcs";
import { DOSING_CALCS } from "../dosingCalcs";
import { binomTwoSided } from "../clinicalCore";
import { diag2x2 } from "../diagnosticAccuracy";
import { epi2x2 } from "../epi2x2";
import { mantelHaenszel, type CountStudy } from "../metaAnalysis";
import { ckdEpiCr2021 } from "../dosing";
import { insertableResultText } from "../insertGate";
import { readingProblems } from "../calcReading";
import type { StatOutput, AnalyzeOutput } from "../analyzeBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "clinical-oracle.json"), "utf8"));

const runS = (id: string, over: Record<string, string> = {}): StatOutput => {
  const c = CLINICAL_STAT_CALCS.find((x) => x.id === id)!;
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
};
const runD = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = DOSING_CALCS.find((x) => x.id === id)!;
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
};
const okS = (o: StatOutput): StatOutput => {
  expect(o.ok).not.toBe(false);
  expect(insertableResultText(o.text)).toBe(true);
  expect(readingProblems(o.reading)).toEqual([]);
  return o;
};
const cell = (o: StatOutput, name: string, col = 1): string => o.tables![0].rows.find((r) => r[0] === name)![col];
const plotSvg = (o: AnalyzeOutput): string => (o.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg).join("");

describe("BLOCKER", () => {
  test("1. clin-rate on large counts finishes (it hung: the exact test looped over all a + c)", () => {
    for (const [e1, e0, t] of [
      ["5000000", "4000000", "1e9"],
      ["20000000", "16000000", "1e10"],
      ["900000000", "800000000", "1e12"],
    ]) {
      const t0 = Date.now();
      const o = runS("clin-rate", { e1, e0, t1: t, t0: t });
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(o.ok).not.toBe(false);
      expect(o.text).toMatch(/p <.0\.001/u);
    }
    for (const c of O.binomLarge) expect(Math.abs(binomTwoSided(c.x, c.n, c.p0) - c.p)).toBeLessThan(1e-9);
  });

  test("2. rates input: Se 80%, Sp 0% gives 100% after a negative (1 − NPV), not 0%; Se 0%, Sp 100% has no post-test after a positive", () => {
    const a = okS(runS("clin-diag", { mode: "rates", sens: "80%", spec: "0%", prev: "10%" }));
    expect(cell(a, "NPV")).toBe("0.0%");
    expect(cell(a, "Post-test probability after a negative")).toBe("100.0%");
    const b = okS(runS("clin-diag", { mode: "rates", sens: "0%", spec: "100%", prev: "10%" }));
    expect(cell(b, "PPV")).toMatch(/not defined/);
    expect(cell(b, "Post-test probability after a positive")).toMatch(/not defined/);
    expect(cell(b, "LR+")).toMatch(/not defined \(0\/0/);
  });

  test("3. Bland–Altman: constant differences are not proportional bias", () => {
    for (const data of ["A\tB\n1\t2\n2\t3\n3\t4\n4\t5", "A\tB\n1.1\t2.2\n2.1\t3.2\n3.1\t4.2\n4.1\t5.2", "A\tB\n10\t10\n20\t20\n30\t30\n40\t40"]) {
      const o = okS(runS("clin-bland", { data, a: "A", b: "B" }));
      expect(o.text + o.reading).not.toMatch(/proportional bias, p/);
      expect(o.text).toMatch(/not testable/);
    }
  });

  test("4. Haldane only on ratios that are 0 or infinite: LR+ 61 for TP 50, FP 1, FN 0, TN 60; RR 2.00 for 10, 0 / 5, 5", () => {
    const d = diag2x2(50, 1, 0, 60, "wilson");
    if ("error" in d) throw new Error(d.error);
    expect(d.lrPos.est).toBeCloseTo(61, 12);
    expect(d.corrected).toEqual(["LR−", "DOR"]);
    for (const k of ["lrPos", "lrNeg", "dor"] as const) for (let i = 0; i < 3; i++) {
      const got = [d[k].est, d[k].lo, d[k].hi][i];
      expect(Math.abs(got / O.diag.fp1fn0[k][i] - 1)).toBeLessThan(1e-9);
    }
    const o = okS(runS("clin-diag", { tp: "50", fp: "1", fn: "0", tn: "60", pretest: "2%" }));
    expect(cell(o, "LR+")).toBe("61.00");
    expect(cell(o, "Post-test probability after a positive")).toBe("55.5%");
    const e = epi2x2(10, 0, 5, 5, "newcombe");
    if ("error" in e) throw new Error(e.error);
    expect(e.rr.est).toBe(2);
    expect([e.rr.lo, e.rr.hi].map((v, i) => Math.abs(v / O.epi.bZero.rr[i + 1] - 1) < 1e-9)).toEqual([true, true]);
    expect(e.or.est).toBeCloseTo(O.epi.bZero.or[0], 10);
    const t = okS(runS("clin-2x2", { table: "10, 0\n5, 5" }));
    expect(cell(t, "Risk ratio")).toBe("2.00");
    expect(cell(t, "RRR (1 − RR)")).toBe("−100.0%");
    expect(t.text).toMatch(/the odds ratio is computed with 0\.5 added.*The risk ratio is finite as it stands/);
  });

  test("5. Mantel–Haenszel RD keeps all-or-none and double-zero studies (+0.013, not −0.180)", () => {
    const st: CountStudy[] = O.mhRdAllOrNone.studies.map(([e1, n1, e0, n0]: number[], i: number) => ({ name: `S${i}`, e1, n1, e0, n0 }));
    const mh = mantelHaenszel(st, "rd");
    if ("error" in mh) throw new Error(mh.error);
    expect(mh.est).toBeCloseTo(O.mhRdAllOrNone.mh[0], 14);
    expect(mh.se).toBeCloseTo(O.mhRdAllOrNone.mh[1], 14);
    const data = ["Study\tE1\tN1\tE0\tN0", ...O.mhRdAllOrNone.studies.map((r: number[], i: number) => `S${i}\t${r.join("\t")}`)].join("\n");
    const o = okS(runS("clin-meta", { data, measure: "rd", fixed: "mh" }));
    expect(o.text).toMatch(/Fixed effect \(Mantel–Haenszel\): 1\.3%/);
    expect(o.text).toMatch(/Mantel–Haenszel keeps it/);
  });
});

describe("MAJOR", () => {
  test("1. the category follows the number shown: BMI 25.0 is pre-obese; eGFR shown as 90 is G1", () => {
    expect(runD("med-bsa", { w: "76.56", h: "175" }).text.split("\n")[0]).toMatch(/BMI 25\.0 kg\/m², WHO adult category pre-obese/);
    expect(ckdEpiCr2021(1.0185, 50, "male")).toBeLessThan(90);
    expect(runD("med-egfr", { age: "50", sex: "male", scr: "1.0185", cys: "" }).text.split("\n")[0]).toMatch(/eGFR 90 .*G1 \(90 or more\)/);
  });

  test("2. ROC cutoffs are the observed scores, exactly", () => {
    const o = okS(runS("clin-roc", { data: "y\ts\n1\t0.123451\n1\t0.123452\n0\t0.123449\n0\t0.123452\n1\t0.2\n0\t0.1", outcome: "y", score: "s" }));
    const cuts = o.tables![1].rows.slice(1).map((r) => r[0]);
    expect(cuts).toEqual(["≥ 0.2", "≥ 0.123452", "≥ 0.123451", "≥ 0.123449", "≥ 0.1"]);
  });

  test("3. kappa's interval is clipped to [−1, 1] and says so", () => {
    const o = okS(runS("clin-kappa", { table: "20 1\n0 20", categories: "" }));
    const ci = cell(o, "κ (unweighted)", 2);
    expect(ci).toMatch(/ to 1\.000$/);
    expect(o.text).toMatch(/clipped to κ's range/);
  });

  test("4. no band label when the interval spans bands (AUC, kappa, ICC)", () => {
    expect(okS(runS("clin-roc", { data: "y\ts\n1\t3\n1\t5\n0\t4\n0\t1\n1\t6\n0\t2", outcome: "y", score: "s" })).reading).toMatch(/too wide to classify/);
    expect(okS(runS("clin-kappa", { table: "3 1\n0 3", categories: "" })).reading).toMatch(/too wide to classify/);
    expect(okS(runS("clin-icc", { data: "A\tB\n1\t2\n3\t3\n2\t4" })).reading).toMatch(/too wide to classify/);
    // A narrow interval keeps its word.
    expect(runS("clin-roc").reading).toMatch(/excellent to outstanding/);
  });

  test("5. 2×2: an RR interval excluding 1 beside Fisher p > 0.05 is called a disagreement", () => {
    const o = okS(runS("clin-2x2", { table: "8 22\n16 14" }));
    expect(o.reading).toMatch(/methods disagree/);
    expect(o.reading).not.toMatch(/could be chance/);
  });

  test("6. the verb follows the direction: with LR+ < 1 a positive result lowers the probability", () => {
    const o = okS(runS("clin-diag", { mode: "rates", sens: "80%", spec: "0%", prev: "10%" }));
    expect(o.reading).toMatch(/a positive result lowers it to/);
    expect(o.reading).toMatch(/a negative result raises it to 100\.0%/);
  });

  test("7. ordinary input is read: 28,010 person-years, grouped counts", () => {
    expect(okS(runS("clin-rate", { t1: "28,010" })).text).toMatch(/28,010 person-years/);
    expect(cell(okS(runS("clin-2x2", { table: "1,500, 8,500\n3,000, 7,000" })), "Risk ratio")).toBe("0.50");
    expect(okS(runS("clin-kappa", { table: "1,200 30\n40 900", categories: "" })).text).toMatch(/2,170 subjects/);
    expect(cell(okS(runS("clin-2x2", { table: "15,85\n30,70" })), "Risk ratio")).toBe("0.50");
  });

  test("8. dosing unit mistakes are caught by the BMI window and the creatinine floor", () => {
    expect(runD("med-bsa", { w: "70", h: "69" }).text).toMatch(/outside the 10 to 80.*looks like inches: 69 in = 175\.3 cm/);
    expect(runD("med-bsa", { w: "400", h: "30" }).ok).toBe(false);
    expect(runD("med-bsa", { w: "0.3", h: "260" }).ok).toBe(false);
    const w = runD("med-weights", { w: "154", wu: "kg" });
    expect(w.ok).not.toBe(false);
    expect(w.text).toMatch(/if the weight was meant in pounds, choose lb \(154 lb = 69\.85 kg\)/);
    const c = runD("med-crcl", { scr: "15", su: "umol" });
    expect(c.ok).toBe(false);
    expect(c.text).toMatch(/below 20 µmol\/L/);
  });

  test("9. the Fagan line passes through its own LR and is clipped at the frame when the post-test is off the scale", () => {
    const o = okS(runS("clin-diag", { tp: "50", fp: "1", fn: "0", tn: "60", pretest: "2%" }));
    const svg = o.svg!;
    const W = Number(/width="([\d.]+)"/.exec(svg)![1]);
    const H = Number(/height="([\d.]+)"/.exec(svg)![1]);
    const m = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1d4ed8"/.exec(svg)!;
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    const top = 46;
    const bot = H - (22 + 15 * 2 + 14);
    const L = Math.log(0.999 / 0.001);
    const yOf = (u: number): number => top + ((L - u) / (2 * L)) * (bot - top);
    // At the LR scale (x = W/2) the line is at ln(61)/2.
    const yMid = y1 + ((y2 - y1) * (W * 0.5 - x1)) / (x2 - x1);
    expect(Math.abs(yMid - yOf(Math.log(61) / 2))).toBeLessThan(0.15);
    // The negative line (LR− = 0) has no line; the key says so.
    expect(svg).not.toMatch(/<line x1="84\.0"[^>]*stroke="#b91c1c"/);
    expect(svg).toMatch(/unbounded or undefined LR has no line/);
    // An on-scale post-test lands on the right axis.
    const d = okS(runS("clin-diag")).svg!;
    const m2 = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1d4ed8"/.exec(d)!;
    expect(Number(m2[3])).toBeCloseTo(Number(/width="([\d.]+)"/.exec(d)![1]) * 0.8, 1);
  });

  test("10. descriptive wording and exact echoes", () => {
    const d = runD("med-dose", { per: "176.35", w: "70", conc: "" }).text.split("\n")[0];
    expect(d).toMatch(/Dose 12344\.5 mg \(176\.35 mg\/kg × 70 kg\)/);
    const i = runD("med-infusion", { ru: "mgh", rate: "1234", amt: "1000", vol: "1000" }).text;
    expect(i).toMatch(/1234 mg\/h/);
    expect(i).not.toMatch(/Run the pump/);
    expect(runD("med-infusion").text.split("\n")[0]).toMatch(/^A dose rate of 5 µg\/kg\/min for 70 kg corresponds to a pump rate of 13\.13 mL\/h/);
  });
});

describe("MINOR", () => {
  test("no doubled \"(log scale)\" on the ratio forests", () => {
    for (const [id, over] of [["clin-2x2", {}], ["clin-rate", {}], ["clin-meta", {}]] as const) expect(runS(id, over).svg).not.toMatch(/log scale\)[^<]*\(log scale/);
  });
  test("legends keep their numbers (no truncation ellipsis)", () => {
    expect(runS("clin-egger").svg).not.toMatch(/…/);
    for (const [id, over] of [["med-dose", { cap: "800" }], ["med-egfr", {}], ["med-infusion", {}], ["med-labunits", {}]] as const) expect(plotSvg(runD(id, over))).not.toMatch(/…/);
  });
  test("the funnel plot's limit curves are not counted as points outside the axes", () => {
    expect(runS("clin-egger").svg).not.toMatch(/outside the axis/);
  });
  test("number display", () => {
    expect(okS(runS("clin-rate", { e1: "3", t1: "2.5", e0: "2", t0: "4.4" })).text).toMatch(/in 2\.5 person-years/);
    const rd = cell(okS(runS("clin-rate")), "Rate difference (per 1,000 person-years)", 1);
    const rdCi = cell(okS(runS("clin-rate")), "Rate difference (per 1,000 person-years)", 2);
    const dec = (t: string): number => (t.split(".")[1] ?? "").length;
    expect(rdCi.split(" to ").map(dec)).toEqual([dec(rd), dec(rd)]);
    const lr = okS(runS("clin-diag", { tp: "1000", fn: "1", fp: "300", tn: "700" }));
    const lrNeg = lr.tables![0].rows.find((r) => r[0] === "LR−")!;
    expect(new Set([lrNeg[1], ...lrNeg[2].split(" to ")].map(dec)).size).toBe(1);
    expect(lrNeg.join(" ")).not.toMatch(/×10/);
    const z = okS(runS("clin-bland", { data: "A\tB\n1\t1\n2\t2\n3\t3", a: "A", b: "B" }));
    expect(z.text + z.reading).not.toMatch(/0\.000000/);
    expect(z.reading).toMatch(/agree on average/);
    const k = okS(runS("clin-kappa", { table: "5 0\n0 5", categories: "" }));
    expect(cell(k, "κ (unweighted)", 2)).toMatch(/no interval/);
    expect(k.text).not.toMatch(/1\.000 to 1\.000/);
    expect(okS(runS("clin-meta", { measure: "rd" })).text).toMatch(/Random effects \(DerSimonian–Laird τ²\): −?\d+\.\d%/);
  });
  test("Buderer: the halves add up and the count is rounded up", () => {
    const o = okS(runS("clin-dta-n"));
    expect(o.text).toMatch(/692 subjects: at 20\.0% prevalence, 139 with the condition .* and 553 without/);
  });
  test("Egger does not claim limited power with 400 studies", () => {
    let s = 5;
    const r = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const m = ["Study\tE1\tN1\tE0\tN0"];
    for (let i = 0; i < 400; i++) m.push(`S${i}\t${10 + Math.floor(r() * 20)}\t200\t${10 + Math.floor(r() * 20)}\t200`);
    const o = okS(runS("clin-egger", { data: m.join("\n") }));
    expect(o.reading).not.toMatch(/limited power/);
  });
  test("input prompts: a bare 0.5 or 1 in a probability field says how it was read", () => {
    expect(okS(runS("clin-diag", { mode: "rates", prev: "0.5" })).text).toMatch(/Read as proportions .*: prevalence 0\.5 = 50\.0%/);
    expect(runS("clin-dta-n", { prev: "1" }).text).toMatch(/1 = 100%\); type 1% for one percent/);
    expect(okS(runS("clin-2x2", { table: "Event\tNo event\n15\t85\n30\t70" })).text).toMatch(/15\/100 = 15\.0%/);
  });
  test("input prompts: feet, 0e0, mg/h without a weight", () => {
    expect(runD("med-bsa", { h: "5.75" }).text).toMatch(/looks like feet \(5\.75 ft = 175\.3 cm/);
    expect(runD("med-bsa", { w: "0e0" }).text).not.toMatch(/out of range/);
    const i = runD("med-infusion", { ru: "mgh", rate: "10", w: "" });
    expect(i.ok).not.toBe(false);
    expect(i.text.split("\n")[0]).toMatch(/10 mg\/h corresponds to a pump rate/);
  });
});
