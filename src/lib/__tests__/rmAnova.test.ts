// Repeated-measures ANOVA — §D3 acceptance values (docs/SCOPE-STATS-BATCH.md).
//
// Oracles (recorded in the brief): pingouin 0.7.0 rm_anova/sphericity/epsilon/
// pairwise_tests/mixed_anova, SciPy f.sf, and a direct NumPy computation.
// Values marked "single oracle" in the brief are labelled so here. Never change
// an expected value to match the engine: a mismatch is a finding.

import { rmAnova, RmAnovaResult, RmAnovaOutcome } from "../rmAnova";
import { friedman } from "../nonparametric";

function ok(r: RmAnovaOutcome): RmAnovaResult {
  if (!r.ok) throw new Error("expected a result, got refusal: " + r.reason);
  return r;
}

// Field, Discovering Statistics Using SPSS (3rd ed.), ch. 13 — 8 participants × 4 animals.
const BUSH = [
  [8, 7, 1, 6],
  [9, 5, 2, 5],
  [6, 2, 3, 8],
  [5, 3, 1, 9],
  [8, 4, 5, 8],
  [7, 5, 6, 7],
  [10, 2, 7, 2],
  [12, 6, 8, 1],
];

const WELL = [
  [10, 12, 14],
  [9, 11, 15],
  [12, 13, 16],
  [8, 10, 13],
  [11, 14, 15],
  [10, 11, 14],
];

describe("§D3 bushtucker (one within factor, k = 4)", () => {
  const r = ok(rmAnova(BUSH));

  test("sums of squares", () => {
    expect(r.ss.conditions).toBeCloseTo(83.125, 9);
    expect(r.ss.subjects).toBeCloseTo(17.375, 9);
    expect(r.ss.error).toBeCloseTo(153.375, 9);
  });

  test("F(3, 21), p, partial η²", () => {
    expect(r.within.df1).toBe(3);
    expect(r.within.df2).toBe(21);
    expect(r.within.f).toBeCloseTo(3.793806, 5);
    expect(r.within.p).toBeCloseTo(0.0255703, 6);
    expect(r.within.partialEta2).toBeCloseTo(0.35148, 5);
  });

  test("Mauchly, R second-order form", () => {
    expect(r.mauchly.status).toBe("ok");
    if (r.mauchly.status !== "ok") return;
    expect(r.mauchly.W).toBeCloseTo(0.136248, 5);
    expect(r.mauchly.chi2).toBeCloseTo(11.405981, 5);
    expect(r.mauchly.df).toBe(5);
    expect(r.mauchly.p).toBeCloseTo(0.0468458, 6);
    // and NOT the plain χ² (0.0438990) or Anderson's k − 1 variant (0.0467733)
    expect(Math.abs(r.mauchly.p - 0.043899)).toBeGreaterThan(0.002);
    expect(Math.abs(r.mauchly.p - 0.0467733)).toBeGreaterThan(0.00005);
  });

  test("ε: GG, HF (one group: original = Lecoutre), lower bound", () => {
    expect(r.epsilon.gg).toBeCloseTo(0.532846, 5);
    expect(r.epsilon.hfRaw as number).toBeCloseTo(0.665764, 5);
    expect(r.epsilon.hfOriginalRaw as number).toBeCloseTo(0.665764, 5);
    expect(r.epsilon.lowerBound).toBeCloseTo(1 / 3, 12);
    expect(r.epsilon.hfFormula).toMatch(/Huynh–Feldt \(1976\)/);
  });

  test("corrected df and p; GG leads (ε < 0.75)", () => {
    expect(r.within.gg.df1).toBeCloseTo(1.598537, 5);
    expect(r.within.gg.df2).toBeCloseTo(11.189757, 5);
    expect(r.within.gg.p).toBeCloseTo(0.0625841, 6);
    const hf = r.within.hf!;
    expect(hf.df1).toBeCloseTo(1.997291, 5);
    expect(hf.df2).toBeCloseTo(13.981036, 5);
    expect(hf.p).toBeCloseTo(0.0483306, 6);
    expect(r.within.lead).toBe("gg");
    expect(r.within.leadP).toBeCloseTo(0.0625841, 6);
  });

  test("Holm paired t (df 7)", () => {
    const want: Array<[number, number, number, number]> = [
      [1, 2, 0.002023, 0.010116],
      [1, 3, 0.000941, 0.005645],
      [1, 4, 0.22673, 0.906918],
      [2, 3, 0.920075, 0.920075],
      [2, 4, 0.298672, 0.906918],
      [3, 4, 0.402042, 0.906918],
    ];
    expect(r.posthoc).toHaveLength(6);
    for (const [a, b, raw, adj] of want) {
      const row = r.posthoc!.find((x) => x.a === a && x.b === b)!;
      expect(row.df).toBe(7);
      expect(row.p as number).toBeCloseTo(raw, 6);
      expect(row.pAdj as number).toBeCloseTo(adj, 6);
    }
  });

  test("Friedman on the same data is unchanged (SciPy 11.526316, p 0.00919516)", () => {
    const fr = friedman(BUSH) as unknown as { statistic?: number; chi2?: number; p: number };
    const stat = (fr.chi2 ?? fr.statistic) as number;
    expect(stat).toBeCloseTo(11.526316, 5);
    expect(fr.p).toBeCloseTo(0.00919516, 7);
  });

  test("Cousineau–Morey 95% half-widths (single oracle)", () => {
    const s = r.profile.series[0];
    expect(s.means).toEqual([8.125, 4.25, 4.125, 5.75]);
    const want = [1.76288, 1.46375, 2.18446, 3.22438];
    want.forEach((w, j) => expect(s.ciHalfWidths[j]).toBeCloseTo(w, 4));
    expect(r.profile.ciMethod).toMatch(/Cousineau–Morey/);
  });

  test("posthoc none", () => {
    const n = ok(rmAnova(BUSH, undefined, { posthoc: "none" }));
    expect(n.posthoc).toBeNull();
  });
});

