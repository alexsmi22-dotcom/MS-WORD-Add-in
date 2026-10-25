/**
 * Release E4b calculators (panel-fe, panel-re, panel-did): worked defaults, the display contract, hostile inputs and
 * the freeze bound at 100,000 rows.
 */
import {
  panelFeCalc,
  panelReCalc,
  panelDidCalc,
  panelFeModel,
  panelReModel,
  panelDidModel,
  PANEL_FE_DEFAULTS,
  PANEL_RE_DEFAULTS,
  PANEL_DID_DEFAULTS,
  PANEL_FE_FIELDS,
  PANEL_RE_FIELDS,
  PANEL_DID_FIELDS,
} from "../panelCalcs";
import type { StatOutput } from "../analyzeBlocks";
import { parseRegData } from "../regData";
import { P_BELOW } from "../regTable";
import { readPanel } from "../panelData";
import { fitFixedEffects, twoWayTransform, makeGroups, PanelRefusal } from "../panel";

type Calc = (read: (k: string) => string) => StatOutput;
const reader = (defaults: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => (k in over ? over[k] : (defaults[k] ?? ""));
const fe = (over: Record<string, string> = {}): StatOutput => panelFeCalc(reader(PANEL_FE_DEFAULTS, over));
const re = (over: Record<string, string> = {}): StatOutput => panelReCalc(reader(PANEL_RE_DEFAULTS, over));
const did = (over: Record<string, string> = {}): StatOutput => panelDidCalc(reader(PANEL_DID_DEFAULTS, over));

/** Every ok result obeys the display contract (text and every table cell). */
function contract(out: StatOutput): void {
  expect(out.ok).not.toBe(false);
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
  expect(all).not.toMatch(/NaN|Infinity|undefined/);
  expect(all).not.toMatch(/\d[eE][+-]?\d/);
  expect(all).not.toMatch(/(^|[\s(\[;=])-\d/m);
  expect(all).not.toMatch(/—/);
  for (const t of out.tables ?? []) {
    expect(t.align).toBeDefined();
    expect(t.align!.length).toBe(t.rows[0].length);
    for (const r of t.rows) expect(r.length).toBe(t.rows[0].length);
  }
  if (out.svg) expect(out.svg).not.toMatch(/NaN|Infinity/);
}

function refused(out: StatOutput, re?: RegExp): void {
  expect(out.ok).toBe(false);
  if (re) expect(out.text).toMatch(re);
  expect(out.text).not.toMatch(/NaN|undefined/);
}

/** A long table from rows of cells. */
function table(head: string[], rows: (string | number)[][]): string {
  return [head.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

/** A small seeded panel: N entities × T periods, y = a_i + 1.5 x1 − 0.5 x2 + noise. */
function panel(N: number, T: number, seed = 1, f?: (i: number, t: number, x1: number, x2: number, y: number) => (string | number)[]): string {
  let s = seed;
  const u = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s + 0.5) / 2147483648;
  };
  const g = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const rows: (string | number)[][] = [];
  for (let i = 0; i < N; i++) {
    const a = g();
    for (let t = 0; t < T; t++) {
      const x1 = a + g();
      const x2 = g();
      const y = a + 1.5 * x1 - 0.5 * x2 + g();
      rows.push(f ? f(i, t, x1, x2, y) : [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), x2.toFixed(6)]);
    }
  }
  return table(["id", "yr", "y", "x1", "x2"], rows);
}
const P = { entity: "id", time: "yr", spec: "y ~ x1 + x2" };

describe("fields and defaults", () => {
  test("every field has a default and select defaults are options", () => {
    for (const [fields, defs] of [
      [PANEL_FE_FIELDS, PANEL_FE_DEFAULTS],
      [PANEL_RE_FIELDS, PANEL_RE_DEFAULTS],
      [PANEL_DID_FIELDS, PANEL_DID_DEFAULTS],
    ] as const) {
      for (const f of fields) {
        expect(f.key in defs).toBe(true);
        if (f.kind === "select") expect(f.options!.map((o) => o.value)).toContain(defs[f.key]);
      }
    }
  });
  test.each([
    ["panel-fe", fe],
    ["panel-re", re],
    ["panel-did", did],
  ] as [string, () => StatOutput][])("%s default is ok and obeys the display contract", (_n, calc) => {
    const out = calc();
    contract(out);
    expect(out.text).toMatch(/Conventions|linearmodels/);
  });
  test("RE default computes the Hausman test (the worked example is built to show it)", () => {
    const out = re();
    expect(out.text).toMatch(/Hausman χ²\(2\) = \d/);
    expect(out.tables!.find((t) => t.label === "Hausman test")!.rows[1][1]).toMatch(/^χ² = /);
  });
  test("FE default with entity and time effects, robust and classical", () => {
    contract(fe({ effects: "twoway" }));
    contract(fe({ se: "robust" }));
    contract(fe({ se: "classical", effects: "twoway" }));
  });
  test("DiD default: event-study figure, titled DiD, not 'event study' alone", () => {
    const out = did();
    expect(out.svg).toMatch(/DiD event study/);
    expect(out.tables!.some((t) => /DiD event study/.test(t.label))).toBe(true);
    expect(out.text).toMatch(/DiD estimate = /);
  });
  test("the models come out as FittedModel kinds fe, re, did", () => {
    const a = panelFeModel(reader(PANEL_FE_DEFAULTS));
    const b = panelReModel(reader(PANEL_RE_DEFAULTS));
    const c = panelDidModel(reader(PANEL_DID_DEFAULTS));
    for (const [m, k] of [
      [a, "fe"],
      [b, "re"],
      [c, "did"],
    ] as const) {
      if ("error" in m) throw new Error(m.error);
      expect(m.kind).toBe(k);
      expect(m.terms[m.terms.length - 1].name).toBe("Constant");
      expect(m.stats.find((s) => s.label === "R²")).toBeDefined();
    }
  });
});

describe("conventions printed and estimates sane", () => {
  test("FE recovers the slope on a seeded panel and names the cluster factor", () => {
    const out = fe({ data: panel(40, 6, 3), ...P });
    contract(out);
    expect(out.text).toMatch(/xtreg, fe vce\(cluster\)/);
    const coef = Number(out.tables![0].rows[1][1].replace("−", "-"));
    expect(Math.abs(coef - 1.5)).toBeLessThan(0.2);
  });
  test("two-way clustered names linearmodels' count of every effect", () => {
    const out = fe({ data: panel(40, 6, 3), ...P, effects: "twoway" });
    contract(out);
    expect(out.text).toMatch(/all \d+ effects counted/);
  });
  test("RE prints θ and the Hausman convention", () => {
    const out = re({ data: panel(40, 6, 3), ...P });
    contract(out);
    expect(out.text).toMatch(/θ = /);
    expect(out.text).toMatch(/CONVENTIONAL \(classical\) covariances/);
    expect(out.text).toMatch(/Hausman form used: |WARNING: Hausman test by a generalised inverse/);
  });
  test("Hausman prints which form it used and why (the oracle fixture's review panels)", () => {
    const fx = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "econ-panel-oracle.json"), "utf8")) as { data: Record<string, string> };
    const sm = re({ data: fx.data.adv_P, entity: "firm", time: "year", spec: "y ~ x1 + x2 + z", se: "classical" });
    contract(sm);
    expect(sm.text).toMatch(/Hausman χ²\(2\) = 47\.865, p <\s0\.001 \(sigmamore form\)/);
    expect(sm.text).toMatch(/Hausman form used: V_FE − V_RE is not positive definite on the conventional covariances, because the two fits estimate σ² differently \(FE s² = 2\.7822, RE s² = 3\.4569\); both covariances are put on the efficient \(RE\) estimator's σ², Stata's sigmamore form/);
    const pv = re({ data: fx.data.adv_B, entity: "firm", time: "year", spec: "y ~ x1 + trend", se: "classical" });
    contract(pv);
    expect(pv.text).toMatch(/Hausman χ²\(1\) = 24\.218, p <\s0\.001 \(sigmamore form, generalised inverse\)/);
    expect(pv.text).toMatch(/WARNING: Hausman test by a generalised inverse\..*singular, rank 1 of 2.*df = its rank.*The test then has 1 df instead of 2\./);
    expect(pv.tables!.find((t) => t.label === "Hausman test")!.rows[1]).toEqual(["Hausman (FE vs RE), sigmamore form, generalised inverse", "χ² = 24.218", "1", P_BELOW]);
    const cl = re({ data: fx.data.adv_B, entity: "firm", time: "year", spec: "y ~ x1 + trend", se: "cluster-entity" });
    contract(cl);
  });
  test("dates and quarters as time", () => {
    const q = panel(10, 4, 5, (i, t, x1, x2, y) => [`e${i}`, `${2020 + Math.floor(t / 4)} Q${(t % 4) + 1}`, y.toFixed(6), x1.toFixed(6), x2.toFixed(6)]);
    const out = fe({ data: q, ...P });
    contract(out);
    expect(out.text).toMatch(/quarters, sorted by calendar day/);
    const d = panel(10, 4, 5, (i, t, x1, x2, y) => [`e${i}`, `2021-0${t + 1}-15`, y.toFixed(6), x1.toFixed(6), x2.toFixed(6)]);
    contract(fe({ data: d, ...P, effects: "twoway" }));
    const mixed = panel(3, 2, 5, (i, t, x1, x2, y) => [`e${i}`, t === 0 ? "2021" : "2021 Q2", y, x1, x2]);
    refused(fe({ data: mixed, ...P }), /mixes years and quarters/);
  });
  test("NA cells are dropped with a note", () => {
    const d = panel(20, 5, 9).split("\n");
    d[3] = d[3].replace(/\t[^\t]+$/, "\tNA");
    d[7] = d[7].replace(/^e\d+/, "NA");
    const out = fe({ data: d.join("\n"), ...P });
    contract(out);
    expect(out.text).toMatch(/listwise deletion/);
  });
});

