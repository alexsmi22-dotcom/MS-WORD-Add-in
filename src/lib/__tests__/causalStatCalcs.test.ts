/**
 * Release F2 #12 (causal inference II): the three Stats calculators against scripts/causal-oracle.py
 * (fixtures/causal-oracle.json), hostile inputs, the pane's contract, and the 300 ms budget at the caps.
 *
 * Tolerances: RD bandwidth and fits 1e-8 relative (both sides solve the same small least-squares problems in double
 * precision); synthetic control: pre-RMSPE 1e-5 relative, synthetic path 1e-4 absolute, placebo ranks exact (two
 * different QP solvers on the same strictly convex objective); propensity score: p̂ 1e-7, matching estimates 1e-9,
 * IPW estimate 1e-9 and SE 1e-5 relative (the oracle's Jacobian is a central difference).
 */
import * as fs from "fs";
import * as path from "path";
import {
  CAUSAL_STAT_CALCS,
  IK_CK,
  ikBandwidth,
  ikPilot,
  ikFinal,
  rdFit,
  synthControl,
  psMatch,
  psIpw,
  logitScore,
  rdDefaultTable,
  scDefaultTable,
  psDefaultTable,
  RD_MAX_ROWS,
  SC_MAX_DONORS,
  SC_MAX_PERIODS,
  PS_MAX_ROWS,
  type RdKernel,
} from "../causalStatCalcs";
import { parseRegData, selectColumns } from "../regData";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FIX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "causal-oracle.json"), "utf8"));

const calc = (id: string): StatCalcDef => CAUSAL_STAT_CALCS.find((c) => c.id === id)!;
/** The pane's read path (statSpreadContract.test.ts): every field as typed, the default when not overridden. */
function run(c: StatCalcDef, over: Record<string, string> = {}): StatOutput {
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
}
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

function cols(text: string, dep: string, preds: string[]): { y: number[]; X: number[][] } {
  const p = parseRegData(text);
  if (!p.ok) throw new Error(p.reason);
  const s = selectColumns(p.data, { dep, preds, text: "" });
  if (!s.ok) throw new Error(s.reason);
  return { y: Array.from(s.cols.y), X: s.cols.X.map((c) => Array.from(c)) };
}

describe("worked defaults are the oracle's tables byte for byte", () => {
  test("rd, synthetic control, propensity score", () => {
    expect(rdDefaultTable()).toBe(FIX.defaults.rd);
    expect(scDefaultTable()).toBe(FIX.defaults.sc);
    expect(psDefaultTable()).toBe(FIX.defaults.ps);
  });
});

