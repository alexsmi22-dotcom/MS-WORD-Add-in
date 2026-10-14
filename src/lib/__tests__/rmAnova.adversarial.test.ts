// Repeated-measures ANOVA — hostile inputs (house rule). Each block names the
// failure it is trying to provoke. Cross-checks use INDEPENDENT routes:
//  - k = 2: the RM F must equal the paired t² (identity: SS_cond = n·d̄²/2 and
//    SS_error = Σ(d − d̄)²/2, so F = n·d̄²/s_d² = t²), with the same p.
//  - ε_GG from Box's double-centred covariance formula (no contrast matrix).
//  - SS_total = SS_subjects + SS_conditions + SS_error, each computed directly.

import { rmAnova, RmAnovaResult, RmAnovaOutcome, RM_MAX_SUBJECTS, RM_MAX_CONDITIONS } from "../rmAnova";
import { pairedTTest } from "../stats";

function ok(r: RmAnovaOutcome): RmAnovaResult {
  if (!r.ok) throw new Error("expected a result, got refusal: " + r.reason);
  return r;
}
function refused(r: RmAnovaOutcome): string {
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

// Deterministic PRNG so failures reproduce.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function randomData(n: number, k: number, seed: number): number[][] {
  const rnd = lcg(seed);
  return Array.from({ length: n }, () => {
    const subj = rnd() * 10;
    return Array.from({ length: k }, (_, j) => subj + j * 0.7 + rnd() * 5);
  });
}

/** Box (1954) ε from the covariance matrix directly — no contrasts. */
function boxEpsilon(rows: number[][]): number {
  const n = rows.length;
  const k = rows[0].length;
  const m = Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  const S = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => rows.reduce((s, r) => s + (r[a] - m[a]) * (r[b] - m[b]), 0) / (n - 1)),
  );
  const diagMean = S.reduce((s, r, i) => s + r[i], 0) / k;
  const all = S.flat().reduce((s, v) => s + v, 0) / (k * k);
  const rowMeans = S.map((r) => r.reduce((s, v) => s + v, 0) / k);
  const sumSq = S.flat().reduce((s, v) => s + v * v, 0);
  const num = k * k * (diagMean - all) ** 2;
  const den = (k - 1) * (sumSq - 2 * k * rowMeans.reduce((s, v) => s + v * v, 0) + k * k * all * all);
  return num / den;
}

describe("2 conditions: sphericity holds trivially, F = paired t²", () => {
  const a = [12.1, 14.3, 11.8, 15.2, 13.9, 12.7, 16.1];
  const b = [13.0, 15.9, 12.2, 16.8, 14.1, 14.0, 17.5];
  const r = ok(rmAnova(a.map((x, i) => [x, b[i]])));
  test("ε = 1 by name, Mauchly trivial, uncorrected p leads", () => {
    expect(r.mauchly.status).toBe("trivial");
    if (r.mauchly.status === "trivial") expect(r.mauchly.reason).toMatch(/sphericity holds trivially: ε = 1/);
    expect(r.epsilon.gg).toBe(1);
    expect(r.epsilon.hfCapped).toBe(1);
    expect(r.within.lead).toBe("uncorrected");
    expect(r.within.gg.p).toBeCloseTo(r.within.p, 14);
  });
  test("F equals the paired t² and the p values agree", () => {
    const t = pairedTTest(a, b);
    expect(r.within.f).toBeCloseTo(t.t * t.t, 9);
    expect(r.within.p).toBeCloseTo(t.p, 9);
    expect(r.within.df2).toBe(t.df);
    expect(r.posthoc![0].p as number).toBeCloseTo(t.p, 12);
  });
  test("random 2-condition sets keep the identity", () => {
    for (let s = 1; s <= 25; s++) {
      const d = randomData(3 + (s % 20), 2, s);
      const rr = ok(rmAnova(d));
      const t = pairedTTest(
        d.map((x) => x[0]),
        d.map((x) => x[1]),
      );
      expect(rr.within.f / (t.t * t.t)).toBeCloseTo(1, 9);
    }
  });
});