describe("hostile inputs", () => {
  test("missing columns and fields", () => {
    refused(fe({ data: panel(5, 3), ...P, spec: "y ~ nope" }), /No column is named “nope”/);
    refused(fe({ data: panel(5, 3), ...P, entity: "firm" }), /Entity column: No column/);
    refused(fe({ data: panel(5, 3), ...P, time: "" }), /Name the time column/);
    refused(fe({ data: panel(5, 3), ...P, spec: "" }), /y ~ x1 \+ x2/);
    refused(fe({ data: "", ...P }), /Paste a table/);
    refused(did({ treat: "nope" }), /Treatment column: No column/);
    refused(fe({ data: panel(5, 3), ...P, se: "cluster-column", cluster: "" }), /Name the cluster column/);
  });
  test("rubbish in parameter fields", () => {
    refused(fe({ effects: "abc" }), /Unknown effects/);
    refused(fe({ se: "abc" }), /Unknown standard-error type/);
    refused(re({ se: "abc" }), /Unknown standard-error type/);
    for (const v of ["abc", "−1", "1e400", "-3", "2.5", "21"]) refused(did({ leads: v }), /Leads/);
    for (const v of ["abc", "−1", "1e400", "99"]) refused(did({ lags: v }), /Lags/);
    contract(did({ leads: "", lags: "" }));
    contract(did({ leads: "1", lags: "0" }));
    refused(did({ se: "classical" }), /Unknown standard-error type/);
  });
  test("too few rows", () => {
    refused(fe({ data: panel(2, 1), ...P }), /no residual degrees of freedom/);
    refused(re({ data: panel(2, 2), ...P }), /cannot be estimated/);
    refused(did({ data: table(["county", "year", "employment", "policy"], [["a", 1, 1, 0], ["a", 2, 2, 1]]) }), /degrees of freedom|cannot|Every|never/i);
  });
  test("constant, collinear and absorbed regressors", () => {
    const withC = panel(10, 4, 2, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), "7"]);
    refused(fe({ data: withC, ...P }), /“x2” is constant \(every value is 7\)/);
    refused(re({ data: withC, ...P }), /“x2”/);
    const coll = panel(10, 4, 2, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), (2 * Number(x1.toFixed(6))).toFixed(6)]);
    refused(fe({ data: coll, ...P }), /collinear/i);
    refused(re({ data: coll, ...P }), /collinear/i);
    const tinv = panel(10, 4, 2, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), String(i)]);
    refused(fe({ data: tinv, ...P }), /entity effects absorb it/);
    contract(re({ data: tinv, ...P }));
    const trend = panel(10, 4, 2, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), String(t + i)]);
    refused(fe({ data: trend, ...P, effects: "twoway" }), /entity and time effects, so it counts as absorbed/);
    // A large level with real within variation: refused by linearmodels' 10⁻⁵ rule, with the fix named; RE keeps it.
    const level = panel(10, 4, 2, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), (1e6 + x1).toFixed(6), x2.toFixed(6)]);
    refused(fe({ data: level, ...P }), /less than 10⁻⁵ of its size left.*subtracting a constant near its mean/);
    contract(re({ data: level, ...P }));
  });
  test("duplicate entity × period, refused by row before listwise deletion", () => {
    const d = panel(5, 3).split("\n");
    d.push(d[2].replace(/\t[^\t]+$/, "\tNA"));
    refused(fe({ data: d.join("\n"), ...P }), /Rows 2 and 16 both hold entity “e0”/);
  });
  test("a disconnected panel is fitted with two-way effects, the effects counted at the dummies' rank (pinned in the oracle test)", () => {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 6; i++)
      for (let t = 0; t < 3; t++) {
        const yr = i < 3 ? 2000 + t : 2010 + t;
        rows.push([`e${i}`, yr, (i + t + Math.sin(i * 7 + t)).toFixed(4), Math.cos(i * 3 + t * 5).toFixed(4), Math.sin(i * 11 + t * 2).toFixed(4)]);
      }
    const d = table(["id", "yr", "y", "x1", "x2"], rows);
    const out = fe({ data: d, ...P, effects: "twoway", se: "classical" });
    contract(out);
    // 6 entities, 6 periods, 2 groups: 6 + 6 − 1 − 2 = 9 effects.
    expect(out.text).toMatch(/splits into 2 groups.*N \+ T − 1 − 2 = 9.*linearmodels counts N \+ T − 2 = 10/);
    expect(out.tables![1].rows.find((r) => r[0] === "Effects counted")![1]).toBe("9");
    contract(fe({ data: d, ...P }));
  });
  test("every entity with the same number of rows but not the same periods is not called “100 to 100 rows”", () => {
    const d = panel(6, 4, 3, (i, t, x1, x2, y) => [`e${i}`, 2000 + t + (i % 2), y.toFixed(6), x1.toFixed(6), x2.toFixed(6)]);
    const out = fe({ data: d, ...P });
    contract(out);
    expect(out.text).toMatch(/unbalanced: every entity has 4 rows, but not all in the same periods/);
    expect(out.text).not.toMatch(/4 to 4 rows/);
  });
  test("huge and tiny scales", () => {
    const d = panel(30, 5, 4, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, `${(y * 1e12).toPrecision(12)}`, `${(x1 * 1e-12).toPrecision(12)}`, x2.toFixed(6)]);
    for (const out of [fe({ data: d, ...P }), fe({ data: d, ...P, effects: "twoway", se: "robust" }), re({ data: d, ...P })]) contract(out);
    const fit = panelFeModel(reader(PANEL_FE_DEFAULTS, { data: d, ...P }));
    if ("error" in fit) throw new Error(fit.error);
    // slope on x1 scaled by 10²⁴.
    expect(Math.abs(fit.terms[0].coef / 1.5e24 - 1)).toBeLessThan(0.2);
    const out = fe({ data: panel(5, 3, 4, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, "1e400", x1, x2]), ...P });
    refused(out);
  });
  test("cluster by a named column, nested and not", () => {
    const d = panel(30, 5, 6, (i, t, x1, x2, y) => [`e${i}`, 2000 + t, y.toFixed(6), x1.toFixed(6), x2.toFixed(6), `g${i % 6}`, `r${(i + t) % 4}`]);
    const dd = d.replace(/^id\tyr\ty\tx1\tx2/, "id\tyr\ty\tx1\tx2\tgroup\tregion");
    const a = fe({ data: dd, ...P, se: "cluster-column", cluster: "group" });
    contract(a);
    expect(a.text).toMatch(/nested in the clusters/);
    const b = fe({ data: dd, ...P, se: "cluster-column", cluster: "region" });
    contract(b);
    expect(b.text).toMatch(/not nested in the clusters/);
    expect(b.text).toMatch(/Only 4 clusters/);
    refused(fe({ data: dd, ...P, se: "cluster-column", cluster: "nope" }), /Cluster column/);
  });
});

