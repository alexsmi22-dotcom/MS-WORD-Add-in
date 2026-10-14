// INDEPENDENT adversarial review of the v2.135.0 stats batch (Cox, exact rank
// tests, repeated-measures ANOVA, the new table feeds, the typed comma rule).
// Brief: docs/SCOPE-STATS-BATCH.md §A–§E.
//
// Every expected value comes from an oracle that does NOT use the module's own
// helpers: brute-force enumeration written here (exact rank), SciPy 1.18.1
// permutation_test, statsmodels 0.15.0 PHReg and lifelines 0.30.3 (Cox), quoted
// inline. Nothing is read from disk.
//
// Plain `it`        = FAILS today: a wrong number or a silent misread.
// `it.failing`      = PASSES today: refusal where the question is answerable,
//                     or a cosmetic/display item. Flip to `it` when fixed.
//
// Feed pins assert only that the WRONG reading is absent: a named refusal and
// the right reading both pass, so the pins do not dictate one particular fix.

import { wilcoxonSignedRank } from "../stats2";
import { coxRegression } from "../cox";
import { readNumberList, decimalCommaNote } from "../numberList";
import { readSubjectsTable, readSubjectsBetween, feedSurvival, feedSurvivalGroups, readCoxTable } from "../tableFeed";

// ---------------------------------------------------------------------------
// Independent brute force: Wilcoxon signed-rank exact two-sided p on data the
// caller has already scaled to INTEGERS (so differences are exact). Midranks by
// counting (no sort); R's rule p = min(1, 2·min tail).
// ---------------------------------------------------------------------------
function bruteWilcoxonInt(a: number[], b: number[]): { p: number; tied: boolean } {
  const d = a.map((x, i) => x - b[i]).filter((x) => x !== 0);
  const abs = d.map(Math.abs);
  const r2 = abs.map((v) => 2 * abs.filter((w) => w < v).length + abs.filter((w) => w === v).length + 1);
  const n = d.length;
  const obs = d.reduce((s, v, i) => s + (v > 0 ? r2[i] : 0), 0);
  let le = 0;
  let ge = 0;
  for (let m = 0; m < 1 << n; m++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) s += r2[i];
    if (s <= obs) le++;
    if (s >= obs) ge++;
  }
  return { p: Math.min(1, (2 * Math.min(le, ge)) / 2 ** n), tied: new Set(abs).size < abs.length };
}

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isErr = (x: unknown): x is { error: string } => !!x && typeof x === "object" && "error" in (x as object);

// ===========================================================================
// WRONG — exact rank tests
// ===========================================================================

describe("Wilcoxon: |differences| of typed decimals are tied in the user's arithmetic, not in binary floating point", () => {
  // 2.9 − 2.7, 1.0 − 1.2 and 0.9 − 0.7 are all 0.2 in magnitude; in floats they are
  // 0.19999999999999973, 0.19999999999999996, 0.20000000000000007 — three DIFFERENT
  // ranks. The engine prints p = 0.046875 "exact" (no ties) — significant — where the
  // exact conditional p is 0.0625 (SciPy permutation_test on the ×10 integers, and the
  // brute force below). R and SciPy share the float artefact; the output here claims
  // "exact", so it must be exact on the numbers the user typed.
  it("the significance-crossing case: p = 0.0625, conditional on the ties (engine: 0.046875, 'exact', untied)", () => {
    const a = [2.1, 1.6, 2.7, 2.9, 1, 2.8, 0.9];
    const b = [1.8, 0.4, 0.5, 2.7, 1.2, 0.5, 0.7];
    const oracle = bruteWilcoxonInt(a.map((x) => Math.round(x * 10)), b.map((x) => Math.round(x * 10)));
    expect(oracle.p).toBeCloseTo(0.0625, 12);
    const r = wilcoxonSignedRank(a, b);
    expect(r.p).toBeCloseTo(oracle.p, 12);
    expect(r.exactConditional).toBe(true);
  });

  it("random one-decimal data, n ≤ 10: engine p equals the exact p on the typed decimals (≈ 1 in 3 differ today)", () => {
    const rnd = mulberry(20261014);
    const bad: string[] = [];
    for (let it = 0; it < 150; it++) {
      const n = 3 + Math.floor(rnd() * 8);
      const a = Array.from({ length: n }, () => Math.round(rnd() * 30) / 10);
      const b = Array.from({ length: n }, () => Math.round(rnd() * 30) / 10);
      const o = bruteWilcoxonInt(a.map((x) => Math.round(x * 10)), b.map((x) => Math.round(x * 10)));
      const r = wilcoxonSignedRank(a, b);
      if (Math.abs(r.p - o.p) > 1e-12 && bad.length < 5) bad.push(`${JSON.stringify(a)} v ${JSON.stringify(b)}: ${r.p} ≠ ${o.p}`);
    }
    expect(bad).toEqual([]);
  });
});