describe("regression discontinuity", () => {
  test("C_K by IK Lemma 3.1 (oracle quadrature)", () => {
    for (const k of ["triangular", "epanechnikov", "uniform"] as RdKernel[]) expect(rel(IK_CK[k], FIX.ck[k])).toBeLessThan(1e-9);
    expect(IK_CK.triangular.toFixed(4)).toBe("3.4375");
  });

  test("IK steps 2–3 reproduce the published Lee (2008) worked example, NBER WP 14726 §6.2", () => {
    // The example prints σ̂²(0) = 0.11282, but every downstream number it prints follows from σ̂² = 0.11282² (its σ̂):
    // h₂,₊ = 0.3674, h₂,₋ = 0.3852, ĥ = 0.2649 and the unregularised 0.2892, with f̂ = 0.8962, m̂⁽³⁾ = −5.4611,
    // N₊ = 3818, N₋ = 2740, N = 6558, m̂⁽²⁾₊ = −0.5233, m̂⁽²⁾₋ = 0.4904, r̂₊ = 0.2634, r̂₋ = 0.3036 (all as printed).
    const s2 = 0.11282 * 0.11282;
    // Printed to 4 decimals from rounded inputs: agreement to 1.5×10⁻⁴.
    expect(Math.abs(ikPilot(s2, 0.8962, -5.4611, 3818) - 0.3674)).toBeLessThan(1.5e-4);
    expect(Math.abs(ikPilot(s2, 0.8962, -5.4611, 2740) - 0.3852)).toBeLessThan(1.5e-4);
    expect(Math.abs(ikFinal(3.4375, s2, 0.8962, -0.5233, 0.4904, 0.2634, 0.3036, 6558) - 0.2649)).toBeLessThan(0.0015);
    expect(Math.abs(ikFinal(3.4375, s2, 0.8962, -0.5233, 0.4904, 0, 0, 6558) - 0.2892)).toBeLessThan(0.0015);
  });

  const datasets: Record<string, { text: string; y: string; x: string; t: string }> = {
    default: { text: FIX.defaults.rd, y: "outcome", x: "score", t: "treated" },
    integer: { text: FIX.rdData.integer, y: "y", x: "age", t: "t" },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each(FIX.rd.map((c: any) => [`${c.data} ${c.kernel} order ${c.order ?? 1}`, c]) as [string, any][])("%s vs the oracle", (_l, c) => {
    const d = datasets[c.data];
    const { y, X } = cols(d.text, d.y, [d.x, d.t]);
    const x = X[0];
    const t = X[1];
    let h: number;
    if (c.ik) {
      const s = ikBandwidth(x, y, c.cutoff, c.kernel);
      if ("error" in s) throw new Error(s.error);
      for (const k of ["h", "h1", "f", "sigma2", "m3", "h2p", "h2m", "m2p", "m2m", "rp", "rm"]) expect(rel((s as never)[k], c.ik[k])).toBeLessThan(1e-7);
      h = s.h;
    } else h = c.h;
    const order = (c.order ?? 1) as 1 | 2;
    const sh = rdFit(x, y, null, c.cutoff, h, c.kernel, order);
    if ("error" in sh) throw new Error(sh.error);
    expect(sh.nL).toBe(c.sharp.nL);
    expect(sh.nR).toBe(c.sharp.nR);
    expect(rel(sh.tau, c.sharp.tau)).toBeLessThan(1e-7);
    expect(rel(sh.se, c.sharp.se)).toBeLessThan(1e-7);
    const fz = rdFit(x, y, t, c.cutoff, h, c.kernel, order);
    if ("error" in fz) throw new Error(fz.error);
    expect(rel(fz.tau, c.fuzzy.tau)).toBeLessThan(1e-7);
    expect(rel(fz.se, c.fuzzy.se)).toBeLessThan(1e-7);
    expect(rel(fz.fs!.est, c.fuzzy.fs)).toBeLessThan(1e-7);
    expect(rel(fz.fs!.se, c.fuzzy.fsSe)).toBeLessThan(1e-7);
  });

  test("the calculator prints the oracle's default numbers", () => {
    const o = run(calc("causal-rdd"));
    const c = FIX.rd[0];
    expect(o.text).toContain(`h = ${c.ik.h.toFixed(4)}`);
    expect(o.text).toContain(`τ = ${c.sharp.tau.toFixed(3)} (SE ${c.sharp.se.toFixed(3)})`);
    const f = run(calc("causal-rdd"), { design: "fuzzy" });
    expect(f.text).toContain(`τ = ${c.fuzzy.tau.toFixed(3)} (SE ${c.fuzzy.se.toFixed(3)})`);
    const e = run(calc("causal-rdd"), { kernel: "epanechnikov" });
    expect(e.text).toContain(`h = ${FIX.rd[1].ik.h.toFixed(4)}`);
  });

  test("hostile inputs refuse by field name", () => {
    const c = calc("causal-rdd");
    expect(run(c, { cutoff: "" }).text).toMatch(/^Cutoff/);
    expect(run(c, { cutoff: "abc" }).text).toMatch(/^Cutoff/);
    expect(run(c, { cutoff: "1e400" }).text).toMatch(/^Cutoff/);
    expect(run(c, { cutoff: "NaN" }).ok).toBe(false);
    expect(run(c, { cutoff: "1,000" }).text).toMatch(/one side of the cutoff 1000/);
    expect(run(c, { cutoff: "50,0" }).ok).not.toBe(false); // a decimal comma
    expect(run(c, { cutoff: "−5" }).text).toMatch(/one side of the cutoff −5/);
    expect(run(c, { bandwidth: "0" }).text).toMatch(/^Bandwidth/);
    expect(run(c, { bandwidth: "-3" }).text).toMatch(/^Bandwidth/);
    expect(run(c, { bandwidth: "0.05" }).text).toMatch(/Widen the bandwidth/);
    expect(run(c, { order: "2" }).text).toMatch(/^Bandwidth: the Imbens–Kalyanaraman rule is derived for local linear/);
    expect(run(c, { order: "2", bandwidth: "15" }).ok).not.toBe(false);
    expect(run(c, { bins: "1" }).text).toMatch(/^Bins per side/);
    expect(run(c, { bins: "x" }).text).toMatch(/^Bins per side/);
    expect(run(c, { outcome: "" }).text).toMatch(/^Outcome column/);
    expect(run(c, { running: "nope" }).text).toMatch(/No column is named “nope”/);
    expect(run(c, { design: "fuzzy", treatment: "" }).text).toMatch(/^Treatment column/);
    expect(run(c, { design: "fuzzy", treatment: "score" }).ok).toBe(false);
    expect(run(c, { data: "" }).ok).toBe(false);
    expect(run(c, { kernel: "gauss" }).text).toMatch(/^Kernel/);
    // A treatment column that does not jump.
    const flat = FIX.defaults.rd.split("\n").map((l: string, i: number) => (i ? l.replace(/\t[01]$/, "\t1") : l)).join("\n");
    expect(run(c, { data: flat, design: "fuzzy" }).text).toMatch(/does not jump at the cutoff/);
    // Constant outcome: the IK rule refuses by name; an entered bandwidth gives a zero jump.
    const constY = FIX.defaults.rd.split("\n").map((l: string, i: number) => (i ? l.replace(/\t[^\t]+\t/, "\t7\t") : l)).join("\n");
    expect(run(c, { data: constY }).ok).toBe(false);
    // An exactly linear outcome: the jump is printed with the caveat (rounding-level SE) or refused (zero SE).
    const exact = "x\ty\n" + Array.from({ length: 12 }, (_, i) => `${i}\t${i * 2 + (i >= 6 ? 3 : 0)}`).join("\n");
    const ex = run(c, { data: exact, outcome: "y", running: "x", cutoff: "6", bandwidth: "4" });
    expect(ex.ok === false ? ex.text : ex.text).toMatch(/exact/);
  });
});

describe("synthetic control", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each(FIX.sc.map((c: any) => [`${c.data}${c.start ? ` from ${c.start}` : ""}`, c]) as [string, any][])("%s vs cvxpy", (_name, c) => {
    const name: string = c.data;
    const text = name === "default" ? FIX.defaults.sc : FIX.scData[name];
    const p = parseRegData(text);
    if (!p.ok) throw new Error(p.reason);
    const names = p.data.names.slice(1);
    const s = selectColumns(p.data, { dep: p.data.names[0], preds: names, text: "" });
    if (!s.ok) throw new Error(s.reason);
    const periods = Array.from(s.cols.y);
    const Y = periods.map((_, t) => s.cols.X.map((col) => col[t]));
    const T0 = periods.filter((v) => v < (c.start ?? (name === "default" ? 2010 : 2008))).length;
    const r = synthControl(periods, Y, names, T0, true);
    if ("error" in r) throw new Error(r.error);
    expect(rel(r.pre, c.pre)).toBeLessThan(1e-5);
    expect(rel(r.post, c.post)).toBeLessThan(1e-5);
    r.synth.forEach((v, t) => expect(Math.abs(v - c.synth[t])).toBeLessThan(1e-4));
    expect(r.rank).toBe(c.rank);
    expect(r.p).toBeCloseTo(c.p, 12);
    // A placebo that fits its pre-period almost exactly (RMSPE ~10⁻⁶, where the ridge decides the weights) has a huge
    // ratio that two solvers agree on to ~10⁻³ only; the ranks above are exact.
    r.placebos!.forEach((pl, j) => expect(rel(pl.ratio, c.placeboRatios[j])).toBeLessThan(5e-3));
    expect(Math.abs(r.w.reduce((a, v) => a + v, 0) - 1)).toBeLessThan(1e-12);
    expect(r.w.every((v) => v >= 0)).toBe(true);
  });

  test("the calculator prints the oracle's default numbers", () => {
    const o = run(calc("causal-synth"));
    const c = FIX.sc[0];
    expect(o.text).toContain(`pre-period RMSPE = ${c.pre.toFixed(3)}`);
    expect(o.text).toContain(`ranks ${c.rank} of 13, permutation p = ${c.rank}/13`);
  });

  test("hostile inputs refuse by field name", () => {
    const c = calc("causal-synth");
    expect(run(c, { treated: "" }).text).toMatch(/^Treated unit/);
    expect(run(c, { treated: "Region Z" }).text).toMatch(/^Treated unit: No column/);
    expect(run(c, { treated: "Year" }).text).toMatch(/period column/);
    expect(run(c, { donors: "Region B" }).text).toMatch(/at least 2/);
    expect(run(c, { donors: "Region B + Region A" }).text).toMatch(/treated unit; it cannot also be a donor/);
    expect(run(c, { donors: "Region B + Region B" }).text).toMatch(/listed twice/);
    expect(run(c, { donors: "Region B ++ Region C" }).text).toMatch(/^Donor units/);
    expect(run(c, { start: "" }).text).toMatch(/^First treated period/);
    expect(run(c, { start: "1991" }).text).toMatch(/^First treated period: only 1 period/);
    expect(run(c, { start: "2030" }).text).toMatch(/^First treated period: no period/);
    expect(run(c, { start: "1e400" }).text).toMatch(/^First treated period/);
    expect(run(c, { placebo: "maybe" }).text).toMatch(/^Placebo/);
    expect(run(c, { placebo: "no" }).text).toMatch(/not run/);
    const unsorted = FIX.defaults.sc.split("\n");
    [unsorted[3], unsorted[4]] = [unsorted[4], unsorted[3]];
    expect(run(c, { data: unsorted.join("\n") }).text).toMatch(/must increase/);
    expect(run(c, { data: "1\t2\n3\t4" }).text).toMatch(/header row/);
    // Adversarial-pass regressions: a constant panel (all gaps zero) refused, not ranked "p = 1/13" on rounding noise;
    // ISO dates in the period column refused with the period rule.
    const constant = FIX.defaults.sc.split("\n").map((l: string, i: number) => (i ? l.split("\t").map((v: string, j: number) => (j ? "5" : v)).join("\t") : l));
    expect(run(c, { data: constant.join("\n") }).text).toMatch(/reproduces “Region A” exactly/);
    const dated = FIX.defaults.sc.split("\n").map((l: string, i: number) => (i ? l.replace(/^(\d+)/, "$1-01-01") : l));
    expect(run(c, { data: dated.join("\n") }).text).toMatch(/period column must hold numbers/);
    expect(run(c, { start: "1992" }).text).toMatch(/Only 2 pre-treatment periods/);
  });
});