describe("difference-in-differences", () => {
  function didTable(N: number, T: number, start: (i: number) => number | null, seed = 7, extra?: (i: number, t: number) => number): string {
    let s = seed;
    const u = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s + 0.5) / 2147483648;
    };
    const g = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    const rows: (string | number)[][] = [];
    for (let i = 0; i < N; i++) {
      const a = g();
      const st = start(i);
      for (let t = 0; t < T; t++) {
        const d = extra ? extra(i, t) : st !== null && t >= st ? 1 : 0;
        rows.push([`c${i}`, 2010 + t, (a + 0.3 * t + 2 * d + g()).toFixed(6), d, g().toFixed(6)]);
      }
    }
    return table(["county", "year", "employment", "policy", "pop"], rows);
  }
  test("2×2: the four means' difference equals the TWFE estimate on a balanced panel", () => {
    const out = did({ data: didTable(30, 2, (i) => (i < 12 ? 1 : null)), leads: "1", lags: "0" });
    contract(out);
    const tb = out.tables!.find((t) => /2×2/.test(t.label))!;
    expect(tb).toBeDefined();
    const est = out.tables![0].rows[1][1];
    expect(tb.rows[3][3]).toBe(est);
    expect(out.text).toMatch(/equal to the TWFE estimate/);
  });
  test("unbalanced 2×2 says the two can differ", () => {
    const d = didTable(30, 2, (i) => (i < 12 ? 1 : null)).split("\n");
    d.splice(5, 1);
    const out = did({ data: d.join("\n"), leads: "1", lags: "0" });
    contract(out);
    expect(out.text).toMatch(/can differ from the TWFE estimate because the panel is unbalanced/);
  });
  test("staggered adoption warns by name", () => {
    const out = did({ data: didTable(40, 8, (i) => [3, 5, null][i % 3]) });
    contract(out);
    expect(out.text).toMatch(/staggered adoption/);
    expect(out.text).toMatch(/Goodman-Bacon 2021/);
    expect(out.text).toMatch(/Sun & Abraham 2021/);
    expect(out.text).toMatch(/de Chaisemartin & D'Haultfœuille 2020/);
    expect(out.text).toMatch(/NOT robust/);
  });
  test("a treatment that switches off is refused by entity", () => {
    const d = didTable(10, 5, () => null, 7, (i, t) => (i === 3 && t === 2 ? 1 : 0));
    refused(did({ data: d }), /Entity “c3” is treated in “2012” but untreated again in “2013”/);
  });
  test("a treatment that is not 0/1 is refused", () => {
    const d = didTable(10, 5, () => null, 7, (i, t) => (i < 3 && t > 2 ? 2 : 0));
    refused(did({ data: d }), /must be 0 or 1/);
    // A tiny non-0/1 value is shown under the display contract, not in e-notation.
    const tiny = didTable(10, 5, () => null, 7, (i, t) => (i < 3 && t > 2 ? 1e-7 : 0));
    const out = did({ data: tiny });
    refused(out, /holds 1×10⁻⁷/);
    expect(out.text).not.toMatch(/\de-\d/);
  });
  test("an NA outcome in the adoption row does not move the unit's adoption period (pinned in the oracle test)", () => {
    const d = didTable(30, 8, (i) => (i < 12 ? 4 : null)).split("\n");
    // c0…c2 lose their 2014 (adoption-period) outcome.
    for (let r = 1; r < d.length; r++) if (/^c[012]\t2014\t/.test(d[r])) d[r] = d[r].replace(/^(c\d\t2014\t)[^\t]+/, "$1NA");
    const out = did({ data: d.join("\n"), leads: "3", lags: "3" });
    contract(out);
    expect(out.text).toMatch(/12 treated entities, 18 never treated; treatment starts in 1 period \(2014\)/);
    expect(out.text).toMatch(/Adoption period of each unit: the first period its treatment is 1, read from the treatment column over every row/);
    expect(out.tables!.some((t) => /DiD event study/.test(t.label))).toBe(true);
  });
  test("an NA treatment cell that hides an adoption refuses the event study only, by entity and row", () => {
    const d = didTable(30, 8, (i) => (i < 12 ? 4 : null)).split("\n");
    // c5's 2013 treatment cell (data row 44: entity 5 × 8 + period 3 + 1) is NA, between its last 0 and first 1.
    d[44] = d[44].replace(/^(c5\t2013\t[^\t]+\t)0/, "$1NA");
    expect(d[44]).toMatch(/^c5\t2013\t[^\t]+\tNA/);
    const out = did({ data: d.join("\n") });
    contract(out);
    expect(out.text).toMatch(/DiD estimate = /);
    expect(out.text).toMatch(/DiD event study not computed: The adoption period of entity “c5” cannot be dated: its treatment cell is empty or NA in row 44/);
  });
  test("plural wording for units with no pre-period; many cohorts summarised", () => {
    const d = didTable(40, 12, (i) => (i < 3 ? 0 : i < 20 ? 2 + (i % 9) : null));
    const out = did({ data: d });
    contract(out);
    expect(out.text).toMatch(/3 entities are treated from their first row \(no pre-period of their own\)/);
    expect(out.text).toMatch(/treatment starts in 10 periods \(from 2010 to 2020\)/);
    const one = did({ data: didTable(30, 8, (i) => (i < 1 ? 0 : i < 12 ? 4 : null)) });
    expect(one.text).toMatch(/1 entity is treated from its first row \(no pre-period of its own\)/);
  });
  test("the event study uses the main fit's standard errors", () => {
    const d = didTable(30, 8, (i) => (i < 12 ? 4 : null));
    for (const se of ["robust", "cluster-entity"]) {
      const out = did({ data: d, se });
      const main = /Standard errors: (.+)/.exec(out.text)![1];
      expect(out.tables!.find((t) => /DiD event study/.test(t.label))!.note).toContain(main);
    }
  });
  test("no never-treated: the DiD estimate stands, the event study is refused by name", () => {
    const out = did({ data: didTable(30, 6, (i) => (i % 2 ? 2 : 4)) });
    contract(out);
    expect(out.text).toMatch(/event study not computed: Every entity is treated/);
    expect(out.svg).toBeUndefined();
  });
  test("nothing treated is refused", () => {
    refused(did({ data: didTable(10, 4, () => null) }), /nothing is treated/);
  });
  test("controls and robust standard errors", () => {
    const out = did({ data: didTable(30, 6, (i) => (i < 10 ? 3 : null)), controls: "pop", se: "robust" });
    contract(out);
    expect(out.tables![0].rows.map((r) => r[0])).toEqual(["Term", "policy", "pop", "Constant"]);
    refused(did({ controls: "pop + " }), /empty term/);
    refused(did({ controls: "nope" }), /No column is named “nope”/);
  });
  test("everyone treated in the same period: no comparison group, said in DiD terms", () => {
    refused(did({ data: didTable(20, 6, () => 3) }), /Every entity is treated, all from “2013”.*no comparison group/);
  });
  test("treated entities never seen untreated: the entity effects absorb the dummy, said so", () => {
    const out = did({ data: didTable(20, 6, (i) => (i < 8 ? 0 : null)) });
    refused(out, /No treated entity is observed before its treatment starts.*entity effects absorb it/);
    expect(out.text).not.toMatch(/time effects absorb/);
  });
  test("NA cells and 10¹² / 10⁻¹² scales", () => {
    const d = didTable(30, 6, (i) => (i < 10 ? 3 : null)).split("\n");
    d[4] = d[4].replace(/\t[^\t]+\t(\d)\t/, "\tNA\t$1\t");
    const na = did({ data: d.join("\n"), controls: "pop" });
    contract(na);
    expect(na.text).toMatch(/1 row with a missing cell/);
    const scaled = didTable(30, 6, (i) => (i < 10 ? 3 : null))
      .split("\n")
      .map((l, i) => {
        if (i === 0) return l;
        const c = l.split("\t");
        c[2] = (Number(c[2]) * 1e12).toPrecision(12);
        c[4] = (Number(c[4]) * 1e-12).toPrecision(12);
        return c.join("\t");
      })
      .join("\n");
    const big = did({ data: scaled, controls: "pop" });
    contract(big);
    const est = panelDidModel(reader(PANEL_DID_DEFAULTS, { data: scaled, controls: "pop" }));
    if ("error" in est) throw new Error(est.error);
    expect(Math.abs(est.terms[0].coef / 2e12 - 1)).toBeLessThan(0.3);
    const reNa = panel(20, 5, 9).split("\n");
    reNa[5] = reNa[5].replace(/\t[^\t]+$/, "\tNA");
    contract(re({ data: reNa.join("\n"), ...P }));
  });
});