describe("§D3 well-conditioned set (k = 3)", () => {
  const r = ok(rmAnova(WELL));
  test("F(2, 10), p, partial η²", () => {
    expect(r.within.df1).toBe(2);
    expect(r.within.df2).toBe(10);
    expect(r.within.f).toBeCloseTo(79.0, 6);
    expect(r.within.p / 7.47229e-7).toBeCloseTo(1, 4);
    expect(r.within.partialEta2).toBeCloseTo(0.940476, 5);
  });
  test("Mauchly W, p; ε_GG; HF raw > 1 capped at 1, HF leads", () => {
    expect(r.mauchly.status).toBe("ok");
    if (r.mauchly.status === "ok") {
      expect(r.mauchly.W).toBeCloseTo(0.852245, 5);
      expect(r.mauchly.p).toBeCloseTo(0.726321, 5);
    }
    expect(r.epsilon.gg).toBeCloseTo(0.871266, 5);
    expect(r.epsilon.hfRaw as number).toBeGreaterThan(1);
    expect(r.epsilon.hfCapped).toBe(1);
    expect(r.within.hf!.epsilon).toBe(1);
    expect(r.within.lead).toBe("hf");
    expect(r.within.leadP).toBeCloseTo(r.within.p, 12);
  });
  test("Holm", () => {
    const adj = (a: number, b: number) => r.posthoc!.find((x) => x.a === a && x.b === b)!.pAdj as number;
    expect(adj(1, 2)).toBeCloseTo(0.002913, 6);
    expect(adj(1, 3)).toBeCloseTo(0.000135, 6);
    expect(adj(2, 3)).toBeCloseTo(0.002913, 6);
  });
});