describe("subjects vs conditions", () => {
  test("n = k: Mauchly is computable (df = k − 1)", () => {
    const r = ok(rmAnova(randomData(4, 4, 7)));
    expect(r.mauchly.status).toBe("ok");
    expect(r.epsilon.reliable).toBe(true);
  });
  test("n < k: refused by name; GG still bounded in [1/(k − 1), 1]", () => {
    const r = ok(rmAnova(randomData(3, 6, 11)));
    expect(r.mauchly.status).toBe("refused");
    if (r.mauchly.status === "refused") expect(r.mauchly.reason).toMatch(/3 < 6/);
    expect(r.epsilon.gg).toBeGreaterThanOrEqual(1 / 5 - 1e-12);
    expect(r.epsilon.gg).toBeLessThanOrEqual(1);
    expect(r.epsilon.reliable).toBe(false);
    expect(Number.isFinite(r.within.f)).toBe(true);
  });
  test("2 subjects × 5 conditions: HF undefined is said, not printed as a number", () => {
    const r = ok(rmAnova([
      [1, 3, 2, 5, 4],
      [2, 2, 4, 4, 7],
    ]));
    expect(r.mauchly.status).toBe("refused");
    // HF denominator (k − 1)(N − 1 − (k − 1)ε) = 4(1 − 4ε) ≤ 0 because ε ≥ 1/4
    expect(r.epsilon.hfRaw).toBeNull();
    expect(r.within.hf).toBeNull();
    expect(r.within.lead).toBe("lowerBound");
    expect(r.notes.join(" ")).toMatch(/Huynh–Feldt ε is undefined/);
    expect(r.notes.join(" ")).not.toMatch(/1\.000 < 0\.75/);
  });
  test("mixed: N − g < k − 1 refuses Mauchly naming N − g", () => {
    const r = ok(rmAnova(randomData(4, 5, 3), ["A", "A", "B", "B"]));
    expect(r.mauchly.status).toBe("refused");
    if (r.mauchly.status === "refused") expect(r.mauchly.reason).toMatch(/N − g = 2 < 4/);
  });
  test("rank-deficient covariance with n ≥ k (a constant contrast) — refused, never W = 0", () => {
    // condition 3 = condition 1 + 5 for every subject
    const rows = randomData(8, 3, 21).map((r) => [r[0], r[1], r[0] + 5]);
    const r = ok(rmAnova(rows));
    expect(r.mauchly.status).toBe("refused");
    if (r.mauchly.status === "refused") expect(r.mauchly.reason).toMatch(/singular/);
    // that pair has a zero-variance difference: no paired t, left out of Holm
    const pair = r.posthoc!.find((x) => x.a === 1 && x.b === 3)!;
    expect(pair.t).toBeNull();
    expect(pair.pAdj).toBeNull();
    expect(pair.note).toMatch(/zero variance/);
    for (const row of r.posthoc!) if (row.p !== null) expect(Number.isFinite(row.pAdj as number)).toBe(true);
  });
});

describe("degenerate data", () => {
  test("a constant subject is fine", () => {
    const rows = randomData(6, 4, 5);
    rows[2] = [7, 7, 7, 7];
    const r = ok(rmAnova(rows));
    expect(Number.isFinite(r.within.f)).toBe(true);
    expect(r.ss.subjects + r.ss.conditions + r.ss.error).toBeCloseTo(r.ss.total, 9);
  });
  test("a constant condition is fine (F finite, ε in range)", () => {
    const rows = randomData(8, 4, 9);
    rows.forEach((r) => (r[1] = 3));
    const r = ok(rmAnova(rows));
    expect(Number.isFinite(r.within.f)).toBe(true);
    expect(r.epsilon.gg).toBeGreaterThanOrEqual(1 / 3 - 1e-12);
    expect(r.epsilon.gg).toBeLessThanOrEqual(1);
    if (r.mauchly.status === "ok") {
      expect(r.mauchly.p).toBeGreaterThanOrEqual(0);
      expect(r.mauchly.p).toBeLessThanOrEqual(1);
    }
  });
  test("perfectly additive data: error SS = 0 refuses the F by name", () => {
    const reason = refused(
      rmAnova([
        [1, 3, 6],
        [4, 6, 9],
        [2, 4, 7],
        [10, 12, 15],
      ]),
    );
    expect(reason).toMatch(/error sum of squares is 0/);
    expect(reason).toMatch(/perfectly additive/);
  });
  test("additive data at a large offset still refuses (relative tolerance, not === 0)", () => {
    const base = 1e7;
    expect(
      refused(
        rmAnova([
          [base + 0.1, base + 0.3, base + 0.6],
          [base + 0.4, base + 0.6, base + 0.9],
          [base + 0.2, base + 0.4, base + 0.7],
        ]),
      ),
    ).toMatch(/error sum of squares is 0/);
  });
  test("MUST FIT: huge subject baselines with tiny real residuals are not 'perfectly additive'", () => {
    // baselines 0 … 7e5, residual SD ≈ 0.01: SS_total ≈ 1e12, SS_error ≈ 1e-3.
    const rnd = lcg(404);
    const rows = Array.from({ length: 8 }, (_, i) => [0, 0.05, 0.1].map((c) => i * 1e5 + c + (rnd() - 0.5) * 0.035));
    const r = ok(rmAnova(rows));
    expect(Number.isFinite(r.within.f)).toBe(true);
    expect(r.ss.error).toBeGreaterThan(0);
  });
  test("mixed: a between-group error of 0 drops only the group F, said", () => {
    const rows = [
      [1, 2, 4],
      [2, 1, 4],
      [5, 7, 9],
      [7, 5, 9],
    ];
    const r = ok(rmAnova(rows, ["a", "a", "b", "b"]));
    expect(r.between).toBeNull();
    expect(r.notes.join(" ")).toMatch(/between-group F is undefined/);
    expect(Number.isFinite(r.within.f)).toBe(true);
  });
  test("constant-contrast singular covariance (n ≥ k): lower bound leads, note names the cause", () => {
    const rows = randomData(8, 3, 21).map((r) => [r[0], r[1], r[0] + 5]);
    const r = ok(rmAnova(rows));
    expect(r.within.lead).toBe("lowerBound");
    expect(r.notes.join(" ")).toMatch(/does not vary across subjects/);
    expect(r.notes.join(" ")).not.toMatch(/8 subjects for 3 conditions/);
  });
  test("all values identical", () => {
    expect(refused(rmAnova([[5, 5], [5, 5], [5, 5]]))).toMatch(/identical/);
  });
  test("conditions all equal in mean: F = 0, p = 1", () => {
    const r = ok(rmAnova([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]));
    expect(r.within.f).toBe(0);
    expect(r.within.p).toBe(1);
  });
});

