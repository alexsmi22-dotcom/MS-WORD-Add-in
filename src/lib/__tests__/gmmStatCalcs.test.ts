/**
 * Release F3 gap #19 registry (src/lib/gmmStatCalcs.ts, engines in gmm.ts): the pane's read path (fields AS TYPED,
 * statSpreadContract's run()), the oracle fixture (scripts/gmm-oracle.py: linearmodels 7.1 IVGMM, pydynpd 0.2.2 and
 * the independent numpy implementation scripts/gmm_np.py, which reproduces Roodman's published abdata tables), the
 * display contract at every select option, hostile inputs, refusals by field, caps and timing.
 */
import * as fs from "fs";
import * as path from "path";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";
import { GMM_STAT_CALCS, DYN_DEFAULT_TABLE, coefText, rowFormat, tickKeyNotes, dynFitFromRead, econGmmFitFromRead } from "../gmmStatCalcs";
import { ivDefaultTable } from "../ivCalcs";
import { fmtFixed } from "../regTable";
import { symEigen, symInverse } from "../gmm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gmm-oracle.json"), "utf8"));

const calc = (id: string): StatCalcDef => {
  const c = GMM_STAT_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
/** statSpreadContract's run(): every field as typed. */
function run(c: StatCalcDef | string, over: Record<string, string> = {}): StatOutput {
  const cc = typeof c === "string" ? calc(c) : c;
  return cc.compute((k) => over[k] ?? cc.fields.find((f) => f.key === k)?.default ?? "");
}
const reader = (c: string, over: Record<string, string>) => (k: string): string => over[k] ?? calc(c).fields.find((f) => f.key === k)?.default ?? "";
function close(a: ArrayLike<number>, b: ArrayLike<number>, rtol: number, atol = 1e-9): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const tol = atol + rtol * Math.abs(b[i]);
    if (!(Math.abs(a[i] - b[i]) <= tol)) throw new Error(`element ${i}: ${a[i]} vs ${b[i]} (tol ${tol})`);
  }
}
const dataOf = (d: string): string => (d === "@iv-default" ? FX.defaults.iv : d === "@dyn-default" ? FX.defaults.dyn : d);

describe("contract (as statSpreadContract runs it)", () => {
  test.each(GMM_STAT_CALCS.map((c) => [c.id, c] as const))("%s: defaults insertable, ≤ 6 columns, selects valid, a figure", (_id, c) => {
    for (const f of c.fields) if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
    const o = run(c);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.svg).toBeTruthy();
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const x of row) if (x !== "") expect(insertableResultText(x)).toBe(true);
      }
    }
  });
  test("ids unique, registry form, no Math.random", () => {
    const ids = GMM_STAT_CALCS.map((c) => c.id);
    expect(ids).toEqual(["econ-gmm", "panel-dyn-gmm"]);
    const src = fs.readFileSync(path.join(__dirname, "..", "gmmStatCalcs.ts"), "utf8").replace(/\r\n/g, "\n");
    for (const id of ids) expect(src).toMatch(new RegExp(`^ {4}id: "${id}",`, "m"));
    expect(src.match(/compute: \(r\) => \{\n\s+\/\/ .+\n\s+return \w+Calc\(r\);/g)?.length).toBe(ids.length);
    for (const f of ["gmmStatCalcs.ts", "gmm.ts"]) expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
  });
  test("the default tables are exactly the text the oracle fitted (the generators are ported bit for bit)", () => {
    expect(ivDefaultTable()).toBe(FX.defaults.iv);
    expect(DYN_DEFAULT_TABLE).toBe(FX.defaults.dyn);
  });
});

// ---------------------------------------------------------------------------------------------------- oracles

describe("econ-gmm against linearmodels 7.1 IVGMM (numpy cross-checked in the script)", () => {
  test.each((FX.linear as { label: string }[]).map((c) => [c.label, c] as [string, any]))("%s", (_l, c) => {
    const r = econGmmFitFromRead(reader("econ-gmm", { ...c.fields, data: dataOf(c.data) }));
    if ("error" in r) throw new Error(r.error);
    expect(r.names).toEqual(c.names);
    close(r.r.gmm.b, c.b, 1e-8, 1e-10);
    close(r.r.gmm.se, c.se, 1e-7, 1e-10);
    close(r.r.tsls.b, c.tslsB, 1e-8, 1e-10);
    close(r.r.tsls.se, c.tslsSe, 1e-7, 1e-10);
    expect(r.r.jdf).toBe(c.jdf);
    expect(Math.abs(r.r.j - c.j)).toBeLessThan(1e-7 * Math.max(1, c.j));
    // First stage (linearmodels' first_stage.diagnostics): partial R² and the robust or clustered Wald χ²(q).
    expect(r.r.firstStage.map((f) => f.name)).toEqual(c.firstStage.map((f: { name: string }) => f.name));
    r.r.firstStage.forEach((f, i) => {
      expect(Math.abs(f.partialR2 - c.firstStage[i].partialR2)).toBeLessThan(1e-9);
      expect(Math.abs(f.wald - c.firstStage[i].wald)).toBeLessThan(1e-7 * c.firstStage[i].wald);
      expect(c.firstStage[i].dist).toBe(`chi2(${f.df})`);
    });
  });
  test("printed default: the coefficient table and J line", () => {
    const c = FX.linear[0];
    const o = run("econ-gmm");
    const row = o.tables![0].rows.find((x) => x[0] === "educ")!;
    expect(row[1]).toBe(fmtFixed(c.b[0], 4));
    expect(row[2]).toBe(fmtFixed(c.se[0], 4));
    expect(o.text).toContain(`J = ${fmtFixed(c.j, 3)}, χ²(1)`);
  });
});

describe("panel-dyn-gmm against gmm_np (Roodman's definitions) and pydynpd 0.2.2", () => {
  test.each((FX.dynamic as { label: string }[]).map((c) => [c.label, c] as [string, any]))("%s", (_l, c) => {
    const r = dynFitFromRead(reader("panel-dyn-gmm", { ...c.fields, data: dataOf(c.data) }));
    if ("error" in r) throw new Error(r.error);
    const f = r.fit;
    const np = c.np;
    expect(f.L).toBe(np.L);
    expect(f.df).toBe(np.df);
    expect(f.nObs).toBe(np.nObs);
    expect(f.N).toBe(np.N);
    expect(r.des.names.length).toBe(np.names.length);
    expect(r.des.droppedDummies).toEqual(np.dropped);
    close(f.one.b, np.b1, 1e-7);
    close(f.one.se, np.se1, 1e-6);
    expect(Math.abs(f.sargan - np.sargan)).toBeLessThan(1e-6 * Math.max(1, np.sargan));
    close(f.one.ar.map((a) => a.z), np.ar1, 1e-6);
    if (np.twoStepRefused) {
      // A singular two-step weight (more instruments than groups): two-step and Hansen J refused by name, one-step
      // reported (pydynpd's one-step agrees where its parameterization is the same, no time dummies).
      expect(f.two).toBeNull();
      expect(f.singularS).toBe(true);
      expect(Number.isNaN(f.hansen)).toBe(true);
      expect(f.twoWhy).toMatch(/^the two-step weight matrix would be singular: Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ, one outer product per group, has rank at most the 60 groups, fewer than the \d+ instruments, so the two-step estimate and Hansen J would depend on an arbitrary choice of generalized inverse/);
      if (c.pydynpdOneStep) {
        close(f.one.b, c.pydynpdOneStep.b, 1e-7);
        close(f.one.se, c.pydynpdOneStep.se, 1e-6);
      }
      const o = run("panel-dyn-gmm", { ...c.fields, data: dataOf(c.data) });
      expect(o.ok).not.toBe(false);
      expect(o.text).toContain("Two-step GMM not computed: the two-step weight matrix would be singular");
      expect(o.text).toContain("Hansen J not computed (it is the two-step criterion; see above).");
      expect(o.tables![0].label).toContain(", one-step: ");
      expect(o.tables![0].rows[0][2]).toBe("Robust SE");
      expect(o.tables![0].rows.find((x) => x[0] === "L.sales")![1]).toBe(fmtFixed(np.b1[0], 4));
      expect(o.tables![1].rows.find((x) => x[0] === "Hansen J")![4]).toMatch(/^two-step weight singular: \d+ instruments, 60 groups$/);
      return;
    }
    close(f.two!.b, np.b2, 1e-7);
    close(f.two!.se, np.se2, 1e-6);
    close(f.two!.seUncorrected!, np.se2u, 1e-6);
    expect(f.singularS).toBe(false);
    expect(Math.abs(f.hansen - np.hansen)).toBeLessThan(1e-6 * Math.max(1, np.hansen));
    close(f.two!.ar.map((a) => a.z), np.ar2, 1e-6);
    if (c.pydynpd) {
      const p = c.pydynpd;
      expect(f.L).toBe(p.two.L);
      close(f.one.b, p.one.b, 1e-7);
      close(f.one.se, p.one.se, 1e-6);
      close(f.two!.b, p.two.b, 1e-7);
      close(f.two!.se, p.two.se, 1e-6);
      expect(Math.abs(f.hansen - p.two.hansen)).toBeLessThan(1e-6 * Math.max(1, p.two.hansen));
      close(f.two!.ar.map((a) => a.z), p.two.ar, 1e-6);
    }
  });
  test("printed default: ρ row, tests table, instrument count", () => {
    const c = FX.dynamic[0];
    const o = run("panel-dyn-gmm");
    const row = o.tables![0].rows.find((x) => x[0] === "L.sales")!;
    expect(row[1]).toBe(fmtFixed(c.np.b2[0], 4));
    expect(row[2]).toBe(fmtFixed(c.np.se2[0], 4));
    expect(o.text).toContain(`Instruments: ${c.np.L}.`);
    expect(o.text).toContain(`Hansen χ²(${c.np.df}) = ${fmtFixed(c.np.hansen, 2)}`);
    expect(o.text).toContain(`Sargan χ²(${c.np.df}) = ${fmtFixed(c.np.sargan, 2)}`);
    expect(o.text).toContain("bracket the GMM estimate");
  });
});

