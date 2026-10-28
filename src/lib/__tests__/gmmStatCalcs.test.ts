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
import { GMM_STAT_CALCS, DYN_DEFAULT_TABLE, dynFitFromRead, econGmmFitFromRead } from "../gmmStatCalcs";
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
    close(f.two!.b, np.b2, 1e-7);
    close(f.two!.se, np.se2, 1e-6);
    close(f.two!.seUncorrected!, np.se2u, 1e-6);
    expect(Math.abs(f.hansen - np.hansen)).toBeLessThan(1e-6 * Math.max(1, np.hansen));
    expect(Math.abs(f.sargan - np.sargan)).toBeLessThan(1e-6 * Math.max(1, np.sargan));
    close(f.one.ar.map((a) => a.z), np.ar1, 1e-6);
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
  test("instruments far beyond the groups: a warning, a generalized inverse, finite output", () => {
    const o = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), timeDummies: "no" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Warning: \d+ instruments exceed the 12 groups/);
    expect(o.text).toContain("Moore–Penrose");
    // With time dummies there are more coefficients (13) than the rank of the two-step weight (≤ 12 groups):
    // two-step is refused by name, one-step still runs and says why Hansen is missing.
    const two = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12) });
    expect(two.ok).toBe(false);
    expect(two.text).toMatch(/^Two-step GMM: the two-step weight matrix has rank \d+ \(at most the 12 groups\), fewer than the 13 coefficients/);
    const one = run("panel-dyn-gmm", { ...DYN, data: dynPanel(12, 12), steps: "one" });
    expect(one.ok).not.toBe(false);
    expect(one.text).toContain("Hansen J not computed: the two-step weight matrix has rank");
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