describe("missing cells, ragged rows, groups", () => {
  test("NaN cell refused by subject and condition", () => {
    expect(refused(rmAnova([[1, 2, 3], [2, 3, 4], [3, NaN, 5]]))).toBe(
      "Subject 3 is missing condition 2: a linear mixed model handles missing visits; this calculator does not.",
    );
  });
  test("Infinity refused", () => {
    expect(refused(rmAnova([[1, 2], [2, Infinity], [3, 5]]))).toMatch(/Subject 2 is missing condition 2/);
  });
  test("ragged row refused, no padding", () => {
    expect(refused(rmAnova([[1, 2, 3], [2, 3], [3, 4, 5]]))).toMatch(/Subject 2 has 2 values but subject 1 has 3/);
  });
  test("one subject / one condition", () => {
    expect(refused(rmAnova([[1, 2, 3]]))).toMatch(/at least 2 subjects/);
    expect(refused(rmAnova([[1], [2], [3]]))).toMatch(/at least 2 conditions/);
    expect(refused(rmAnova([]))).toMatch(/at least 2 subjects/);
  });
  test("group labels: count mismatch, blank label, singleton group", () => {
    const d = randomData(4, 3, 2);
    expect(refused(rmAnova(d, ["A", "B", "A"]))).toMatch(/3 group labels for 4 subjects/);
    expect(refused(rmAnova(d, ["A", "", "B", "B"]))).toMatch(/Subject 2 has no group label/);
    expect(refused(rmAnova(d, ["A", "B", "B", "B"]))).toMatch(/Group "A" has 1 subject/);
  });
  test("a single group level runs the one-way design and says so", () => {
    const d = randomData(5, 3, 4);
    const r = ok(rmAnova(d, ["Drug", "Drug", "Drug", "Drug", "Drug"]));
    expect(r.design).toBe("one-way");
    expect(r.notes[0]).toMatch(/one group/);
    const plain = ok(rmAnova(d));
    expect(r.within.f).toBeCloseTo(plain.within.f, 12);
  });
  test("interleaved group labels are grouped by label, not by position", () => {
    const d = randomData(8, 3, 31);
    const lab = ["A", "B", "A", "B", "A", "B", "A", "B"];
    const r = ok(rmAnova(d, lab));
    const sorted = ok(rmAnova([0, 2, 4, 6, 1, 3, 5, 7].map((i) => d[i]), ["A", "A", "A", "A", "B", "B", "B", "B"]));
    expect(r.between!.f).toBeCloseTo(sorted.between!.f, 10);
    expect(r.interaction!.f).toBeCloseTo(sorted.interaction!.f, 10);
    expect(r.epsilon.gg).toBeCloseTo(sorted.epsilon.gg, 10);
  });
});