// ---------------------------------------------------------------------------------------------------- display

const cases: [string, string, Record<string, string>][] = [];
for (const c of GMM_STAT_CALCS) {
  cases.push([`${c.id} defaults`, c.id, {}]);
  for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) if (o.value !== f.default && !(f.key === "weight" && o.value === "cluster")) cases.push([`${c.id} ${f.key}=${o.value}`, c.id, { [f.key]: o.value }]);
}
// The clustered weight needs a cluster column, which the default table does not have: the synthetic oracle case has one.
cases.push(["econ-gmm clustered", "econ-gmm", { ...FX.linear[3].fields, data: FX.linear[3].data }]);
cases.push(["panel-dyn-gmm endogenous, difference, one-step", "panel-dyn-gmm", { endog: "price", estimator: "difference", steps: "one" }]);
const BRITISH =
  /\b\w*(?:realis|maximis|minimis|utilis|standardis|normalis|recognis|criticis|organis|summaris|optimis|parametris|parameteris|orthogonalis|regularis|generalis|annualis|penalis|randomis|stabilis|capitalis|categoris|amortis|equalis|neutralis|subsidis|visualis|favour|labour|behaviour|colour|honour|neighbour|centre|centred|programme|licence|catalogue|labelled|labelling)\w*/i;

describe("display sweep: no _ or ^, US spelling, true minus, no em dash or non-finite text", () => {
  test.each(cases)("%s", (_label, id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    const strings = [o.text, ...(o.tables ?? []).flatMap((t) => [...t.rows.flat(), t.label ?? "", t.note ?? ""])];
    for (const s of strings) {
      expect(s).not.toMatch(/[_^]/);
      const m = s.match(BRITISH);
      expect(m ? m[0] : null).toBeNull();
      expect(s).not.toMatch(/-\d/); // a hyphen-minus before a digit: numbers carry the true minus "−"
      expect(s).not.toContain("—");
      expect(s).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------- hostile inputs

/** A small dynamic panel (deterministic, no randomness): N entities × T periods. */
function panel(N: number, T: number, f: (i: number, t: number) => [number, number] | null, header = "id\tyear\ty\tx"): string {
  const lines = [header];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < T; t++) {
      const v = f(i, t);
      if (v) lines.push(`e${i}\t${2000 + t}\t${v[0].toFixed(4)}\t${v[1].toFixed(4)}`);
    }
  }
  return lines.join("\n");
}
// A deterministic dynamic process (sines as the "shocks").
const shock = (i: number, t: number, s: number): number => Math.sin(1.7 * i + 2.3 * t + s) + 0.5 * Math.sin(0.37 * i * t + s);
function dynPanel(N: number, T: number, drop?: (i: number, t: number) => boolean): string {
  const ys: number[][] = [];
  return panel(N, T, (i, t) => {
    if (!ys[i]) ys[i] = [];
    const x = shock(i, t, 1);
    const prev = t === 0 ? Math.sin(i) * 2 : ys[i][t - 1];
    ys[i][t] = 0.5 * prev + 0.4 * x + Math.sin(i * 0.9) + shock(i, t, 3);
    if (drop && drop(i, t)) return null;
    return [ys[i][t], x];
  });
}
const DYN = { spec: "y ~ L.y + x", entity: "id", time: "year", endog: "", lagLast: "" };

describe("panel-dyn-gmm hostile inputs and refusals", () => {
  test("T < 3 is refused by name", () => {
    const o = run("panel-dyn-gmm", { ...DYN, data: dynPanel(30, 2) });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/2 periods; a dynamic panel needs at least 3/);
  });
  test("an unbalanced panel with gaps and a group with one period runs; the lone group is left out", () => {
    const data = dynPanel(40, 8, (i, t) => (i === 3 ? t !== 4 : (i * 7 + t * 3) % 11 === 0));
    const o = run("panel-dyn-gmm", { ...DYN, data });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("1 entity has no usable row");
    const r = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data }));
    if ("error" in r) throw new Error(r.error);
    expect(r.fit.N).toBe(39);
  });
  test("a perfectly collinear regressor is refused by name", () => {
    const data = dynPanel(30, 6).split("\n").map((l, i) => (i === 0 ? `${l}\tx2` : `${l}\t${(2 * Number(l.split("\t")[3])).toFixed(4)}`)).join("\n");
    const o = run("panel-dyn-gmm", { ...DYN, spec: "y ~ L.y + x + x2", data });
    expect(o.ok).toBe(false);
    expect(o.text).toContain("The regressor x2 is perfectly collinear");
  });
  test("a constant response is refused by name", () => {
    const o = run("panel-dyn-gmm", { ...DYN, data: panel(20, 6, (i, t) => [5, Math.sin(i + t)]) });
    expect(o.ok).toBe(false);
    expect(o.text).toContain("The response “y” is constant");
  });
  test("instruments far beyond the groups: a warning, two-step refused by name, the one-step results reported", () => {
    const o = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), timeDummies: "no" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Warning: \d+ instruments exceed the 12 groups/);
    expect(o.text).toMatch(/Two-step GMM not computed: the two-step weight matrix would be singular: Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ, one outer product per group, has rank at most the 12 groups, fewer than the \d+ instruments/);
    expect(o.text).toMatch(/^Difference GMM \(Arellano–Bond\), one-step: |^System GMM \(Blundell–Bond\), one-step: /);
    expect(o.text).not.toMatch(/Hansen χ²/);
    // With time dummies there are more coefficients (13) than groups (12): the cluster-robust covariance has rank at
    // most 11, so both one-step and two-step are refused by name (before, one-step printed SEs from a singular matrix).
    for (const steps of ["two", "one"]) {
      const o2 = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), steps });
      expect(o2.ok).toBe(false);
      expect(o2.text).toMatch(/^The panel has 12 groups for 13 coefficients: the group scores sum to zero at the estimate, so the cluster-robust covariance has rank at most 11/);
    }
    // Collapsing brings the count under the groups.
    const c = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), collapse: "yes", timeDummies: "no", lagLast: "4" });
    expect(c.text).not.toContain("Warning:");
  });
  test("the lagged response is required; lag syntax and fields are checked by name", () => {
    expect(run("panel-dyn-gmm", { ...DYN, spec: "y ~ x", data: dynPanel(20, 6) }).text).toContain("needs the lagged response L.y");
    expect(run("panel-dyn-gmm", { ...DYN, spec: "y ~ L.y + y", data: dynPanel(20, 6) }).text).toContain("is the response; on the right of ~ it can only appear lagged");
    expect(run("panel-dyn-gmm", { ...DYN, spec: "y ~ L.y + L9.x", data: dynPanel(20, 6) }).text).toContain("lags up to 3");
    expect(run("panel-dyn-gmm", { ...DYN, spec: "y ~ L.y + L(2/0).x", data: dynPanel(20, 6) }).text).toContain("low to high");
    expect(run("panel-dyn-gmm", { ...DYN, lagFirst: "1", data: dynPanel(20, 6) }).text).toMatch(/^First instrument lag/);
    expect(run("panel-dyn-gmm", { ...DYN, lagFirst: "3", lagLast: "2", data: dynPanel(20, 6) }).text).toMatch(/^Last instrument lag/);
    expect(run("panel-dyn-gmm", { ...DYN, endog: "zz", data: dynPanel(20, 6) }).ok).toBe(false);
    expect(run("panel-dyn-gmm", { ...DYN, endog: "y", data: dynPanel(20, 6) }).text).toContain("is the response");
    expect(run("panel-dyn-gmm", { ...DYN, data: "" }).ok).toBe(false);
    expect(run("panel-dyn-gmm", { ...DYN, entity: "", data: dynPanel(20, 6) }).text).toContain("entity column");
    expect(run("panel-dyn-gmm", { ...DYN, estimator: "fod", data: dynPanel(20, 6) }).text).toMatch(/^Estimator/);
  });
  test("AR(2) wording follows the first instrument lag; the pydynpd sample note appears for system GMM from lag 3", () => {
    const two = run("panel-dyn-gmm");
    expect(two.text).toContain("AR(2) rejecting means the errors in levels are serially correlated, so lag 2 instruments are invalid (start the instruments at lag 3).");
    const three = run("panel-dyn-gmm", { lagFirst: "3", lagLast: "5" });
    expect(three.ok).not.toBe(false);
    expect(three.text).toContain("with the instruments starting at lag 3, AR(2) is tolerated (MA(1) errors in levels), but AR(3) would invalidate them");
    expect(three.text).not.toContain("lag 3 instruments are invalid");
    expect(three.tables![1].rows.find((x) => x[0] === "Arellano–Bond AR(2)")![4]).toBe("tolerated: instruments start at lag 3");
    expect(three.text).toContain("pydynpd also starts the level equation at the first period whose level instrument (dated 2 back) exists");
    expect(two.text).not.toContain("pydynpd also starts the level equation");
  });
  test("dates are not periods; quarters are", () => {
    const d = dynPanel(25, 6).replace(/\t(200\d)\t/g, (_m, y) => `\t${y}-03-31\t`);
    expect(run("panel-dyn-gmm", { ...DYN, data: d }).text).toContain("holds dates");
    // Dates written as yyyymmdd (Compustat's datadate) read as whole numbers: the span refusal says what they are.
    const ymd = dynPanel(25, 6).replace(/\t(200\d)\t/g, (_m, y) => `\t${y}0331\t`);
    const oy = run("panel-dyn-gmm", { ...DYN, data: ymd });
    expect(oy.ok).toBe(false);
    expect(oy.text).toBe(
      "The time column spans 50,001 periods from first to last (gaps included); this calculator allows 40. Its values look like dates written as yyyymmdd (“20000331”), read here as whole numbers: convert the column to a year (or fiscal year) or a period number (1, 2, 3…), or to quarters (2015 Q1) or months (2015-03), and fit again.",
    );
    // Large period numbers that are not dates keep the plain refusal.
    const big = dynPanel(25, 6).replace(/\t200(\d)\t/g, (_m, k) => `\t${100 * Number(k)}\t`);
    expect(run("panel-dyn-gmm", { ...DYN, data: big }).text).toBe("The time column spans 501 periods from first to last (gaps included); this calculator allows 40.");
    const qd = dynPanel(25, 6).replace(/\t200(\d)\t/g, (_m, k) => `\t2020 Q${(Number(k) % 4) + 1}\t`.replace("2020", String(2020 + Math.floor(Number(k) / 4))));
    const o = run("panel-dyn-gmm", { ...DYN, data: qd });
    expect(o.ok).not.toBe(false);
    // Six consecutive quarters read as six consecutive periods: same estimate as the years.
    const a = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data: qd }));
    const b = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data: dynPanel(25, 6) }));
    if ("error" in a || "error" in b) throw new Error("refused");
    close(a.fit.two!.b.slice(0, 2), b.fit.two!.b.slice(0, 2), 1e-10);
  });
  test("true minus, decimal commas and NA cells read as in the other panel calculators", () => {
    const base = dynPanel(30, 6);
    const minus = base.replace(/\t-/g, "\t−");
    const a = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data: minus }));
    const b = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data: base }));
    if ("error" in a || "error" in b) throw new Error("refused");
    close(a.fit.two!.b, b.fit.two!.b, 1e-12);
    const na = base.split("\n").map((l, i) => (i === 10 ? l.replace(/\t[^\t]+$/, "\tNA") : l)).join("\n");
    const o = run("panel-dyn-gmm", { ...DYN, data: na });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("“x”: 1 row with no value");
  });
  test("caps: too many raw instruments are refused by name, and a huge value is not NaN", () => {
    const wide = dynPanel(30, 40);
    const o = run("panel-dyn-gmm", { ...DYN, data: wide, endog: "x", lagLast: "" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/collapse/);
    const huge = dynPanel(30, 6).replace(/\n(e1\t2003\t)[^\t]+/, "\n$11e300");
    const h = run("panel-dyn-gmm", { ...DYN, data: huge });
    expect(h.ok).toBe(false);
    expect(h.text).toMatch(/^“y”, row \d+: 1×10³⁰⁰ is outside the magnitudes/);
    // More entities than the cap: refused by name before any work.
    const many = run("panel-dyn-gmm", { ...DYN, data: dynPanel(2001, 3) });
    expect(many.ok).toBe(false);
    expect(many.text).toBe("The panel has 2,001 entities; this calculator allows 2,000.");
  });
  test("timing: the default and an N = 500, T = 10 panel stay inside the pane budget", () => {
    let t0 = Date.now();
    run("panel-dyn-gmm");
    const tDefault = Date.now() - t0;
    const big = dynPanel(500, 10);
    t0 = Date.now();
    const o = run("panel-dyn-gmm", { ...DYN, data: big, lagLast: "4" });
    const tBig = Date.now() - t0;
    expect(o.ok).not.toBe(false);
    // Loose bounds for a loaded CI machine; plain Node figures are in the report.
    expect(tDefault).toBeLessThan(1500);
    expect(tBig).toBeLessThan(4000);
  });
});