describe("propensity score", () => {
  const { y: Y, X: Xall } = cols(FIX.defaults.ps, "earnings", ["training", "age", "educ", "income"]);
  const T = Xall[0];
  const X = T.map((_, i) => [Xall[1][i], Xall[2][i], Xall[3][i]]);
  const sc = logitScore(T, X, ["age", "educ", "income"]);
  if ("error" in sc) throw new Error(sc.error);

  test("logit p̂ vs statsmodels Logit", () => {
    sc.e.forEach((v, i) => expect(Math.abs(v - FIX.psScore.e[i])).toBeLessThan(1e-7));
  });

  test("matching vs the brute-force numpy matcher", () => {
    let sd = 0;
    const m = sc.eta.reduce((a, v) => a + v, 0) / sc.eta.length;
    for (const v of sc.eta) sd += (v - m) ** 2;
    sd = Math.sqrt(sd / (sc.eta.length - 1));
    const scE =logitScore(T, X.map((row) => [row[1]]), ["educ"]);
    if ("error" in scE) throw new Error(scE.error);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of FIX.ps.filter((c: any) => c.method === "match" && !c.trim)) {
      const eta = c.covariates === "educ" ? scE.eta : sc.eta;
      const r = psMatch(eta, T, Y, c.estimand, c.k, c.replace, c.caliper === null ? Infinity : c.caliper * sd);
      if ("error" in r) throw new Error(r.error);
      expect(Math.abs(r.est - c.est)).toBeLessThan(1e-9);
      r.w.forEach((v, i) => expect(Math.abs(v - c.w[i])).toBeLessThan(1e-9));
    }
  });

  test("IPW vs the numerical-Jacobian sandwich", () => {
    const Xc = X.map((row) => [1, ...row]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of FIX.ps.filter((c: any) => c.method === "ipw" && !c.trim)) {
      const r = psIpw(Xc, T, Y, sc.e, c.estimand, c.weights);
      if ("error" in r) throw new Error(r.error);
      expect(rel(r.est, c.est)).toBeLessThan(1e-9);
      expect(rel(r.se, c.se)).toBeLessThan(1e-5);
    }
  });

  test("the calculator's trimming paths (trim, refit, estimate) vs the oracle", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crump = FIX.ps.find((c: any) => c.trim === "crump");
    const o = run(calc("causal-pscore"), { method: "ipw", estimand: "ate", trim: "crump" });
    expect(o.text).toContain(`ATE = ${crump.est.toFixed(3)} (SE ${crump.se.toFixed(3)})`);
    expect(o.text).toContain(`Trimming: ${crump.trimmed} row`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ov = FIX.ps.find((c: any) => c.trim === "overlap");
    const o2 = run(calc("causal-pscore"), { trim: "overlap" });
    expect(o2.text).toContain(`ATT = ${ov.est.toFixed(3)}`);
    expect(o2.text).toContain(`Trimming: ${ov.trimmed} row`);
  });

  test("hostile inputs refuse by field name", () => {
    const c = calc("causal-pscore");
    expect(run(c, { covariates: "" }).text).toMatch(/^Covariates/);
    expect(run(c, { covariates: "age ++ educ" }).text).toMatch(/^Covariates/);
    expect(run(c, { treatment: "age" }).text).toMatch(/^Covariates: “age” is the treatment column/);
    expect(run(c, { treatment: "age", covariates: "educ + income" }).text).toMatch(/^Treatment column “age”: data row 1/);
    expect(run(c, { covariates: "earnings + age" }).text).toMatch(/^Covariates: “earnings” is the outcome/);
    expect(run(c, { treatment: "" }).text).toMatch(/^Treatment column/);
    expect(run(c, { outcome: "" }).text).toMatch(/^Outcome column/);
    expect(run(c, { caliper: "0" }).text).toMatch(/^Caliper/);
    expect(run(c, { caliper: "-1" }).text).toMatch(/^Caliper/);
    expect(run(c, { caliper: "abc" }).text).toMatch(/^Caliper/);
    expect(run(c, { caliper: "0,2" }).ok).not.toBe(false);
    expect(run(c, { caliper: "1e-9" }).text).toMatch(/caliper/);
    expect(run(c, { neighbors: "6" }).text).toMatch(/^Neighbors per unit/);
    expect(run(c, { neighbors: "2", replace: "no" }).text).toMatch(/^Neighbors per unit/);
    expect(run(c, { estimand: "ate", replace: "no" }).text).toMatch(/ATT only/);
    expect(run(c, { method: "x" }).text).toMatch(/^Method/);
    expect(run(c, { weights: "x" }).text).toMatch(/^IPW weights/);
    expect(run(c, { trim: "x" }).text).toMatch(/^Trimming/);
    // Perfect separation: income decides training.
    const sep = FIX.defaults.ps
      .split("\n")
      .map((l: string, i: number) => {
        if (!i) return l;
        const f = l.split("\t");
        f[4] = f[1] === "1" ? "90" : "10";
        return f.join("\t");
      })
      .join("\n");
    expect(run(c, { data: sep }).text).toMatch(/^The propensity-score logit cannot be estimated/);
  });
});