// ===========================================================================
// WRONG — the typed comma rule (numberList.ts)
// ===========================================================================

describe("typed lists: the comma's role is promised to be decided for the WHOLE field", () => {
  // The module header: "the comma's role is decided for the WHOLE field". In a field
  // where 2,5 and 3,75 prove the comma is DECIMAL, "1,250" is 1.25 — a European never
  // writes a thousands separator as a comma. Today it is read as 1250, silently
  // (decimalCommas counts 2, the note shows only "2,5 → 2.5").
  it("`1,250 2,5 3,75` never contains 1250", () => {
    expect(readNumberList("1,250 2,5 3,75").values).not.toContain(1250);
  });
  it("`0,5 1,000 1,5` never contains 1000 (it is 1.000 = 1 beside two decimal commas)", () => {
    expect(readNumberList("0,5 1,000 1,5").values).not.toContain(1000);
  });
});

// ===========================================================================
// WRONG — survival / Cox table feeds: underscore headers send time to AGE
// ===========================================================================

describe("survival headers with underscores (R/pandas/cBioPortal exports): `\\b` does not break at `_`, and the content fallback ignores the 'Age is never time' rule", () => {
  const AGES = ["61", "45", "70", "52", "66"];
  const firstColumn = (text: string): string[] => text.split("\n").map((l) => l.split(" ")[0]);

  it("age | time_months | status → never Kaplan–Meier on the ages (today: 'time = age')", () => {
    const r = feedSurvival([["age", "time_months", "status"], ["61", "5", "1"], ["45", "8", "0"], ["70", "12", "1"], ["52", "20", "0"], ["66", "3", "1"]]);
    if (!isErr(r)) {
      expect(r.note).not.toMatch(/time = age/i);
      expect(firstColumn(r.text)).not.toEqual(AGES);
    }
  });
  it("cBioPortal PATIENT_ID | AGE | OS_MONTHS | OS_STATUS → never 'time = AGE'", () => {
    const r = feedSurvival([["PATIENT_ID", "AGE", "OS_MONTHS", "OS_STATUS"], ["1", "61", "5.2", "1"], ["2", "45", "8.1", "0"], ["3", "70", "12.5", "1"], ["4", "52", "20.3", "0"], ["5", "66", "3.3", "1"]]);
    if (!isErr(r)) expect(firstColumn(r.text)).not.toEqual(AGES);
  });
  it("id | age | surv_time | event → never 'time = age'", () => {
    const r = feedSurvival([["id", "age", "surv_time", "event"], ["1", "61", "5", "1"], ["2", "45", "8", "0"], ["3", "70", "12", "1"], ["4", "52", "20", "0"], ["5", "66", "3", "1"]]);
    if (!isErr(r)) expect(firstColumn(r.text)).not.toEqual(AGES);
  });
  it("Cox on the cBioPortal layout: AGE is never the time and OS_MONTHS is never a covariate", () => {
    const r = readCoxTable([["PATIENT_ID", "AGE", "OS_MONTHS", "OS_STATUS", "SEX"], ["1", "61", "5.2", "1", "M"], ["2", "45", "8.1", "0", "F"], ["3", "70", "12.5", "1", "F"], ["4", "52", "20.3", "0", "M"], ["5", "66", "3.3", "1", "M"]]);
    if (!isErr(r)) {
      expect(r.input.times).toEqual([5.2, 8.1, 12.5, 20.3, 3.3]);
      expect(r.input.covariates.map((c) => c.name)).not.toContain("OS_MONTHS");
    }
  });
});

describe("two time-like headers: the covariate 'Time since diagnosis' must not beat 'Survival time'", () => {
  it("Patient | Time since diagnosis (years) | Survival time (months) | Status → time is never the years-since-diagnosis column", () => {
    const r = feedSurvival([["Patient", "Time since diagnosis (years)", "Survival time (months)", "Status"], ["P1", "2", "5", "1"], ["P2", "1", "8", "0"], ["P3", "4", "12", "1"], ["P4", "3", "20", "0"]]);
    if (!isErr(r)) expect(r.text.split("\n").map((l) => l.split(" ")[0])).toEqual(["5", "8", "12", "20"]);
  });
});