describe("econ-gmm hostile inputs and refusals", () => {
  test("under-identification is refused by name", () => {
    const o = run("econ-gmm", { instruments: "dist", endog: "educ + sibs" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Under-identified: 2 endogenous regressors but 1 excluded instrument/);
  });
  test("a singular ZᵀZ (an instrument that is a multiple of another) is refused by name", () => {
    const t = FX.defaults.iv.split("\n").map((l: string, i: number) => (i === 0 ? `${l}\tdist2` : `${l}\t${(2 * Number(l.split("\t")[3])).toFixed(1)}`)).join("\n");
    const o = run("econ-gmm", { data: t, instruments: "dist + dist2" });
    expect(o.ok).toBe(false);
    expect(o.text).toContain("perfectly collinear");
  });
  test("exactly identified: J not computed, GMM equals 2SLS", () => {
    const o = run("econ-gmm", { instruments: "dist" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Exactly identified");
    const r = econGmmFitFromRead(reader("econ-gmm", { instruments: "dist" }));
    if ("error" in r) throw new Error(r.error);
    close(r.r.gmm.b, r.r.tsls.b, 1e-9);
  });
  test("roles, clusters and constants are checked by name", () => {
    expect(run("econ-gmm", { instruments: "exper" }).text).toContain("cannot be both an exogenous regressor and an excluded instrument");
    expect(run("econ-gmm", { weight: "cluster", cluster: "" }).text).toContain("Name the cluster column");
    expect(run("econ-gmm", { weight: "cluster", cluster: "educ" }).text).toContain("cannot also be the cluster column");
    expect(run("econ-gmm", { spec: "" }).ok).toBe(false);
    expect(run("econ-gmm", { endog: "nope" }).text).toMatch(/^Endogenous regressor:/);
    const flat = FX.defaults.iv.split("\n").map((l: string, i: number) => (i === 0 ? l : l.replace(/^[^\t]+/, "1.000"))).join("\n");
    expect(run("econ-gmm", { data: flat }).text).toContain("is constant");
    expect(run("econ-gmm", { data: "" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- degenerate inputs, wording

describe("degenerate inputs are refused by name; wording", () => {
  const rows = DYN_DEFAULT_TABLE.split("\n");
  const keep = (f: (r: string[]) => string[] | null): string => [rows[0], ...rows.slice(1).map((l) => f(l.split("\t"))).filter((r): r is string[] => r !== null).map((r) => r.join("\t"))].join("\n");
  test("fewer than 10 groups, or no more groups than coefficients", () => {
    for (const ids of [["F01"], ["F01", "F02", "F03"]]) {
      const o = run("panel-dyn-gmm", { data: keep((r) => (ids.includes(r[0]) ? r : null)), steps: "one" });
      expect(o.ok).toBe(false);
      expect(o.text).toBe(`The panel has ${ids.length} ${ids.length === 1 ? "group" : "groups"}; this calculator needs at least 10. Its standard errors and tests are cluster-robust, which is an approximation in the number of groups and over-rejects badly with very few (Cameron and Miller 2015).`);
    }
    const c = run("econ-gmm", { weight: "cluster", cluster: "sibs", instruments: "dist" });
    expect(c.ok).toBe(false);
    expect(c.text).toMatch(/^The cluster column “sibs”: 7 clusters; this calculator needs at least 10/);
  });
  test("clustered econ-gmm with no more clusters than instruments: two-step refused, one-step runs without J", () => {
    // 12 clusters (enough for 4 coefficients), 13 instruments: S has rank ≤ 12, so S⁻¹ does not exist.
    const syn = FX.linear[3].data.split("\n");
    const head = `${syn[0]}\tg12`;
    const wide = [head + "\t" + Array.from({ length: 9 }, (_, j) => `w${j}`).join("\t"), ...syn.slice(1).map((l: string, i: number) => `${l}\tC${i % 12}\t${Array.from({ length: 9 }, (_, j) => Math.sin(i * (j + 2) + j).toFixed(4)).join("\t")}`)].join("\n");
    const ins = "z1 + z2 + z3 + z4 + " + Array.from({ length: 9 }, (_, j) => `w${j}`).join(" + ");
    const base = { ...FX.linear[3].fields, data: wide, cluster: "g12", instruments: ins };
    const two = run("econ-gmm", base);
    expect(two.ok).toBe(false);
    expect(two.text).toMatch(/^12 clusters for 15 instruments: the clustered moment covariance has rank at most 12, so the efficient \(two-step\) weight matrix is not defined/);
    const one = run("econ-gmm", { ...base, steps: "one" });
    expect(one.ok).not.toBe(false);
    expect(one.text).toContain("Hansen J test not computed: the clustered moment covariance has rank at most the 12 clusters, fewer than the 15 instruments");
    expect(one.tables![1].label).toBe("Step 1 (2SLS, clustered SEs) beside the reported GMM estimate");
  });
  test("a response constant within every entity is refused in system GMM too", () => {
    for (const estimator of ["system", "difference"]) {
      const o = run("panel-dyn-gmm", { estimator, data: keep((r) => [r[0], r[1], r[0].slice(1), r[3]]) });
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(/^The response “sales” never changes within an entity/);
    }
  });
  test("exact fits are refused, not answered with huge z statistics", () => {
    const iv = FX.defaults.iv.split("\n");
    const h = iv[0].split("\t");
    const perfect = [iv[0], ...iv.slice(1).map((l: string) => {
      const r = l.split("\t");
      r[h.indexOf("lwage")] = String(0.1 * Number(r[h.indexOf("educ")]) + 0.02 * Number(r[h.indexOf("exper")]));
      return r.join("\t");
    })].join("\n");
    expect(run("econ-gmm", { data: perfect }).text).toMatch(/^The model fits the response exactly/);
    const out = ["id\tyear\ty\tx"];
    for (let i = 1; i <= 30; i++) {
      let y = i;
      for (let t = 0; t < 8; t++) {
        y = 0.5 * y + 1;
        out.push(`F${i}\t${2000 + t}\t${y}\t${Math.sin(i * 7 + t * 3).toFixed(4)}`);
      }
    }
    expect(run("panel-dyn-gmm", { ...DYN, data: out.join("\n"), timeDummies: "no" }).text).toMatch(/^The model fits the differenced response exactly/);
  });
  test("the time and entity columns cannot be regressors (named as regressors, not as the response)", () => {
    expect(run("panel-dyn-gmm", { spec: "sales ~ L.sales + year" }).text).toBe("“year” is the time column; it cannot be a regressor (time dummies are an option; copy the column to a new one for a trend).");
    expect(run("panel-dyn-gmm", { spec: "sales ~ L.sales + firm" }).text).toBe("“firm” is the entity column; it cannot be a regressor.");
  });
  test("Stata's lag syntax in either case and with spaces", () => {
    const ref = run("panel-dyn-gmm", { spec: "sales ~ L.sales + L(0/1).price" });
    for (const spec of ["sales ~ l.sales + l( 0 / 1 ).price", "sales ~ L. sales + L ( 0/1 ) . price"]) {
      const o = run("panel-dyn-gmm", { spec });
      expect(o.ok).not.toBe(false);
      expect(o.tables![0].rows).toEqual(ref.tables![0].rows);
    }
  });
  test("the bracket is a check with one lag of y and information with two", () => {
    expect(run("panel-dyn-gmm").text).toContain("Bracket check on the coefficient of L.sales");
    const two = run("panel-dyn-gmm", { spec: "sales ~ L.sales + L2.sales + price", estimator: "difference", lagLast: "" });
    expect(two.ok).not.toBe(false);
    expect(two.text).toMatch(/For information, the coefficient of L\.sales: fixed effects .*with 2 lags the biases are shared/);
    expect(two.text).not.toContain("suspect weak or invalid instruments");
  });
  test("many instruments: no Hansen J from a singular weight (its p near 1 was an artifact of the pseudo-inverse); one-step Sargan in system GMM is not χ²", () => {
    const o = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), timeDummies: "no" });
    expect(o.text).not.toMatch(/Hansen χ²|Caution: a Hansen p-value/);
    // Just enough groups for a full-rank weight (56 instruments, 57 groups): Hansen J is computed and unremarkable.
    const f = dynFitFromRead(reader("panel-dyn-gmm", { ...DYN, data: dynPanel(57, 12), timeDummies: "no", estimator: "difference" }));
    if ("error" in f) throw new Error(f.error);
    expect(f.fit.L).toBe(56);
    expect(f.fit.two).not.toBeNull();
    expect(f.fit.hansenP).toBeGreaterThan(0.05);
    expect(f.fit.hansenP).toBeLessThan(0.99);
    expect(run("panel-dyn-gmm").text).toContain("in system GMM it is not χ² even under homoskedastic errors");
    expect(run("panel-dyn-gmm", { estimator: "difference" }).text).not.toContain("in system GMM it is not χ²");
  });
  test("caps are checked on the plan, before any row is built, and refusals are fast", () => {
    const wide = dynPanel(60, 40);
    const t0 = Date.now();
    const o = run("panel-dyn-gmm", { ...DYN, data: wide, endog: "x", lagLast: "17" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^The instrument set would have about [\d,]+ columns; this calculator allows 300/);
    const w = run("panel-dyn-gmm", { ...DYN, data: dynPanel(250, 40), lagLast: "6", timeDummies: "yes" });
    expect(w.ok).toBe(false);
    expect(w.text).toMatch(/^250 groups and [\d,]+ stacked rows with about \d+ instruments is beyond the work/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------------------------------- units

/** The table with one column multiplied by m (shortest round-trip text, as a user's rescaled column would be). */
function scaleCol(text: string, col: string, m: number): string {
  const lines = text.split("\n");
  const j = lines[0].split("\t").indexOf(col);
  if (j < 0) throw new Error(col);
  return [lines[0], ...lines.slice(1).map((l) => {
    const r = l.split("\t");
    if (r[j] !== "" && r[j] !== "NA") r[j] = String(Number(r[j]) * m);
    return r.join("\t");
  })].join("\n");
}
const MULTS = [1e-6, 1e-3, 1e3, 1e6, 1e8, 10 ** -5.75, 10 ** 4.25, 10 ** 6.25, 10 ** 7.25];
/** |a − b| within rtol of the coefficient's own size plus its SE (a coefficient near 0 is judged against its SE). */
function closeScaled(a: ArrayLike<number>, b: ArrayLike<number>, se: ArrayLike<number>, rtol: number, what: string): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const tol = rtol * (Math.abs(b[i]) + Math.abs(se[i]));
    if (!(Math.abs(a[i] - b[i]) <= tol)) throw new Error(`${what} element ${i}: ${a[i]} vs ${b[i]}`);
  }
}
const relClose = (a: number, b: number, what: string): void => {
  // Both not computed (NaN: Hansen J when two-step is refused) is agreement.
  if (Number.isNaN(a) && Number.isNaN(b)) return;
  if (!(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)))) throw new Error(`${what}: ${a} vs ${b}`);
};

describe("units: rescaling one column rescales its coefficient and changes nothing else", () => {
  const dynConfigs: Record<string, string>[] = [{}, { steps: "one" }, { estimator: "difference" }, { collapse: "yes", timeDummies: "no" }, { endog: "price" }];
  test.each(dynConfigs.map((c) => [JSON.stringify(c), c] as const))("panel-dyn-gmm %s", (_l, cfg) => {
    const ref = dynFitFromRead(reader("panel-dyn-gmm", cfg));
    if ("error" in ref) throw new Error(ref.error);
    for (const col of ["sales", "price"])
      for (const m of MULTS) {
        const f = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: scaleCol(DYN_DEFAULT_TABLE, col, m) }));
        if ("error" in f) throw new Error(`${col}×${m}: refused: ${f.error}`);
        expect(f.des.names).toEqual(ref.des.names);
        // y×m: every coefficient but the lags of y scales by m; x×m: x's coefficients scale by 1/m.
        const fac = ref.des.kinds.map((kd, j) => (col === "sales" ? (kd === "ylag" ? 1 : m) : ref.des.names[j].endsWith("price") ? 1 / m : 1));
        for (const [s, r] of [[f.fit.one, ref.fit.one], ...(ref.fit.two ? [[f.fit.two!, ref.fit.two]] : [])] as const) {
          const bu = Float64Array.from(s.b, (v, j) => v / fac[j]);
          const su = Float64Array.from(s.se, (v, j) => v / fac[j]);
          closeScaled(bu, r.b, r.se, 1e-6, `${col}×${m} b`);
          closeScaled(su, r.se, r.se, 1e-6, `${col}×${m} se`);
          s.ar.forEach((a, i) => relClose(a.z, r.ar[i].z, `${col}×${m} AR(${i + 1})`));
        }
        relClose(f.fit.hansen, ref.fit.hansen, `${col}×${m} Hansen`);
        relClose(f.fit.sargan, ref.fit.sargan, `${col}×${m} Sargan`);
        expect(f.fit.singularA1).toBe(ref.fit.singularA1);
        expect(f.fit.singularS).toBe(ref.fit.singularS);
      }
  });
  test("panel-dyn-gmm: the printed bracket on L.sales is the same at every scale", () => {
    const rows = (o: StatOutput): string[] => o.tables![2].rows.map((r) => r.slice(0, 3).join("|"));
    const base = rows(run("panel-dyn-gmm"));
    for (const col of ["sales", "price"]) for (const m of [1e-6, 10 ** 6.25, 1e8]) expect(rows(run("panel-dyn-gmm", { data: scaleCol(DYN_DEFAULT_TABLE, col, m) }))).toEqual(base);
  });
  const econConfigs: [string, Record<string, string>, string[]][] = [
    ["default two-step", {}, ["lwage", "educ", "exper", "dist", "sibs"]],
    ["default one-step", { steps: "one" }, ["lwage", "educ", "exper", "dist"]],
    ["synthetic clustered", { ...FX.linear[3].fields, data: FX.linear[3].data }, ["y", "d1", "w", "z1", "z4"]],
  ];
  test.each(econConfigs)("econ-gmm %s", (_l, cfg, cols) => {
    const ref = econGmmFitFromRead(reader("econ-gmm", cfg));
    if ("error" in ref) throw new Error(ref.error);
    const data0 = dataOf(cfg.data ?? "@iv-default");
    const dep = (cfg.spec ?? "lwage ~ exper").split("~")[0].trim();
    for (const col of cols)
      for (const m of MULTS) {
        const f = econGmmFitFromRead(reader("econ-gmm", { ...cfg, data: scaleCol(data0, col, m) }));
        if ("error" in f) throw new Error(`${col}×${m}: refused: ${f.error}`);
        const fac = ref.names.map((nm) => (col === dep ? m : nm === col ? 1 / m : 1));
        for (const [s, r] of [[f.r.gmm, ref.r.gmm], [f.r.tsls, ref.r.tsls]] as const) {
          closeScaled(Float64Array.from(s.b, (v, j) => v / fac[j]), r.b, r.se, 1e-6, `${col}×${m} b`);
          closeScaled(Float64Array.from(s.se, (v, j) => v / fac[j]), r.se, r.se, 1e-6, `${col}×${m} se`);
        }
        relClose(f.r.j, ref.r.j, `${col}×${m} J`);
        expect(f.r.singularS).toBe(false);
      }
  });
});

// ---------------------------------------------------------------------------------------------------- location

/** The table with c added to one column (shortest round-trip text of the sum, as a user's shifted column would be). */
function shiftCol(text: string, col: string, c: number): string {
  const lines = text.split("\n");
  const j = lines[0].split("\t").indexOf(col);
  if (j < 0) throw new Error(col);
  return [lines[0], ...lines.slice(1).map((l) => {
    const r = l.split("\t");
    r[j] = String(Number(r[j]) + c);
    return r.join("\t");
  })].join("\n");
}
/** A 32-bit LCG and Box–Muller normals (deterministic test data). */
function lcg(seed: number): { u: () => number; g: () => number } {
  let s = seed >>> 0;
  const u = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return { u, g: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}
/** Linear IV data: two endogenous regressors d1, d2, exogenous x, instruments z1…z3, 25 clusters. */
function linData(n: number, seed: number, xScale = 1): string {
  const r = lcg(seed);
  const L = ["y\td1\td2\tx\tz1\tz2\tz3\tcl"];
  for (let i = 0; i < n; i++) {
    const c = i % 25;
    const z1 = r.g();
    const z2 = r.g();
    const z3 = r.g() + 0.2 * r.u();
    const x = r.g();
    const u = r.g() * (1 + 0.5 * Math.abs(x)) + 0.5 * Math.sin(c);
    const d1 = 0.8 * z1 + 0.3 * z2 + 0.5 * u + r.g();
    const d2 = 0.2 * z1 + 0.7 * z3 - 0.4 * z2 + 0.3 * u + r.g();
    const y = 1 + 0.5 * d1 - 0.3 * d2 + 0.2 * x + u;
    L.push([y, d1, d2, x * xScale, z1, z2, z3].map((a) => a.toPrecision(15)).join("\t") + `\tc${c}`);
  }
  return L.join("\n");
}
/** A balanced dynamic panel with an endogenous w: y = 0.5·y₋₁ + 0.4x + 0.3w + η + ε. */
function dynPanel3(N: number, T: number, seed: number, drop?: (i: number, t: number) => boolean): string {
  const r = lcg(seed);
  const lines = ["id\tyear\ty\tx\tw"];
  for (let i = 0; i < N; i++) {
    const eta = r.g();
    let y = eta / 0.5 + r.g();
    let wp = 0;
    for (let t = 0; t < T + 5; t++) {
      const x = r.g() + (0.3 * t) / T;
      const e = r.g();
      const w = 0.5 * wp + 0.5 * e + r.g() + 0.3 * eta;
      wp = w;
      y = 0.5 * y + 0.4 * x + 0.3 * w + eta + e;
      if (t >= 5 && !(drop && drop(i, t - 5))) lines.push(`f${i}\t${2000 + t - 5}\t${y.toPrecision(15)}\t${x.toPrecision(15)}\t${w.toPrecision(15)}`);
    }
  }
  return lines.join("\n");
}
const rel6 = (a: number, b: number, what: string, tol = 1e-6): void => {
  if (!(Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300))) throw new Error(`${what}: ${a} vs ${b}`);
};

describe("location: adding a constant to a column changes nothing the model does not depend on, up to 10⁷ times its spread", () => {
  const OFFSETS = [1e3, 1e5, 1e7, 3e7];
  const dyn3 = dynPanel3(40, 8, 5);
  const dynCfgs: Record<string, string>[] = [];
  for (const estimator of ["system", "difference"]) for (const timeDummies of ["yes", "no"]) for (const collapse of ["yes", "no"]) for (const endog of ["", "w"])
    dynCfgs.push({ estimator, timeDummies, collapse, endog, spec: "y ~ L.y + x + w", entity: "id", time: "year", lagLast: collapse === "yes" ? "" : "4", steps: "two" });
  test.each(dynCfgs.map((c) => [JSON.stringify(c).replace(/"spec":"[^"]*",|"entity":"id","time":"year",/g, ""), c] as const))("panel-dyn-gmm %s", (_l, cfg) => {
    const ref = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: dyn3 }));
    if ("error" in ref) throw new Error(ref.error);
    // An exogenous x always; y and the endogenous w only with time dummies (balanced panel): otherwise their levels
    // instrument the differenced equation and the offset genuinely changes the estimator.
    const cols = ["x", ...(cfg.timeDummies === "yes" ? ["y", "w"] : [])];
    for (const col of cols)
      for (const c of OFFSETS) {
        const f = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(dyn3, col, c) }));
        if ("error" in f) throw new Error(`${col} + ${c}: refused: ${f.error}`);
        expect(f.fit.L).toBe(ref.fit.L);
        expect(f.des.names).toEqual(ref.des.names);
        // More instruments than groups (no collapse, system GMM): two-step refused at every offset, one-step compared.
        expect(f.fit.two === null).toBe(ref.fit.two === null);
        for (const [s, r] of [[f.fit.one, ref.fit.one], ...(ref.fit.two ? [[f.fit.two!, ref.fit.two]] : [])] as const) {
          ref.des.names.forEach((nm, j) => {
            if (nm === "Constant") return;
            rel6(s.b[j], r.b[j], `${col} + ${c} b ${nm}`);
            rel6(s.se[j], r.se[j], `${col} + ${c} se ${nm}`);
          });
          s.ar.forEach((a, i) => rel6(a.z, r.ar[i].z, `${col} + ${c} AR(${i + 1})`));
        }
        if (ref.fit.df > 0) {
          if (ref.fit.two) rel6(f.fit.hansen, ref.fit.hansen, `${col} + ${c} Hansen`);
          else expect(Number.isNaN(f.fit.hansen)).toBe(true);
          rel6(f.fit.sargan, ref.fit.sargan, `${col} + ${c} Sargan`);
        }
      }
    // Without time dummies a large offset on y is a different (well-defined) estimator, answered, not refused.
    if (cfg.timeDummies === "no") {
      const f = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(dyn3, "y", 3e7) }));
      if ("error" in f) throw new Error(`y + 3e7 without dummies: refused: ${f.error}`);
    }
    // Beyond 10⁸ times the spread: refused by name, never a collinearity or under-identification message.
    const big = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(dyn3, "x", 1e10) }));
    expect("error" in big && big.error).toMatch(/^The values of “x” are too large relative to their variation to estimate in double precision .*subtract a constant from “x”/);
  });
  test("panel-dyn-gmm: system GMM with time dummies and gaps refuses a large offset on y by name; difference GMM answers it", () => {
    const gaps = dynPanel3(40, 8, 7, (i, t) => i % 7 === 3 && t === 4);
    const cfg = { spec: "y ~ L.y + x", entity: "id", time: "year", lagLast: "", collapse: "yes" };
    const sys = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(gaps, "y", 1e6) }));
    expect("error" in sys && sys.error).toMatch(/^The values of “y” are too large relative to their variation for this system GMM with time dummies and gaps in the panel/);
    // Below that limit the answer is accurate (the dummies absorb the offset almost, not exactly: a small genuine change).
    const s0 = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: gaps }));
    const s1 = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(gaps, "y", 1e3) }));
    if ("error" in s0 || "error" in s1) throw new Error("system with gaps refused");
    expect(Math.abs(s1.fit.two!.b[0] - s0.fit.two!.b[0])).toBeLessThan(0.05);
    // With gaps a missing lag is 0 ("missing = 0"), so the offset genuinely changes the instruments; difference GMM
    // answers it (its recentering stays exact), converging as the offset grows.
    const d = [1e5, 1e6, 1e7].map((c) => dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, estimator: "difference", data: shiftCol(gaps, "y", c) })));
    for (const f of d) if ("error" in f) throw new Error(`difference with gaps refused: ${f.error}`);
    const b = d.map((f) => ("error" in f ? NaN : f.fit.two!.b[0]));
    expect(Math.abs(b[2] - b[1])).toBeLessThan(Math.abs(b[1] - b[0]) + 1e-9);
  });
  test("panel-dyn-gmm: the constant moves with the offset of y exactly (system GMM, time dummies)", () => {
    const cfg = { spec: "y ~ L.y + x", entity: "id", time: "year", lagLast: "", collapse: "yes" };
    const a = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: dyn3 }));
    const b = dynFitFromRead(reader("panel-dyn-gmm", { ...cfg, data: shiftCol(dyn3, "y", 1e5) }));
    if ("error" in a || "error" in b) throw new Error("refused");
    const ci = a.des.names.indexOf("Constant");
    const rho = a.fit.two!.b[0];
    // y + c: the level equation y = ρ·y₋₁ + … + const gains c(1 − ρ) in its constant.
    rel6(b.fit.two!.b[ci] - a.fit.two!.b[ci], 1e5 * (1 - rho), "constant shift", 1e-7);
  });

  const lin = linData(300, 3);
  const econCfgs: Record<string, string>[] = [];
  for (const steps of ["one", "two"]) for (const weight of ["robust", "cluster"]) econCfgs.push({ spec: "y ~ x", endog: "d1 + d2", instruments: "z1 + z2 + z3", steps, weight, cluster: weight === "cluster" ? "cl" : "" });
  test.each(econCfgs.map((c) => [`${c.steps} ${c.weight}`, c] as const))("econ-gmm %s", (_l, cfg) => {
    const ref = econGmmFitFromRead(reader("econ-gmm", { ...cfg, data: lin }));
    if ("error" in ref) throw new Error(ref.error);
    for (const col of ["y", "x", "z1", "d1"])
      for (const c of OFFSETS) {
        const f = econGmmFitFromRead(reader("econ-gmm", { ...cfg, data: shiftCol(lin, col, c) }));
        if ("error" in f) throw new Error(`${col} + ${c}: refused: ${f.error}`);
        for (const [s, r] of [[f.r.gmm, ref.r.gmm], [f.r.tsls, ref.r.tsls]] as const)
          ref.names.forEach((nm, j) => {
            if (nm === "Constant") return;
            rel6(s.b[j], r.b[j], `${col} + ${c} b ${nm}`);
            rel6(s.se[j], r.se[j], `${col} + ${c} se ${nm}`);
          });
        if (Number.isFinite(ref.r.j)) rel6(f.r.j, ref.r.j, `${col} + ${c} J`);
        f.r.firstStage.forEach((q, i) => {
          rel6(q.partialR2, ref.r.firstStage[i].partialR2, `${col} + ${c} partial R²`);
          rel6(q.wald, ref.r.firstStage[i].wald, `${col} + ${c} Wald`);
        });
        // The constant takes the offset of y, and −b_x·c for an offset on x.
        const ci = ref.names.indexOf("Constant");
        const xi = ref.names.indexOf(col);
        const want = col === "y" ? ref.r.gmm.b[ci] + c : xi >= 0 ? ref.r.gmm.b[ci] - ref.r.gmm.b[xi] * c : ref.r.gmm.b[ci];
        rel6(f.r.gmm.b[ci], want, `${col} + ${c} constant`, 1e-7);
      }
    const big = econGmmFitFromRead(reader("econ-gmm", { ...cfg, data: shiftCol(lin, "z1", 1e10) }));
    expect("error" in big && big.error).toMatch(/^The values of “z1” are too large relative to their variation to estimate in double precision/);
  });
  test("econ-gmm without a constant: large offsets are answered exactly (pinned to exact rational arithmetic), never a false collinearity", () => {
    const cfg = { spec: "y ~ x", endog: "d1 + d2", instruments: "z1 + z2 + z3", steps: "one", constant: "no" };
    const f = econGmmFitFromRead(reader("econ-gmm", { ...cfg, data: shiftCol(lin, "x", 1e8) }));
    if ("error" in f) throw new Error(f.error);
    // 2SLS by Python fractions on the same text (d1, d2, x).
    close(f.r.tsls.b, [0.5229506005467155, -0.4319132328701246, 8.08811251537396e-9], 1e-10, 0);
    const g = econGmmFitFromRead(reader("econ-gmm", { ...cfg, steps: "two", data: shiftCol(shiftCol(lin, "x", 1e6), "z1", 1e6) }));
    if ("error" in g) throw new Error(g.error);
  });
});

