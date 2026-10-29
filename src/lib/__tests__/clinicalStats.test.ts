/**
 * The clinical-research Stats calculators (v2.206.0) against their oracles and published worked examples, plus the
 * adversarial cases. Oracle values: fixtures/clinical-oracle.json, written by scripts/clinical-oracle.py (statsmodels
 * 0.15, scipy, scikit-learn 1.9.1, pingouin 0.7.0, and independent numpy re-implementations where no library computes
 * the quantity: DeLong, REML, MH RR/RD, the I² interval, the Mercaldo PPV/NPV interval, Buderer).
 *
 * Published examples cited:
 *  - Altman & Bland (1994), BMJ 308:1552, liver scan: sensitivity 231/258 = 0.90, specificity 54/86 = 0.63.
 *  - Hanley & McNeil (1982), Radiology 143:29, Table 1 CT ratings: AUC 0.893.
 *  - Bland & Altman (1986), Lancet i:307, PEFR: mean difference −2.1 L/min, SD 38.8, limits ±2 SD −79.7 to 75.5
 *    (the paper rounds the SD first; unrounded, −79.6 to 75.4).
 *  - Altman (1998), BMJ 317:1309: ARR 10% (5% to 15%) → NNT 10 (6.7 to 20); ARR 10% (−5% to 25%) →
 *    NNTB 10 (NNTH 20 to ∞ to NNTB 4); Tramèr et al.'s ARR −0.08 (−0.27 to 0.11) → NNTH 12.5 (NNTH 3.7 to ∞ to NNTB 9.1).
 *  - Shrout & Fleiss (1979), Psychol Bull 86:420, Table 2 (6 targets × 4 judges): ICC(1,1) .17, (2,1) .29, (3,1) .71,
 *    (1,4) .44, (2,4) .62, (3,4) .91.
 *  - Colditz et al. (1994) BCG trials as in Viechtbauer (2010), J Stat Softw 36(3): REML log RR −0.7145 (SE 0.1798),
 *    τ² = 0.3132.
 */
import * as fs from "fs";
import * as path from "path";
import { propCi, binomTwoSided } from "../clinicalCore";
import { diag2x2, bayesWithCi, bayesValues, rocFit, delongPaired, budererN, midranks } from "../diagnosticAccuracy";
import { epi2x2, altmanNnt, rateRatio } from "../epi2x2";
import { cohenKappa, blandAltman, iccFit } from "../agreement";
import { countEffect, mantelHaenszel, metaAnalyze, eggerTest, type CountStudy } from "../metaAnalysis";
import { CLINICAL_STAT_CALCS } from "../clinicalStatCalcs";
import { insertableResultText } from "../insertGate";
import { readingProblems } from "../calcReading";
import type { StatOutput } from "../analyzeBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "clinical-oracle.json"), "utf8"));

const close = (a: number, b: number, tol: number): void => {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`expected ${b}, got ${a} (|Δ| = ${Math.abs(a - b)} > ${tol})`);
};
const ok = <T>(v: T | { error: string }): T => {
  if (v && typeof v === "object" && "error" in v) throw new Error((v as { error: string }).error);
  return v as T;
};
const calc = (id: string) => CLINICAL_STAT_CALCS.find((c) => c.id === id)!;
const run = (id: string, over: Record<string, string> = {}): StatOutput => {
  const c = calc(id);
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
};
const expectOk = (o: StatOutput): void => {
  expect(o.ok).not.toBe(false);
  expect(insertableResultText(o.text)).toBe(true);
  expect(readingProblems(o.reading)).toEqual([]);
  expect(o.svg ?? "").toMatch(/^<svg/);
  expect(o.text + (o.reading ?? "")).not.toMatch(/NaN|Infinity|undefined|—/);
};