describe("Cox: a table with TWO endpoints (OS and PFS) — the second endpoint is post-baseline, never a covariate", () => {
  it("OS (months) | OS status | PFS (months) | PFS status | Age → no PFS covariate (today PFS time and status enter the model)", () => {
    const r = readCoxTable([["Patient", "OS (months)", "OS status", "PFS (months)", "PFS status", "Age"], ["P1", "5", "1", "3", "1", "60"], ["P2", "9", "0", "4", "1", "50"], ["P3", "12", "1", "12", "0", "70"], ["P4", "20", "0", "15", "1", "55"]]);
    if (!isErr(r)) expect(r.input.covariates.map((c) => c.name).filter((n) => /pfs/i.test(n))).toEqual([]);
  });
});

describe("Cox: a two-level text factor typed with inconsistent case", () => {
  // M / m / F / f is Sex with 2 levels; today it becomes a 4-level factor with 3
  // indicators (reference "f") — 3 parameters for 1 and an EPV computed on the wrong count.
  it("Sex = M, m, F, f → never 3 indicators", () => {
    const r = readCoxTable([["Time", "Status", "Sex"], ["5", "1", "M"], ["9", "0", "m"], ["12", "1", "F"], ["14", "0", "f"]]);
    if (!isErr(r)) expect(r.input.covariates.filter((c) => /^sex/i.test(c.name)).length).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// WRONG — subjects (Friedman / RM ANOVA): a numeric id column read as a CONDITION
// ===========================================================================

describe("wide repeated measures: an id header in SUBJECT_EXACT but not ID_EXACT (Mouse, Rat, Donor, subject_id) becomes a condition", () => {
  const cases: [string, string[][]][] = [
    ["Mouse 101–104", [["Mouse", "Pre", "Post", "Day 7"], ["101", "5", "7", "8"], ["102", "6", "9", "9"], ["103", "4", "6", "7"], ["104", "5", "8", "6"]]],
    ["Rat 2, 4, 1, 3 (a permutation, not a row counter)", [["Rat", "Pre", "Post"], ["2", "5", "7"], ["4", "6", "9"], ["1", "4", "6"], ["3", "5", "8"]]],
    ["Donor 7, 3, 9, 1", [["Donor", "Pre", "Post"], ["7", "5", "7"], ["3", "6", "9"], ["9", "4", "6"], ["1", "5", "8"]]],
    ["subject_id 101–104", [["subject_id", "pre", "post"], ["101", "5", "7"], ["102", "6", "9"], ["103", "4", "6"], ["104", "5", "8"]]],
  ];
  for (const [label, grid] of cases) {
    it(`${label}: the id column is never a condition (Friedman and RM ANOVA share this reader)`, () => {
      const idHeader = grid[0][0];
      const r = readSubjectsTable(grid.map((row) => [...row]));
      if (!isErr(r)) expect(r.conditions).not.toContain(idHeader);
      const b = readSubjectsBetween(grid.map((row) => [...row]));
      if (!isErr(b)) expect(b.rows[0].length).toBe(grid[0].length - 1);
    });
  }
});

describe("wide repeated measures: a Total / Mean row under text subject labels is read as one more SUBJECT (§A listed 'Mean row … refused' as RIGHT)", () => {
  for (const word of ["Total", "Mean"]) {
    it(`${word} row → never a subject`, () => {
      const r = readSubjectsTable([["Subject", "A", "B", "C"], ["S1", "5", "7", "8"], ["S2", "6", "9", "9"], ["S3", "4", "6", "7"], [word, "15", "22", "24"]]);
      if (!isErr(r)) expect(r.subjects).not.toContain(word);
    });
  }
});

// ===========================================================================
// REFUSAL WHERE ANSWERABLE — it.failing (passes today; flip when fixed)
// ===========================================================================

describe("Cox separation rule refuses a STRONG BUT FINITE effect", () => {
  // n = 60, x ~ N(0, 1), T = exp(−3x + N(0, 0.25²)) × 100, ~80% events. statsmodels PHReg
  // (Efron): β = 16.106031, SE 2.513847; lifelines: β = 16.106030, SE 2.513847 —
  // two libraries agree to 7 s.f., z = 6.4. β·SD = 15.3 > 10 trips the §B1 rule and the
  // engine refuses, saying "the likelihood keeps rising … no finite hazard ratio exists"
  // — false: the Newton iteration converged; SE·SD = 2.39 (a truly divergent fit shows
  // SE·SD in the thousands — the no-event reference level gives 6930). Same with
  // k = 6, n = 300: β·SD = 10.35, SE·SD = 0.59, z = 17.4.
  const times = [1369.516, 6557.849, 181.019, 27.836, 4.64, 65.164, 550.217, 1047.546, 12.32, 0.677, 42.469, 4297.34, 1818.417, 0.663, 68.065, 13055.365, 95.2, 2378.5, 841.156, 395.059, 666.707, 14.311, 134.251, 450.228, 21.29, 9.671, 10250.311, 199.288, 1892.628, 150.401, 4721.6, 131.34, 98.455, 181.882, 1465.224, 311.859, 2418.959, 6229.611, 45.365, 2473.923, 2.494, 10.231, 41717.54, 40.193, 2794.562, 145.663, 98.895, 26276.679, 310.698, 234.978, 4.41, 4342.792, 10.973, 2317.592, 230.596, 970.908, 1.311, 23.754, 0.063, 16.194];
  const events = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1];
  const x = [-0.8019, -1.3244, -0.2484, 0.4204, 1.136, 0.1097, -0.5526, -0.7848, 0.7487, 1.6348, 0.2728, -1.2333, -0.9583, 1.6, 0.2029, -1.7321, -0.0837, -1.1632, -0.6293, -0.488, -0.7133, 0.5534, -0.0631, -0.5894, 0.4096, 0.8299, -1.643, -0.2567, -0.9807, -0.1732, -1.2894, 0.0207, -0.0379, -0.3043, -1.0479, -0.3962, -1.0913, -1.3552, 0.2248, -1.1093, 1.1703, 0.7166, -1.9978, 0.2721, -1.1017, 0.0331, 0.0436, -1.9884, -0.2334, -0.2558, 0.962, -1.1814, 0.738, -1.099, -0.3313, -0.8405, 1.4487, 0.5682, 2.4317, 0.6419];
  it("fits β = 16.10603 (SE 2.51385) as statsmodels and lifelines do", () => {
    const r = coxRegression({ times, events, covariates: [{ name: "x", values: x }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coefficients[0].beta).toBeCloseTo(16.106031, 4);
      expect(r.coefficients[0].se).toBeCloseTo(2.513847, 4);
    }
  });
});

describe("long repeated measures: answerable layouts that are refused", () => {
  it("Subject | Treatment | Time | Score (Treatment between, Time within): CONDITION_EXACT takes Treatment as the within factor and refuses", () => {
    const r = readSubjectsBetween([["Subject", "Treatment", "Time", "Score"], ["1", "Drug", "Pre", "5"], ["1", "Drug", "Post", "8"], ["2", "Drug", "Pre", "6"], ["2", "Drug", "Post", "9"], ["3", "Placebo", "Pre", "5"], ["3", "Placebo", "Post", "5"], ["4", "Placebo", "Pre", "7"], ["4", "Placebo", "Post", "6"]]);
    expect(isErr(r)).toBe(false);
    if (!isErr(r)) {
      expect(r.rows).toEqual([[5, 8], [6, 9], [5, 5], [7, 6]]);
      expect(new Set(r.groups).size).toBe(2);
    }
  });
  it("a Group label MERGED down its rows (Excel) is forward-filled like the subject label (today: 'Subject 2 has no Group')", () => {
    const r = readSubjectsBetween([["Subject", "Group", "Time", "Score"], ["1", "Drug", "1", "5"], ["1", "", "2", "8"], ["2", "", "1", "6"], ["2", "", "2", "9"], ["3", "Placebo", "1", "5"], ["3", "", "2", "5"], ["4", "", "1", "7"], ["4", "", "2", "6"]]);
    expect(isErr(r)).toBe(false);
  });
});

describe("log-rank feed: a header that SAYS time is refused as 'an id'", () => {
  it("arm | time_days | dead → read (today: 'The only candidate for time (time_days) is … an id')", () => {
    const r = feedSurvivalGroups([["arm", "time_days", "dead"], ["A", "5", "1"], ["A", "8", "0"], ["B", "12", "1"], ["B", "20", "0"]]);
    expect(isErr(r)).toBe(false);
  });
});

// ===========================================================================
// COSMETIC — it.failing
// ===========================================================================

describe("cosmetic", () => {
  it("`1.200,5 2.300,1` (European thousands) is read as 1200.5 — and the note must say so (today decimalCommas = 0, note empty)", () => {
    const r = readNumberList("1.200,5 2.300,1");
    expect(r.values).toEqual([1200.5, 2300.1]);
    expect(decimalCommaNote(r)).not.toBe("");
  });
  it("two header rows (a merged 'Time' banner over 0 h | 2 h | 4 h): the refusal names a real cell, not 'Subject  has \"Time\" for condition 1'", () => {
    const r = readSubjectsTable([["", "Time", "", ""], ["Subject", "0 h", "2 h", "4 h"], ["S1", "5", "7", "8"], ["S2", "6", "9", "9"], ["S3", "4", "6", "7"]]);
    if (isErr(r)) expect(r.error).not.toMatch(/Subject\s{2}has/);
  });
});