describe("§D3 n < k (3 subjects × 4 conditions)", () => {
  const r = ok(rmAnova([
    [1, 2, 4, 3],
    [2, 3, 5, 5],
    [1, 4, 4, 6],
  ]));
  test("F still reported", () => {
    expect(r.within.df1).toBe(3);
    expect(r.within.df2).toBe(6);
    expect(r.within.f).toBeCloseTo(10.7826, 4);
    expect(r.within.p).toBeCloseTo(0.00787, 5);
  });
  test("Mauchly refused by name — never pingouin's p = 0.00105", () => {
    expect(r.mauchly.status).toBe("refused");
    if (r.mauchly.status === "refused")
      expect(r.mauchly.reason).toBe(
        "Mauchly's test needs at least as many subjects as conditions: 3 < 4 — the covariance of the contrasts is singular.",
      );
  });
  test("builder's choice: ε_GG reported, flagged unreliable, with a stated caveat", () => {
    expect(r.epsilon.gg).toBeCloseTo(0.366597, 5);
    expect(r.epsilon.reliable).toBe(false);
    expect(r.notes.join(" ")).toMatch(/singular contrast covariance/);
    expect(r.notes.join(" ")).toMatch(/lower-bound p/);
  });
  test("with ε unreliable the lower-bound p leads, not the GG p", () => {
    expect(r.within.lead).toBe("lowerBound");
    expect(r.within.lowerBound.df1).toBeCloseTo(1, 12);
    expect(r.within.lowerBound.df2).toBeCloseTo(2, 12);
    expect(r.within.leadP).toBe(r.within.lowerBound.p);
    expect(r.within.leadP).toBeGreaterThan(r.within.gg.p);
  });
});

describe("§D3 mixed design (Drug × 4, Placebo × 4; 3 times)", () => {
  const rows = [
    [10, 12, 14],
    [9, 11, 15],
    [12, 13, 16],
    [8, 10, 13],
    [11, 11, 12],
    [10, 12, 11],
    [12, 12, 13],
    [9, 10, 10],
  ];
  const groups = ["Drug", "Drug", "Drug", "Drug", "Placebo", "Placebo", "Placebo", "Placebo"];
  const r = ok(rmAnova(rows, groups));

  test("group F(1, 6)", () => {
    expect(r.design).toBe("mixed");
    expect(r.between!.df1).toBe(1);
    expect(r.between!.df2).toBe(6);
    expect(r.between!.f).toBeCloseTo(0.898204, 5);
    expect(r.between!.p).toBeCloseTo(0.379855, 5);
  });
  test("time F(2, 12), partial η²", () => {
    expect(r.within.df1).toBe(2);
    expect(r.within.df2).toBe(12);
    expect(r.within.f).toBeCloseTo(54.409091, 5);
    expect(r.within.p / 9.6005e-7).toBeCloseTo(1, 4);
    expect(r.within.partialEta2).toBeCloseTo(0.900677, 5);
  });
  test("interaction F(2, 12)", () => {
    const it = r.interaction!;
    expect(it.df1).toBe(2);
    expect(it.df2).toBe(12);
    expect(it.f).toBeCloseTo(24.681818, 5);
    expect(it.p / 5.59269e-5).toBeCloseTo(1, 4);
  });
  test("pooled-within Mauchly and ε_GG", () => {
    expect(r.mauchly.status).toBe("ok");
    if (r.mauchly.status === "ok") {
      expect(r.mauchly.W).toBeCloseTo(0.89876, 5);
      expect(r.mauchly.p).toBeCloseTo(0.76579, 4);
    }
    expect(r.epsilon.gg).toBeCloseTo(0.908068, 5);
  });
  test("HF raw: Lecoutre (as built) 1.2803, original 1.4973 — both cap to 1 (this set does NOT discriminate the formulas)", () => {
    expect(r.epsilon.hfRaw as number).toBeCloseTo(1.2803, 4);
    expect(r.epsilon.hfOriginalRaw as number).toBeCloseTo(1.4973, 4);
    expect(r.epsilon.hfCapped).toBe(1);
    expect(r.epsilon.hfFormula).toMatch(/Lecoutre \(1991\)/);
  });
  test("SS decomposition is exact (Type I)", () => {
    const s = r.ss;
    expect(s.group! + s.subjects + s.conditions + s.interaction! + s.error).toBeCloseTo(s.total, 10);
  });
  test("profile: one series per group", () => {
    expect(r.profile.series.map((x) => x.group)).toEqual(["Drug", "Placebo"]);
    expect(r.profile.series[0].means).toEqual([9.75, 11.5, 14.5]);
  });
});