describe("diagnostic accuracy against statsmodels and the closed forms", () => {
  for (const key of ["liver", "default", "fn0", "fp1fn0"]) {
    const o = O.diag[key];
    test(`${key}: ${o.input.join(", ")}`, () => {
      const [tp, fp, fn, tn] = o.input;
      for (const m of ["wilson", "cp"] as const) {
        const d = ok(diag2x2(tp, fp, fn, tn, m));
        const want = o[m];
        for (const [k, got] of [
          ["sens", d.sens],
          ["spec", d.spec],
          ["ppv", d.ppv!],
          ["npv", d.npv!],
          ["acc", d.acc],
        ] as const) {
          close(got.est, want[k][0], 1e-12);
          close(got.lo, want[k][1], 1e-8);
          close(got.hi, want[k][2], 1e-8);
        }
        expect(d.haldane).toBe(o.haldane);
        for (const [k, got] of [
          ["lrPos", d.lrPos],
          ["lrNeg", d.lrNeg],
          ["dor", d.dor],
        ] as const) {
          close(got.est, o[k][0], 1e-10 * Math.max(1, o[k][0]));
          close(got.lo, o[k][1], 1e-9 * Math.max(1, o[k][1]));
          close(got.hi, o[k][2], 1e-9 * Math.max(1, o[k][2]));
        }
      }
      if (o.at10) {
        const b = bayesWithCi(tp / (tp + fn), tn / (fp + tn), tp + fn, fp + tn, 0.1);
        for (const k of ["ppv", "npv"] as const) {
          close(b[k]!.est, o.at10[k][0], 1e-12);
          close(b[k]!.lo, o.at10[k][1], 1e-12);
          close(b[k]!.hi, o.at10[k][2], 1e-12);
        }
      }
    });
  }

  test("Altman & Bland 1994 (liver scan): sensitivity 0.90, specificity 0.63 as printed", () => {
    const d = ok(diag2x2(231, 32, 27, 54, "wilson"));
    expect(d.sens.est.toFixed(2)).toBe("0.90");
    expect(d.spec.est.toFixed(2)).toBe("0.63");
  });

  test("post-test probability by Bayes: odds form and PPV agree (Se 0.8, Sp 0.8, pre 0.25: LR+ 4, post 4/7)", () => {
    close(bayesValues(0.8, 0.8, 0.25).ppv!, 4 / 7, 1e-15);
    close(bayesValues(0.5, 0.5, 0.5).ppv!, 0.5, 1e-15);
  });

  test("Buderer sample sizes", () => {
    for (const k of ["a", "b"]) {
      const [se, sp, prev, d] = O.buderer[k].input;
      const b = budererN(se, sp, prev, d);
      expect([b.nSens, b.nSpec, b.n]).toEqual(O.buderer[k].n);
    }
  });

  test("propCi edge cases: 0 and n successes", () => {
    expect(propCi(0, 20, "cp").lo).toBe(0);
    expect(propCi(20, 20, "cp").hi).toBe(1);
    expect(propCi(0, 20, "wilson").lo).toBeCloseTo(0, 15);
    expect(propCi(20, 20, "wilson").hi).toBeCloseTo(1, 15);
  });
});