describe("the pane's contract and the time budget", () => {
  test.each(CAUSAL_STAT_CALCS.map((c) => [c.id, c]))("%s defaults: insertable, ≤ 6 columns, select defaults valid", (_id, c) => {
    for (const f of c.fields) if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
    const variants: Record<string, string>[] = [{}, { design: "fuzzy" }, { method: "ipw" }, { method: "ipw", estimand: "ate", weights: "ht" }, { placebo: "no" }, { order: "2", bandwidth: "12" }];
    for (const v of variants) {
      const o = run(c, v);
      expect(o.ok).not.toBe(false);
      expect(insertableResultText(o.text)).toBe(true);
      expect(o.text).not.toMatch(/NaN|Infinity|undefined|e[+-]\d/);
      expect(o.svg).toBeTruthy();
      for (const t of o.tables ?? []) {
        expect(t.rows[0].length).toBeLessThanOrEqual(6);
        for (const row of t.rows) for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    }
  });

  test("ids are unique and lowercase kebab", () => {
    const ids = CAUSAL_STAT_CALCS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s + 0.5) / 4294967296;
    };
  }

  test(`RD at the cap (${RD_MAX_ROWS} rows) within 300 ms`, () => {
    const u = lcg(1);
    const lines = ["x\ty\tt"];
    for (let i = 0; i < RD_MAX_ROWS; i++) {
      const x = u() * 200 - 100;
      const t = u() < (x >= 0 ? 0.8 : 0.2) ? 1 : 0;
      lines.push(`${x.toFixed(4)}\t${(5 + 0.02 * x + 2 * t + u()).toFixed(4)}\t${t}`);
    }
    const data = lines.join("\n");
    const c = calc("causal-rdd");
    run(c, { data, outcome: "y", running: "x", treatment: "t", cutoff: "0", design: "fuzzy" });
    const t0 = Date.now();
    const o = run(c, { data, outcome: "y", running: "x", treatment: "t", cutoff: "0", design: "fuzzy" });
    expect(o.ok).not.toBe(false);
    expect(Date.now() - t0).toBeLessThan(300);
    const over = lines.concat(["1\t1\t1"]).join("\n");
    expect(run(c, { data: over, outcome: "y", running: "x", treatment: "t", cutoff: "0" }).text).toMatch(/at most 20,000/);
  });

  test(`synthetic control at the caps (${SC_MAX_DONORS} donors, ${SC_MAX_PERIODS} periods, placebos) within 300 ms`, () => {
    const u = lcg(2);
    const J = SC_MAX_DONORS;
    const T = SC_MAX_PERIODS;
    const load = Array.from({ length: J }, () => [u(), u(), u()]);
    const f = [0, 0, 0];
    const head = ["t", "Treated", ...Array.from({ length: J }, (_, j) => `U${j + 1}`)];
    const lines = [head.join("\t")];
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) f[k] += u() - 0.5;
      const ys = load.map((l) => 10 + l[0] * f[0] + l[1] * f[1] + l[2] * f[2] + 0.1 * u());
      const tr = 0.3 * ys[0] + 0.3 * ys[5] + 0.4 * ys[11] + 0.05 * u() - (t >= 150 ? 1 : 0);
      lines.push([String(t + 1), tr.toFixed(4), ...ys.map((v) => v.toFixed(4))].join("\t"));
    }
    const data = lines.join("\n");
    const c = calc("causal-synth");
    const args = { data, period: "t", treated: "Treated", start: "151" };
    const t0 = Date.now();
    const o = run(c, args);
    expect(o.ok).not.toBe(false);
    expect(Date.now() - t0).toBeLessThan(300);
    // Few pre-periods, many donors (the non-unique case) at the donor cap.
    const t1 = Date.now();
    const o2 = run(c, { ...args, start: "6" });
    expect(o2.ok).not.toBe(false);
    expect(Date.now() - t1).toBeLessThan(300);
  });

  test(`propensity score at the cap (${PS_MAX_ROWS} rows) within 300 ms`, () => {
    const u = lcg(3);
    const lines = ["y\tt\tx1\tx2\tx3"];
    for (let i = 0; i < PS_MAX_ROWS; i++) {
      const x1 = u();
      const x2 = u();
      const x3 = Math.floor(u() * 5);
      const t = u() < 0.2 + 0.5 * x1 ? 1 : 0;
      lines.push(`${(x1 + x2 + t + u()).toFixed(4)}\t${t}\t${x1.toFixed(4)}\t${x2.toFixed(4)}\t${x3}`);
    }
    const data = lines.join("\n");
    const c = calc("causal-pscore");
    const base = { data, outcome: "y", treatment: "t", covariates: "x1 + x2 + x3" };
    const variants: Record<string, string>[] = [{ replace: "no" }, { estimand: "ate", neighbors: "5" }, { method: "ipw", estimand: "ate" }];
    for (const v of variants) {
      const t0 = Date.now();
      const o = run(c, { ...base, ...v });
      expect(o.ok).not.toBe(false);
      expect(Date.now() - t0).toBeLessThan(300);
    }
  });
});