describe("caps come before any work", () => {
  test("subjects above the cap refused even when the data are garbage", () => {
    const rows = Array.from({ length: RM_MAX_SUBJECTS + 1 }, () => [NaN, NaN]);
    expect(refused(rmAnova(rows))).toMatch(/501 subjects is above the 500-subject limit/);
  });
  test("conditions above the cap", () => {
    const rows = [new Array(RM_MAX_CONDITIONS + 1).fill(1), new Array(RM_MAX_CONDITIONS + 1).fill(2)];
    expect(refused(rmAnova(rows))).toMatch(/at most 20/);
  });
  test("200 subjects × 10 conditions in well under 1 s (4 s gross-freeze bound)", () => {
    const d = randomData(200, 10, 99);
    const t0 = Date.now();
    const r = ok(rmAnova(d));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(4000);
    expect(ms).toBeLessThan(1000);
    expect(r.mauchly.status).toBe("ok");
    expect(r.profile.subjectLines).toHaveLength(40);
    expect(r.profile.subjectLinesCapped).toBe(true);
    expect(r.profile.subjectLinesTotal).toBe(200);
  });
  test("500 × 20 mixed (the caps) completes", () => {
    const d = randomData(500, 20, 5);
    const t0 = Date.now();
    const r = ok(rmAnova(d, d.map((_, i) => (i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c"))));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.posthoc).toHaveLength(190);
  });
});

describe("independent cross-checks", () => {
  test("one-way SS decomposition sums exactly on random data", () => {
    for (let s = 1; s <= 30; s++) {
      const d = randomData(3 + (s % 9), 2 + (s % 6), s * 7);
      const r = ok(rmAnova(d));
      const { subjects, conditions, error, total } = r.ss;
      expect(Math.abs(subjects + conditions + error - total)).toBeLessThan(1e-9 * total);
      // and against a fully independent total
      const all = d.flat();
      const m = all.reduce((x, y) => x + y, 0) / all.length;
      expect(total).toBeCloseTo(all.reduce((x, y) => x + (y - m) ** 2, 0), 8);
    }
  });
  test("mixed decomposition sums exactly, unbalanced groups", () => {
    const d = randomData(9, 4, 77);
    const r = ok(rmAnova(d, ["x", "x", "x", "y", "y", "y", "y", "y", "y"]));
    const s = r.ss;
    expect(s.group! + s.subjects + s.conditions + s.interaction! + s.error).toBeCloseTo(s.total, 9);
    expect(r.ssConvention).toMatch(/Type I/);
  });
  test("ε_GG equals Box's covariance formula (no contrasts)", () => {
    for (let s = 1; s <= 20; s++) {
      const d = randomData(6 + s, 3 + (s % 5), s * 13);
      const r = ok(rmAnova(d));
      expect(r.epsilon.gg).toBeCloseTo(boxEpsilon(d), 9);
    }
  });
  test("invariance: permuting subjects or conditions, rescaling, shifting", () => {
    const d = randomData(10, 4, 55);
    const base = ok(rmAnova(d));
    const perm = ok(rmAnova(d.slice().reverse().map((r) => [r[2], r[0], r[3], r[1]])));
    const scaled = ok(rmAnova(d.map((r) => r.map((v) => v * 1e5 + 3e6))));
    for (const r of [perm, scaled]) {
      expect(r.within.f).toBeCloseTo(base.within.f, 6);
      expect(r.epsilon.gg).toBeCloseTo(base.epsilon.gg, 8);
      if (r.mauchly.status === "ok" && base.mauchly.status === "ok") {
        expect(r.mauchly.W).toBeCloseTo(base.mauchly.W, 8);
        expect(r.mauchly.p).toBeCloseTo(base.mauchly.p, 8);
      } else throw new Error("Mauchly status changed under an invariance");
    }
  });
  test("GG ≤ HF-capped and both within [1/(k − 1), 1]; Mauchly p in [0, 1]", () => {
    for (let s = 1; s <= 30; s++) {
      const d = randomData(8 + (s % 10), 3 + (s % 6), s * 3);
      const r = ok(rmAnova(d));
      const lb = 1 / (d[0].length - 1);
      expect(r.epsilon.gg).toBeGreaterThanOrEqual(lb - 1e-12);
      expect(r.epsilon.gg).toBeLessThanOrEqual(1);
      if (r.epsilon.hfCapped !== null) expect(r.epsilon.hfCapped).toBeLessThanOrEqual(1);
      if (r.mauchly.status === "ok") {
        expect(r.mauchly.p).toBeGreaterThanOrEqual(0);
        expect(r.mauchly.p).toBeLessThanOrEqual(1);
        expect(r.mauchly.W).toBeGreaterThan(0);
        expect(r.mauchly.W).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
});

describe("display contract in every string", () => {
  test("no ASCII stand-ins (chi2, eta^2, epsilon, ' - ' ranges)", () => {
    const strings: string[] = [];
    const r = ok(rmAnova(randomData(3, 5, 1)));
    strings.push(...r.notes, r.leadRule, r.ssConvention, r.epsilon.hfFormula, r.profile.ciMethod);
    if (r.mauchly.status !== "ok") strings.push(r.mauchly.reason);
    strings.push(refused(rmAnova([[1, 3], [4, 6], [2, 4]])));
    const m = ok(rmAnova(randomData(8, 3, 2), ["a", "a", "a", "a", "b", "b", "b", "b"]));
    strings.push(m.epsilon.hfFormula, m.ssConvention, ...m.notes);
    for (const s of strings) {
      expect(s).not.toMatch(/chi2|chi\^2|eta\^2|eta2|epsilon|\^2/i);
    }
  });
});