describe("two-way transformation is exact", () => {
  test("projection residual is orthogonal to every entity and period dummy on an unbalanced panel", () => {
    const d = parseRegData(panel(25, 9, 11).split("\n").filter((_, i) => i === 0 || i % 4 !== 1).join("\n"));
    if (!d.ok) throw new Error(d.reason);
    const r = readPanel(d.data, { spec: { dep: "y", preds: ["x1"], text: "" }, entity: "id", time: "yr" });
    if (!r.ok) throw new Error(r.reason);
    const p = r.panel;
    const [ty] = twoWayTransform([p.y], makeGroups(p.entity, p.N), makeGroups(p.time, p.T), Date.now());
    const se = new Float64Array(p.N);
    const st = new Float64Array(p.T);
    for (let i = 0; i < p.n; i++) {
      se[p.entity[i]] += ty[i];
      st[p.time[i]] += ty[i];
    }
    for (const v of [...se, ...st]) expect(Math.abs(v)).toBeLessThan(1e-10);
  });
});

describe("freeze bound: 100,000 rows", () => {
  const big = (() => {
    let s = 42;
    const u = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s + 0.5) / 2147483648;
    };
    const rows: string[] = ["id\tyr\ty\tx1\tx2\tpolicy"];
    for (let i = 0; i < 5000; i++) {
      const a = u();
      for (let t = 0; t < 20; t++) {
        const x1 = a + u();
        const x2 = u();
        const d = i % 3 === 0 && t >= 10 ? 1 : 0;
        rows.push(`e${i}\t${2000 + t}\t${(a + 1.5 * x1 - 0.5 * x2 + d + u()).toFixed(5)}\t${x1.toFixed(5)}\t${x2.toFixed(5)}\t${d}`);
      }
    }
    return rows.join("\n");
  })();
  // Measured on the build machine (1 jest worker): FE entity 0.72 s, FE two-way 0.57 s, RE 0.93 s, DiD with the
  // event study 1.84 s. Bounds are at least 3× those (QC runs 4 workers).
  test.each([
    ["FE entity", () => fe({ data: big, ...P }), 3000],
    ["FE two-way", () => fe({ data: big, ...P, effects: "twoway" }), 3500],
    ["RE", () => re({ data: big, ...P }), 4000],
    ["DiD + event study", () => did({ data: big, outcome: "y", entity: "id", time: "yr", treat: "policy", controls: "x1" }), 7000],
  ] as [string, () => StatOutput, number][])("%s", (_n, f, bound) => {
    const t0 = Date.now();
    const out = f();
    const ms = Date.now() - t0;
    contract(out);
    expect(ms).toBeLessThan(bound);
  });
  test("worst corner the caps allow: 100,000 rows, event study with 20 coefficients, clustered; over the rows cap", () => {
    // mulberry32: the float LCG above cycles early over 10⁶ draws (its product leaves the exact-integer range).
    let s = 7;
    const u = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rows: string[] = ["id\tyr\ty\tx1\tx2\tpolicy"];
    for (let i = 0; i < 5000; i++) {
      const a = u();
      const start = i % 4 === 0 ? 8 + (i % 3) : -1;
      for (let t = 0; t < 20; t++) {
        const d = start >= 0 && t >= start ? 1 : 0;
        rows.push(`e${i}\t${2000 + t}\t${(a + u() + d).toFixed(4)}\t${u().toFixed(4)}\t${u().toFixed(4)}\t${d}`);
      }
    }
    const t0 = Date.now();
    // 9 leads + 8 lags = 17 dummies, 2 controls and the constant: 20 coefficients × 100,000 rows = the 2,000,000 cap.
    const out = did({ data: rows.join("\n"), outcome: "y", entity: "id", time: "yr", treat: "policy", controls: "x1 + x2", leads: "9", lags: "8" });
    const ms = Date.now() - t0;
    contract(out);
    // Either the event study, or (on a loaded machine) its named stop at the calculator's 6 s clock; the DiD estimate
    // stands either way (the E3 ARIMA 100k pattern).
    expect(out.text).toMatch(/DiD event study: relative period|event study not computed: .*took longer than 6 s/);
    // Measured 2.1 to 2.6 s on the build machine (1 worker, two other builders running); bound 3× that. A slower
    // machine stops by name at the 6 s clock instead of freezing.
    expect(ms).toBeLessThan(8000);
    // One more lead is over the cells cap and is refused up front by name (the DiD estimate itself still stands).
    const over = did({ data: rows.join("\n"), outcome: "y", entity: "id", time: "yr", treat: "policy", controls: "x1 + x2", leads: "10", lags: "8" });
    contract(over);
    expect(over.text).toMatch(/event study not computed: .*at most 2,000,000 row-coefficient cells/);
    // More than 100,000 rows is refused before the table is parsed.
    const extra = rows.join("\n") + "\ne99999\t2000\t1\t0.5\t0.5\t0";
    refused(did({ data: extra, outcome: "y", entity: "id", time: "yr", treat: "policy" }), /more than 100,000 rows/);
    refused(fe({ data: extra, ...P }), /more than 100,000 rows/);
  }, 60000);
  test("the wall clock stops a fit by name (clock mocked to jump 4 s per reading)", () => {
    let t = 1e12;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => (t += 4000));
    try {
      const out = fe({ data: panel(40, 6, 3), ...P, effects: "twoway" });
      refused(out, /took longer than 6 s/);
    } finally {
      spy.mockRestore();
    }
  });
  test("over the two-way cap is refused up front by name", () => {
    const rows = ["id\tyr\ty\tx1"];
    for (let i = 0; i < 1100; i++) for (let t = 0; t < 2; t++) rows.push(`e${i}\t${t}\t${Math.sin(i + 3 * t)}\t${Math.cos(i * t + i)}`);
    const d = parseRegData(rows.join("\n").replace(/\n(e\d+)\t1\t/g, (m) => m));
    if (!d.ok) throw new Error(d.reason);
    // 1,100 entities × 2 periods: the smaller dimension is 2, so it is fine; a 1,100 × 1,100 design is not.
    const r = readPanel(d.data, { spec: { dep: "y", preds: ["x1"], text: "" }, entity: "id", time: "yr" });
    if (!r.ok) throw new Error(r.reason);
    expect(() => fitFixedEffects({ ...r.panel, T: 1100, N: 1100 }, { effects: "twoway", se: "classical" })).toThrow(PanelRefusal);
    expect(() => fitFixedEffects({ ...r.panel, T: 1100, N: 1100 }, { effects: "twoway", se: "classical" })).toThrow(/at most 1,000/);
  });
});