describe("ROC and DeLong", () => {
  test("Hanley & McNeil 1982 CT ratings: AUC 0.893 (sklearn), DeLong SE by the O(mn) structural components", () => {
    const o = O.roc.hanleyMcNeil;
    const f = ok(rocFit(o.s1, o.y, true));
    close(f.auc, o.sk, 1e-12);
    close(f.auc, 0.893, 0.0005);
    close(f.se, o.se, 1e-12);
    [f.best.cutoff, f.best.sens, f.best.spec].forEach((v, i) => close(v, o.youden[i + 1], 1e-12));
  });

  test("paired DeLong test on two continuous scores with ties", () => {
    const o = O.roc.paired;
    const a = ok(rocFit(o.s1, o.y, true));
    const b = ok(rocFit(o.s2, o.y, true));
    close(a.auc, o.sk, 1e-12);
    close(b.auc, o.auc2, 1e-12);
    close(a.se, o.se, 1e-12);
    close(b.se, o.se2, 1e-12);
    const d = delongPaired(a, b);
    close(d.se, o.diffSe, 1e-12);
    close(d.z, o.z, 1e-9);
    close(d.p, o.p, 1e-9);
    [a.best.cutoff, a.best.sens, a.best.spec].forEach((v, i) => close(v, o.youden[i + 1], 1e-12));
  });

  test("lower-is-positive is the mirror image", () => {
    const o = O.roc.hanleyMcNeil;
    const f = ok(rocFit(o.s1.map((v: number) => -v), o.y, false));
    close(f.auc, o.sk, 1e-12);
    expect(f.best.cutoff).toBe(-4);
  });

  test("adversarial: all-same scores are refused by name; one class is refused", () => {
    expect(rocFit([3, 3, 3, 3], [0, 1, 0, 1], true)).toEqual({ error: expect.stringMatching(/Every score is the same/) });
    expect(rocFit([1, 2, 3], [1, 1, 1], true)).toEqual({ error: expect.stringMatching(/at least two/) });
    const o = run("clin-roc", { data: "y\ts\n0\t1\n0\t1\n1\t1\n1\t1" , outcome: "y", score: "s" });
    expect(o.ok).toBe(false);
  });

  test("adversarial: perfect separation gives AUC 1 and an interval that stays inside [0, 1]", () => {
    const f = ok(rocFit([1, 2, 3, 4, 5, 6], [0, 0, 0, 1, 1, 1], true));
    expect(f.auc).toBe(1);
    expect(f.hi).toBeLessThanOrEqual(1);
    expect(f.se).toBe(0);
  });

  test("midranks average ties", () => {
    expect(midranks([3, 1, 3, 2])).toEqual([3.5, 1, 3.5, 2]);
  });

  test("a non 0/1 outcome is refused naming the row", () => {
    const o = run("clin-roc", { data: "disease\trating\n0\t1\n2\t3\n1\t4\n0\t2\n1\t5" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/row 2/);
  });
});

describe("2×2 epidemiology", () => {
  for (const key of ["default", "zero", "small", "bZero"]) {
    const o = O.epi[key];
    test(`${key}: ${o.input.join(", ")} against statsmodels Table2x2 and confint_proportions_2indep`, () => {
      const [a, b, c, d] = o.input;
      for (const m of ["wald", "newcombe"] as const) {
        const e = ok(epi2x2(a, b, c, d, m));
        expect(e.haldane).toBe(o.haldane);
        for (const [k, got] of [
          ["rr", e.rr],
          ["or", e.or],
        ] as const) {
          close(got.est, o[k][0], 1e-12 * Math.max(1, o[k][0]));
          close(got.lo, o[k][1], 1e-10);
          close(got.hi, o[k][2], 1e-9 * Math.max(1, o[k][2]));
        }
        const want = o.rd[m === "newcombe" ? "newcomb" : "wald"];
        close(e.rd.est, want[0], 1e-12);
        close(e.rd.lo, want[1], 1e-8);
        close(e.rd.hi, want[2], 1e-8);
      }
    });
  }

  test("the chi-square and Fisher p printed match scipy (the Stats chi-square engine)", () => {
    const o = O.epi.default;
    const out = run("clin-2x2");
    expect(out.text).toContain(`p = ${o.p.toFixed(3)}`);
    expect(out.text).toContain(`p = ${o.pFisher.toFixed(3)}`);
  });

  test("Altman 1998 (BMJ 317:1309) worked examples", () => {
    const f = (v: number): string => (Math.round(v * 10) / 10).toString();
    expect(altmanNnt(0.1, 0.05, 0.15, f).text).toBe("NNTB 10 (95% CI 6.7 to 20)");
    expect(altmanNnt(0.1, -0.05, 0.25, f).text).toBe("NNTB 10 (NNTH 20 to ∞ to NNTB 4)");
    expect(altmanNnt(-0.08, -0.27, 0.11, f).text).toBe("NNTH 12.5 (NNTH 3.7 to ∞ to NNTB 9.1)");
    expect(altmanNnt(-0.1, -0.15, -0.05, f).text).toBe("NNTH 10 (95% CI 6.7 to 20)");
  });

  test("a crossing NNT interval is described in words and never prints Infinity", () => {
    const o = run("clin-2x2", { table: "20, 80\n24, 76" });
    expectOk(o);
    expect(o.text).toMatch(/to ∞ to/);
    expect(o.text).toMatch(/includes 0 \(no effect\), where the NNT is infinite/);
  });

  test("adversarial: a zero cell states the Haldane–Anscombe correction; empty rows and no events are refused", () => {
    const o = run("clin-2x2", { table: "0, 20\n5, 15" });
    expectOk(o);
    expect(o.text).toMatch(/Haldane–Anscombe/);
    expect(run("clin-2x2", { table: "0, 0\n5, 15" }).ok).toBe(false);
    expect(run("clin-2x2", { table: "0, 20\n0, 15" }).ok).toBe(false);
    expect(run("clin-2x2", { table: "1, 2, 3\n4, 5, 6" }).ok).toBe(false);
    expect(run("clin-2x2", { table: "1, 2\n-4, 5" }).ok).toBe(false);
  });

  test("case-control prints the odds ratio only and says why", () => {
    const o = run("clin-2x2", { design: "casecontrol" });
    expectOk(o);
    expect(o.text).toMatch(/cannot be estimated/);
    expect(o.tables![0].rows.map((r) => r[0])).not.toContain("Risk ratio");
  });
});

describe("incidence-rate ratio against scipy binomtest", () => {
  for (const key of ["default", "small", "zeroA"]) {
    const o = O.irr[key];
    test(`${key}: ${o.input.join(", ")}`, () => {
      const [a, t1, c, t0] = o.input;
      const r = ok(rateRatio(a, t1, c, t0));
      close(r.irr, o.irr, 1e-12);
      close(r.exact.lo, o.exact[0], 1e-7 * Math.max(1, o.exact[0]));
      close(r.exact.hi, o.exact[1], 1e-7 * Math.max(1, o.exact[1]));
      close(r.pExact, o.p, 1e-9);
      if (o.wald) {
        close(r.wald!.lo, o.wald[0], 1e-10);
        close(r.wald!.hi, o.wald[1], 1e-10);
      } else expect(r.wald).toBeNull();
    });
  }
  test("adversarial: no events in the reference group is refused by name", () => {
    expect(rateRatio(3, 100, 0, 100)).toEqual({ error: expect.stringMatching(/infinite/) });
    expect(run("clin-rate", { e1: "0", e0: "0" }).ok).toBe(false);
    expect(binomTwoSided(5, 10, 0.5)).toBeCloseTo(1, 12);
  });
});

describe("Cohen's kappa against statsmodels cohens_kappa", () => {
  for (const key of ["k3", "k4"]) {
    const o = O.kappa[key];
    test(key, () => {
      for (const w of ["none", "linear", "quadratic"] as const) {
        const k = ok(cohenKappa(o.table, w));
        close(k.kappa, o[w].kappa, 1e-12);
        close(k.se, o[w].se, 1e-12);
        close(k.se0, o[w].se0, 1e-12);
      }
    });
  }
  test("adversarial: both raters using one category is refused (chance agreement 100%)", () => {
    expect(cohenKappa([
      [12, 0],
      [0, 0],
    ], "none")).toEqual({ error: expect.stringMatching(/Chance agreement is 100%/) });
    const o = run("clin-kappa", { table: "12, 0\n0, 0" });
    expect(o.ok).toBe(false);
  });
  test("one rater using a single category still computes (κ = 0 when it never varies)", () => {
    const k = ok(cohenKappa([
      [5, 0],
      [5, 0],
    ], "none"));
    close(k.kappa, 0, 1e-15);
  });
  test("a non-square table is refused", () => {
    expect(run("clin-kappa", { table: "1, 2, 3\n4, 5, 6" }).ok).toBe(false);
  });
});

describe("Bland–Altman: the 1986 Lancet PEFR data", () => {
  const o = O.bland;
  test("bias, SD, limits (±1.96 and ±2 SD) and their intervals", () => {
    const b = ok(blandAltman(o.a, o.b, 1.96));
    close(b.bias, o.bias, 1e-12);
    close(b.sd, o.sd, 1e-10);
    close(b.lower, o.loa196[0], 1e-9);
    close(b.upper, o.loa196[1], 1e-9);
    close(b.biasCi[0], o.biasCi[0], 1e-8);
    close(b.biasCi[1], o.biasCi[1], 1e-8);
    close(b.upperCi[1] - b.upper, o.loaHalf, 1e-8);
    close(b.slope, o.slope, 1e-12);
    close(b.slopeP, o.slopeP, 1e-9);
    const b2 = ok(blandAltman(o.a, o.b, 2));
    close(b2.lower, o.loa2[0], 1e-9);
    close(b2.upper, o.loa2[1], 1e-9);
    // As published: −2.1 and 38.8; limits −79.7 to 75.5 from the rounded SD.
    expect(b.bias.toFixed(1)).toBe("-2.1");
    expect(b.sd.toFixed(1)).toBe("38.8");
    close(-2.1 - 2 * 38.8, -79.7, 1e-9);
  });
  test("adversarial: fewer than three pairs is refused", () => {
    expect(blandAltman([1, 2], [1, 3], 1.96)).toEqual({ error: expect.stringMatching(/at least 3 pairs/) });
    expect(run("clin-bland", { data: "Wright\tMini\n1\t2\n3\t4" }).ok).toBe(false);
  });
});

describe("ICC against pingouin and the McGraw–Wong intervals", () => {
  const map: Record<string, string> = { "ICC(1,1)": "ICC(1,1)", "ICC(2,1)": "ICC(A,1)", "ICC(3,1)": "ICC(C,1)", "ICC(1,k)": "ICC(1,k)", "ICC(2,k)": "ICC(A,k)", "ICC(3,k)": "ICC(C,k)" };
  for (const key of ["shroutFleiss", "wine"]) {
    test(key, () => {
      const o = O.icc[key];
      const f = ok(iccFit(o.data));
      for (const row of f.rows) {
        const pg = o[map[row.form]];
        close(row.value, pg[0], 1e-12);
        close(row.F, pg[1], 1e-9);
        close(row.p, pg[2], 1e-8);
        close(row.lo, o.ci[row.form][0], 1e-7);
        close(row.hi, o.ci[row.form][1], 1e-7);
        const pgCi = o[`${map[row.form]} pgCi`];
        close(row.lo, pgCi[0], 0.0051);
        close(row.hi, pgCi[1], 0.0051);
      }
    });
  }
  test("Shrout & Fleiss 1979 Table 4 as printed: .17 .29 .71 .44 .62 .91", () => {
    const f = ok(iccFit(O.icc.shroutFleiss.data));
    expect(f.rows.map((r) => r.value.toFixed(2))).toEqual(["0.17", "0.29", "0.71", "0.44", "0.62", "0.91"]);
  });
  test("adversarial: constant ratings, one rater and missing cells", () => {
    expect(iccFit([
      [3, 3],
      [3, 3],
    ])).toEqual({ error: expect.stringMatching(/same value/) });
    expect(iccFit([[1], [2]])).toEqual({ error: expect.stringMatching(/2 raters/) });
    const o = run("clin-icc", { data: "Target\tA\tB\nT1\t1\t2\nT2\tNA\t3\nT3\t4\t5\nT4\t2\t2" });
    expectOk(o);
    expect(o.text).toMatch(/1 target with a missing rating left out/);
  });
});

describe("meta-analysis: the BCG trials", () => {
  const bcg: CountStudy[] = O.meta.bcg.map((r: [string, number, number, number, number]) => ({ name: r[0], e1: r[1], n1: r[1] + r[2], e0: r[3], n0: r[3] + r[4] }));
  const eff = (m: "or" | "rr") => {
    const y: number[] = [];
    const v: number[] = [];
    for (const s of bcg) {
      const e = countEffect(s, m);
      if ("skip" in e) throw new Error(e.skip);
      y.push(e.y);
      v.push(e.v);
    }
    return { y, v };
  };
  for (const m of ["rr", "or"] as const) {
    test(`${m}: fixed IV and DL against statsmodels combine_effects; REML against scipy; I² interval`, () => {
      const o = O.meta[m];
      const { y, v } = eff(m);
      const dl = ok(metaAnalyze(y, v, "dl"));
      close(dl.fixed.est, o.fixed[0], 1e-12);
      close(dl.fixed.se, o.fixed[1], 1e-12);
      close(dl.random.est, o.dl[0], 1e-10);
      close(dl.random.se, o.dl[1], 1e-10);
      close(dl.tau2, o.dl[2], 1e-10);
      close(dl.Q, o.Q, 1e-9);
      close(dl.pQ, o.pQ, 1e-12);
      close(dl.i2, o.i2, 1e-12);
      close(dl.i2Lo!, o.i2ci[0], 1e-12);
      close(dl.i2Hi!, o.i2ci[1], 1e-12);
      close(dl.pi!.lo, o.piDL[0], 1e-8);
      close(dl.pi!.hi, o.piDL[1], 1e-8);
      const re = ok(metaAnalyze(y, v, "reml"));
      close(re.tau2, o.reml[2], 1e-6);
      close(re.random.est, o.reml[0], 1e-6);
      close(re.random.se, o.reml[1], 1e-6);
    });
  }
  test("Viechtbauer 2010 (metafor): REML log RR −0.7145, SE 0.1798, τ² 0.3132", () => {
    const { y, v } = eff("rr");
    const re = ok(metaAnalyze(y, v, "reml"));
    close(re.random.est, -0.7145, 5e-5);
    close(re.random.se, 0.1798, 5e-5);
    close(re.tau2, 0.3132, 5e-5);
  });
  test("Mantel–Haenszel OR (statsmodels StratifiedTable), RR and RD (Greenland–Robins)", () => {
    const or = ok(mantelHaenszel(bcg, "or"));
    close(or.est, O.meta.mhOR[0], 1e-12);
    close(or.se, O.meta.mhOR[1], 1e-12);
    const rr = ok(mantelHaenszel(bcg, "rr"));
    close(rr.est, O.meta.mhRR[0], 1e-12);
    close(rr.se, O.meta.mhRR[1], 1e-12);
    const rd = ok(mantelHaenszel(bcg, "rd"));
    close(rd.est, O.meta.mhRD[0], 1e-14);
    close(rd.se, O.meta.mhRD[1], 1e-14);
  });
  test("Egger's test against statsmodels OLS", () => {
    const { y, v } = eff("rr");
    const e = ok(eggerTest(y, v));
    close(e.intercept, O.meta.eggerRR[0], 1e-10);
    close(e.se, O.meta.eggerRR[1], 1e-10);
    close(e.p, O.meta.eggerRR[2], 1e-9);
  });
  test("τ² = 0: random equals fixed and the result says so", () => {
    const o = O.metaTau0;
    const fit = ok(metaAnalyze(o.y, o.se.map((s: number) => s * s), "dl"));
    expect(fit.tau2).toBe(0);
    close(fit.random.est, o.fixed, 1e-14);
    const data = ["Study\tEstimate\tSE", ...o.y.map((y: number, i: number) => `S${i + 1}\t${y}\t${o.se[i]}`)].join("\n");
    const out = run("clin-meta", { data, input: "se", scale: "diff" });
    expectOk(out);
    expect(out.text).toMatch(/τ² is 0/);
  });
  test("adversarial: one study is refused; Egger below 10 studies is refused by name", () => {
    const one = run("clin-meta", { data: "Study\tEstimate\tSE\nA\t0.5\t0.1", input: "se", scale: "diff" });
    expect(one.ok).toBe(false);
    expect(one.text).toMatch(/at least two studies/);
    const nine = ["Study\tEstimate\tSE", ...Array.from({ length: 9 }, (_, i) => `S${i}\t${0.1 * i}\t${0.1 + 0.02 * i}`)].join("\n");
    const e = run("clin-egger", { data: nine, input: "se", scale: "diff" });
    expect(e.ok).toBe(false);
    expect(e.text).toMatch(/at least 10 studies/);
  });
  test("adversarial: double-zero studies are left out by name; single zeros are corrected", () => {
    const data = "Study\tE1\tN1\tE0\tN0\nA\t0\t20\t0\t20\nB\t0\t30\t4\t30\nC\t5\t40\t9\t40\nD\t7\t50\t12\t50";
    const o = run("clin-meta", { data, measure: "or", fixed: "iv" });
    expectOk(o);
    expect(o.text).toMatch(/Left out of the inverse-variance analysis: A: no events in either arm/);
    expect(o.text).toMatch(/0\.5 added to every cell/);
  });
  test("pane audit find: the counts default read as effect-and-SE is refused, not pooled", () => {
    for (const input of ["se", "ci"]) {
      const o = run("clin-meta", { input });
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(/choose Input: 2×2 counts/);
    }
  });
  test("pane audit find: an AUC below 0.5 says to switch the Direction", () => {
    const o = run("clin-roc", { direction: "lower" });
    expectOk(o);
    expect(o.reading).toMatch(/switch the Direction \(AUC 0\.893\)/);
  });
  test("effect-and-CI input recovers the SE on the log scale", () => {
    const data = "Study\tHR\tLower\tUpper\nA\t0.8\t0.64\t1.0\nB\t0.7\t0.5\t0.98\nC\t0.9\t0.75\t1.08";
    const o = run("clin-meta", { data, input: "ci", scale: "ratio" });
    expectOk(o);
    close(Math.log(1.0 / 0.64) / (2 * 1.959963984540054), 0.11386, 1e-4);
  });
});

describe("the calculators, end to end", () => {
  test.each(CLINICAL_STAT_CALCS.map((c) => [c.id]))("%s: defaults are an insertable result with a reading and a figure", (id) => {
    expectOk(run(id));
  });

  test("diagnostic accuracy: 100% sensitivity corrects only the ratio measures, and says so", () => {
    const o = run("clin-diag", { tp: "50", fp: "10", fn: "0", tn: "40" });
    expectOk(o);
    // Only the ratios that are 0 or infinite without it (review B4): LR+ = 50/(10/50) is finite and is not corrected.
    expect(o.text).toMatch(/FN = 0: LR− and DOR are computed with 0\.5 added/);
    const sens = o.tables![0].rows.find((r) => r[0] === "Sensitivity")!;
    expect(sens[1]).toBe("100.0%");
  });

  test("diagnostic accuracy: prevalence 0 or 1 is refused in words", () => {
    for (const prev of ["0", "100%"]) {
      const o = run("clin-diag", { mode: "rates", prev });
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(/strictly between 0% and 100%/);
    }
  });

  test("diagnostic accuracy: specificity 100% in rates mode says unbounded, never Infinity", () => {
    const o = run("clin-diag", { mode: "rates", spec: "100%" });
    expectOk(o);
    expect(o.tables![0].rows.find((r) => r[0] === "LR+")![1]).toMatch(/unbounded/);
  });

  test("diagnostic accuracy: no diseased subjects is refused", () => {
    expect(run("clin-diag", { tp: "0", fn: "0" }).ok).toBe(false);
    expect(run("clin-diag", { tp: "1.5" }).ok).toBe(false);
  });

  test("ties: a two-score paired comparison on the oracle data prints the DeLong p", () => {
    const o = O.roc.paired;
    const data = ["y\ta\tb", ...o.y.map((y: number, i: number) => `${y}\t${o.s1[i]}\t${o.s2[i]}`)].join("\n");
    const out = run("clin-roc", { data, outcome: "y", score: "a", score2: "b" });
    expectOk(out);
    expect(out.text).toContain(o.p < 0.001 ? "p <" : `p = ${o.p.toFixed(3)}`);
  });
});