describe("exact fits are refused at any offset; near-exact data with real noise are not", () => {
  const lin = linData(300, 3);
  const withY = (f: (r: number[]) => number): string => {
    const L = lin.split("\n");
    return [L[0], ...L.slice(1).map((l) => {
      const r = l.split("\t");
      r[0] = String(f(r.map(Number)));
      return r.join("\t");
    })].join("\n");
  };
  test("econ-gmm: y = c + 2·d1 − x", () => {
    for (const c of [0, 1e5, 1e7]) {
      const o = econGmmFitFromRead(reader("econ-gmm", { data: withY((r) => c + 2 * r[1] - r[3]), spec: "y ~ x", endog: "d1", instruments: "z1 + z2" }));
      expect("error" in o && o.error).toMatch(/^The model fits the response exactly/);
    }
    const nz = lcg(11);
    const o = econGmmFitFromRead(reader("econ-gmm", { data: withY((r) => 1e7 + 2 * r[1] - r[3] + 1e-4 * nz.g()), spec: "y ~ x", endog: "d1", instruments: "z1 + z2" }));
    if ("error" in o) throw new Error(o.error);
  });
  test("panel-dyn-gmm: y = aᵢ + 0.1·t² with time dummies, and exact dynamics", () => {
    const at = (off: number): string => {
      const L = ["id\tyear\ty\tx"];
      const r = lcg(3);
      for (let i = 0; i < 40; i++) for (let t = 0; t < 8; t++) L.push(`f${i}\t${2000 + t}\t${off + i + 0.1 * t * t}\t${r.u() - 0.5}`);
      return L.join("\n");
    };
    for (const off of [0, 1e6])
      for (const estimator of ["system", "difference"]) {
        const o = dynFitFromRead(reader("panel-dyn-gmm", { data: at(off), spec: "y ~ L.y + x", entity: "id", time: "year", collapse: "yes", lagLast: "", estimator }));
        expect("error" in o && o.error).toMatch(/^The model fits the differenced response exactly/);
      }
    const exact = (eps: number): string => {
      const r = lcg(9);
      const L = ["id\tyear\ty\tx"];
      for (let i = 0; i < 50; i++) {
        let y = i * 0.37 + 1;
        for (let t = 0; t < 9; t++) {
          const x = r.u() - 0.5;
          y = 0.5 * y + 0.3 * x + Math.sin(i) + eps * (r.u() - 0.5);
          L.push(`f${i}\t${2000 + t}\t${y.toPrecision(17)}\t${x.toPrecision(17)}`);
        }
      }
      return L.join("\n");
    };
    const f0 = { spec: "y ~ L.y + x", entity: "id", time: "year", collapse: "yes", lagLast: "", estimator: "difference" };
    expect(run("panel-dyn-gmm", { ...f0, data: exact(0) }).text).toMatch(/^The model fits the differenced response exactly/);
    expect(run("panel-dyn-gmm", { ...f0, data: exact(1e-8) }).ok).not.toBe(false);
  });
  test("a response that changes in one entity-period only is refused by name", () => {
    const L = ["id\tyear\ty\tx"];
    const r = lcg(4);
    for (let i = 0; i < 30; i++) for (let t = 0; t < 8; t++) L.push(`f${i}\t${2000 + t}\t${i === 3 && t >= 4 ? 2 : 1}\t${r.g()}`);
    for (const estimator of ["system", "difference"]) {
      const o = run("panel-dyn-gmm", { data: L.join("\n"), spec: "y ~ L.y + x", entity: "id", time: "year", collapse: "yes", lagLast: "", estimator });
      expect(o.text).toMatch(/^The response “y” changes within only one entity-period \(entity “f3”, period 2004\)/);
    }
  });
  test("nearly (not exactly) collinear columns are named as such, not as perfectly collinear", () => {
    const d = dynPanel3(40, 8, 5);
    const nz = lcg(21);
    const near = d.split("\n").map((l, i) => (i === 0 ? `${l}\tx2` : `${l}\t${2 * Number(l.split("\t")[3]) + 1e-7 * nz.g()}`)).join("\n");
    expect(run("panel-dyn-gmm", { data: near, spec: "y ~ L.y + x + x2", entity: "id", time: "year", collapse: "yes", lagLast: "" }).text).toMatch(/^The regressor x2 is so close to a combination of the other regressors in the estimation rows \(the closest combination leaves only [\d.]+×10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+ of it\) that its estimate would be unstable: a residual share r inflates the variance of the estimate by about 1\/r² \(here [\d.]+×10[⁰¹²³⁴⁵⁶⁷⁸⁹]+\) and leaves the cross-products (about \d+ of double precision's 16 significant digits|no reliable digit); shares below about 10⁻⁵ are refused/);
    const lin2 = lin.split("\n").map((l, i) => (i === 0 ? `${l}\tz4` : `${l}\t${Number(l.split("\t")[4]) + Number(l.split("\t")[5]) + 1e-8 * nz.g()}`)).join("\n");
    expect(run("econ-gmm", { data: lin2, spec: "y ~ x", endog: "d1 + d2", instruments: "z1 + z2 + z3 + z4" }).text).toMatch(/^The instrument “z4” is so close to a combination of the others \(the closest combination leaves only [\d.]+×10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+ of it\) that the estimates would be unstable: .*shares below about 3×10⁻⁶ are refused \(a condition number above 10¹¹\)\./);
  });
});

describe("singular two-step weight in the comparison; econ-gmm location refusal names the true largest value", () => {
  test("the other estimator with a singular two-step weight is not computed, with the reason, and has no tick", () => {
    // Difference GMM with an endogenous price and lags 2 to 4 is full rank; system GMM with the same options has more
    // instruments than the 60 groups.
    const o = run("panel-dyn-gmm", { estimator: "difference", endog: "price" });
    expect(o.ok).not.toBe(false);
    const row = o.tables![2].rows.find((x) => x[0] === "System GMM")!;
    expect(row[1]).toBe("not computed");
    expect(row[4]).toMatch(/^two-step weight singular: \d+ instruments, 60 groups$/);
    const words = (o.svg ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(words).toMatch(/System GMM: not computed \(two-step weight singular: \d+ instruments, 60 groups\)\./);
    expect(words).not.toContain(" Sys. GMM ");
    // One-step: the other row is computed (the one-step weight is not the problem).
    const one = run("panel-dyn-gmm", { estimator: "difference", endog: "price", steps: "one" });
    expect(one.tables![2].rows.find((x) => x[0] === "System GMM")![1]).not.toBe("not computed");
  });
  test("econ-gmm: the refusal reports the column's largest value and its true ratio to the variation", () => {
    const L = linData(300, 3);
    const o = run("econ-gmm", { data: shiftCol(L, "x", 1e12), spec: "y ~ x", endog: "d1", instruments: "z1 + z2" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^The values of “x” are too large relative to their variation to estimate in double precision \(largest 1\.0×10¹², variation about 9\.7×10⁻¹;/);
    // 7×10⁷ times the variation is inside the 10⁸ limit (it was refused while the shift was added to the value).
    expect(run("econ-gmm", { data: shiftCol(L, "x", 7e7), spec: "y ~ x", endog: "d1", instruments: "z1 + z2" }).ok).not.toBe(false);
  });
});

describe("display of small coefficients, figure notes and ticks", () => {
  test("values below 0.01 keep three significant figures; both interval bounds share one format", () => {
    const o = run("econ-gmm", { data: linData(300, 3, 1000), spec: "y ~ x", endog: "d1 + d2", instruments: "z1 + z2 + z3" });
    const row = o.tables![0].rows.find((r) => r[0] === "x")!;
    expect(row[1]).toMatch(/^0\.000\d{3}$/);
    expect(row[2]).toMatch(/^0\.000\d{3}$/);
    const [lo, hi] = row[5].split(" to ");
    expect(lo.replace("−", "").split(".")[1].length).toBe(hi.replace("−", "").split(".")[1].length);
    expect(row[5]).not.toMatch(/×10/);
    expect(coefText(0.000912)).toBe("0.000912");
    expect(coefText(-0.00674)).toBe("−0.00674");
    expect(coefText(0.0711)).toBe("0.0711");
  });
  test("one format per row: estimate, SE and both bounds never mix m×10ⁿ with decimals, or four decimals with five", () => {
    const row = (b: number, se: number): string[] => {
      const f = rowFormat(b, se);
      return [f(b), f(se), f(b - 1.96 * se), f(b + 1.96 * se)];
    };
    const decimals = (s: string): number => (s.split(".")[1] ?? "").length;
    // A tiny estimate with an interval spanning 0: every cell in m×10ⁿ (review 3: −3.57×10⁻⁵ beside "−0.000183 to 0.000112").
    for (const c of row(-3.57e-5, 7.5e-5)) expect(c).toMatch(/×10/);
    // b ≥ 0.01 with SE < 0.01: one decimal count for the row (review 3: 0.0125 beside 0.00652).
    const r1 = row(0.0125, 0.00652);
    expect(r1[0]).toBe("0.01250");
    expect(r1[1]).toBe("0.00652");
    expect(new Set(r1.map(decimals)).size).toBe(1);
    for (const c of r1) expect(c).not.toMatch(/×10/);
    // An interval ending near 0 keeps the row's decimals (no m×10ⁿ, no "−0").
    for (const [b, se] of [[0.02, 0.0102], [0.0512, 0.026], [-0.0256, 0.013], [0.00045, 0.00023]]) {
      const r = row(b, se);
      for (const c of r) expect(c).not.toMatch(/×10|^−0(\.0+)?$/);
      expect(new Set(r.map(decimals)).size).toBe(1);
    }
    // A huge |z| (SE far below the estimate): the decimals come from the smallest value, so the SE keeps three
    // significant figures and never prints as 0.0000.
    const r2 = row(0.85, 0.000123);
    expect(r2[1]).toBe("0.000123");
    expect(r2[0]).toBe("0.850000");
    // −0 and zero.
    expect(rowFormat(-0, 0.5)(-0)).toBe("0.0000");
    expect(rowFormat(0, 0)(0)).toBe("0.0000");
    // 10⁹ or more anywhere: every cell in m×10ⁿ with four significant figures.
    const r3 = row(2.5e9, 3e8);
    for (const c of r3) expect(c).toMatch(/^[−\d.]+×10[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/);
    expect(r3[0]).toBe("2.500×10⁹");
    expect(rowFormat(1.5e-6, 2.5e-5)(1.5e-6)).toBe("1.50×10⁻⁶");
  });
  test("the econ-gmm figure names the weight it used and shortens long tick names", () => {
    const words = (svg: string | undefined): string => (svg ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(words(run("econ-gmm", { data: linData(300, 3), spec: "y ~ x", endog: "d1 + d2", instruments: "z1 + z2 + z3", weight: "cluster", cluster: "cl" }).svg)).toContain("Both with standard errors clustered by “cl” (sandwich) and normal intervals");
    expect(words(run("econ-gmm").svg)).toContain("Both with heteroskedasticity-robust (sandwich) standard errors and normal intervals");
    const long = ivDefaultTable().replace(/^lwage(\s)educ(\s)exper/, "lwage$1years_of_schooling_completed$2labor_market_experience_total");
    const svg = run("econ-gmm", { data: long, spec: "lwage ~", endog: "years_of_schooling_completed + labor_market_experience_total", instruments: "dist + sibs" }).svg!;
    expect(svg).toContain("…");
    expect(words(svg)).toContain("Ticks, in order: years_of_schooling_completed, labor_market_experience_total.");
    // Two long names with a common prefix would shorten to the same tick: numbers instead, keyed in the note.
    const twin = ivDefaultTable().replace(/^lwage(\s)educ(\s)exper/, "lwage$1years_of_schooling_completed_mother$2years_of_schooling_completed_father");
    const svg2 = run("econ-gmm", { data: twin, spec: "lwage ~", endog: "years_of_schooling_completed_mother + years_of_schooling_completed_father", instruments: "dist + sibs" }).svg!;
    // Each "n = name" pair stays on one line of the note (review 3: "2 =" ended a line, the name began the next).
    const lines = (svg2.match(/<text[^>]*>[^<]*<\/text>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, ""));
    for (const nm of ["years_of_schooling_completed_mother", "years_of_schooling_completed_father"]) {
      const i = ["years_of_schooling_completed_mother", "years_of_schooling_completed_father"].indexOf(nm) + 1;
      expect(lines.some((l) => l.includes(`${i} = ${nm}`))).toBe(true);
    }
    expect(words(svg2)).toContain("Ticks: 1 = years_of_schooling_completed_mother, 2 = years_of_schooling_completed_father.");
    expect(tickKeyNotes(["household_income_total", "household_income_net", "x"])).toEqual(["Ticks: 1 = household_income_total,", "2 = household_income_net, 3 = x."]);
  });
});

describe("linear algebra", () => {
  test("symEigen reconstructs a symmetric matrix; symInverse falls back to Moore–Penrose on a singular one", () => {
    const n = 7;
    const A = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = Math.cos(i + j) + (i === j ? 3 : 0) + Math.sin(i * j) * 0 + Math.cos(i * j);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[i * n + j] = A[j * n + i];
    const { d, V } = symEigen(A, n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += V[i * n + k] * d[k] * V[j * n + k];
        expect(Math.abs(s - A[i * n + j])).toBeLessThan(1e-12);
      }
    // Rank 2: vvᵀ + wwᵀ.
    const v = [1, 2, 3, 4];
    const w = [1, -1, 0, 2];
    const S = new Float64Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) S[i * 4 + j] = v[i] * v[j] + w[i] * w[j];
    const r = symInverse(S, 4);
    expect(r.generalized).toBe(true);
    expect(r.rank).toBe(2);
    // S S⁺ S = S.
    const m = (X: Float64Array, Y: Float64Array): Float64Array => {
      const out = new Float64Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[i * 4 + j] += X[i * 4 + k] * Y[k * 4 + j];
      return out;
    };
    close(m(m(S, r.inv), S), S, 1e-10, 1e-10);
  });
});
