/**
 * F2 item #18 (CBA, Pigouvian tax) and quick win 12 (CIP / UIP / PPP): cbaCalcs.ts against scripts/cba-oracle.py
 * (numpy-financial, sympy; fixtures/cba-oracle.json), through the pane's Finance read path (number fields through
 * readFinanceField first, as finSpreadContract.test.ts runs them), plus hostile inputs.
 */
import * as fs from "fs";
import * as path from "path";
import { CBA_CALCS, cbaMeasures, pigou, cipForward, type CbaScenario } from "../cbaCalcs";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult, type FinTable } from "../finCalc";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";

const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cba-oracle.json"), "utf8"));
const calc = (id: string): FinCalcDef => CBA_CALCS.find((c) => c.id === id)!;
/** The pane's read: number fields through the product's cell reader, everything else as typed. */
function run(c: FinCalcDef | string, over: Record<string, string> = {}): { text: string; svg?: string; ok?: boolean; tables: FinTable[] } {
  const cc = typeof c === "string" ? calc(c) : c;
  const raw = (k: string): string => over[k] ?? cc.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of cc.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  const out: FinResult = cc.compute((k) => numeric.get(k) ?? raw(k));
  const o = typeof out === "string" ? { text: out } : out;
  return { ...o, tables: o.tables ?? (o.table ? [o.table] : []) };
}
const close = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};
/** A value printed to two decimals: within half a cent of the oracle. */
const close2 = (printed: string, want: number): void => expect(Math.abs(num(printed) - want)).toBeLessThanOrEqual(0.005 + 1e-9);
const num = (s: string): number => Number(s.replace(/,/g, "").replace(/−/g, "-").replace(/%$/, ""));

describe("registry contract", () => {
  test("ids, groups, names, defaults, no Math.random, entry form", () => {
    const ids = CBA_CALCS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const src = fs.readFileSync(path.join(__dirname, "..", "cbaCalcs.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random\s*\(/);
    for (const c of CBA_CALCS) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
      expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
      for (const f of c.fields) {
        expect(typeof f.default).toBe("string");
        if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
      }
      expect(src).toMatch(new RegExp(`\\n {4}id: "${c.id}",`));
    }
    expect([...src.matchAll(/compute: \(r\) => \{\n\s*\/\/ [^\n]+\n\s*return [A-Za-z]+\(r\);/g)].length).toBe(ids.length);
    expect(calc("cba-scenarios").group).toBe("Capital budgeting & valuation");
    expect(calc("fx-cip").group).toBe("Currency");
  });

  test("the ids do not collide with the pane", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const paneIds = new Set([...pane.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]));
    for (const c of CBA_CALCS) expect(paneIds.has(c.id)).toBe(false);
  });

  test.each(CBA_CALCS.map((c) => [c.id, c] as const))("%s: defaults insertable, tables ≤ 6 columns, Conventions line", (_id, c) => {
    const o = run(c);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toMatch(/\^|NaN|Infinity|—/);
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/m);
    expect(o.text).toMatch(/Conventions:/);
    for (const t of o.tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
    }
  });

  test("no OMB A-4 rate is bundled or named, and the A-4 version caveat is printed", () => {
    const o = run("cba-scenarios");
    expect(o.text).toMatch(/check which version of A-4 is in force/);
    expect(calc("cba-scenarios").fields.find((f) => f.key === "rate")!.default).toBe("4");
    expect(calc("cba-scenarios").assumes).toMatch(/bundles no discount rate/);
  });
});

describe("CBA vs numpy-financial", () => {
  const parse = (o: ReturnType<typeof run>): string[][] => o.tables[0].rows.slice(1);
  test("default scenarios at 4%", () => {
    const rows = parse(run("cba-scenarios"));
    ORACLE.cba_default.forEach((w: Record<string, any>, k: number) => {
      close2(rows[k][1], w.pvB);
      close2(rows[k][2], w.pvC);
      close2(rows[k][3], w.npv);
      expect(Math.abs(num(rows[k][4]) - w.bcr)).toBeLessThanOrEqual(0.0005 + 1e-9);
      close(num(rows[k][5]) / 100, w.irr[0], 1e-3);
    });
    const sens = run("cba-scenarios").tables[1].rows.slice(1);
    ORACLE.cba_default.forEach((w: Record<string, any>, k: number) => w.sens.forEach((v: number, i: number) => close2(sens[i][k + 1], v)));
  });
  test("shadow-price factors 1, 0.8 on every scenario; the financial NPV printed beside", () => {
    const o = run("cba-scenarios", { factors: "1, 0.8" });
    const rows = parse(o);
    ORACLE.cba_factors.forEach((w: Record<string, any>, k: number) => {
      close2(rows[k][3], w.npv);
      close(num(rows[k][5]) / 100, w.irr[0], 1e-3);
    });
    expect(o.text).toContain(`Before the conversion factors (financial flows) the NPV is 54.42.`);
  });
  test("engine: gaps between years, a base year before the first row, two EIRRs", () => {
    const mk = (rows: number[][], base: number): CbaScenario => {
      const T = rows[rows.length - 1][0] - base;
      const s: CbaScenario = { name: "x", b: Array(T + 1).fill(0), c: Array(T + 1).fill(0), b0: Array(T + 1).fill(0), c0: Array(T + 1).fill(0) };
      for (const [y, b, c] of rows) {
        s.b[y - base] = s.b0[y - base] = b;
        s.c[y - base] = s.c0[y - base] = c;
      }
      return s;
    };
    const g = cbaMeasures(mk([[2025, 0, 500], [2027, 400, 0], [2030, 600, 0], [2032, 0, 450]], 2024), 0.06);
    const w = ORACLE.cba_gaps[0];
    close(g.pvB, w.pvB, 1e-12);
    close(g.pvC, w.pvC, 1e-12);
    close(g.npv, w.npv, 1e-9);
    const roots = [...g.irr.roots, ...g.irr.touches].sort((a, b) => a - b);
    expect(roots.length).toBe(w.irr.length);
    roots.forEach((r, i) => close(r, w.irr[i], 1e-7));
    const t = cbaMeasures(mk([[0, 0, 100], [1, 230, 0], [2, 0, 132]], 0), 0.15);
    const tw = ORACLE.cba_tworoots[0];
    const tr = [...t.irr.roots, ...t.irr.touches].sort((a, b) => a - b);
    expect(tr.length).toBe(2);
    tr.forEach((r, i) => close(r, tw.irr[i], 1e-7));
    // and through the calculator: the base-year field, the two roots and the ranking warning
    const o = run("cba-scenarios", { data: "Year\tProject benefits\tProject costs\n2025\t0\t500\n2027\t400\t0\n2030\t600\t0\n2032\t0\t450", rate: "6", base: "2024" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Project: PV of benefits/);
    expect(o.text).toMatch(/−15\.09%; 6\.62%/);
    expect(o.text).toMatch(/does not rank this scenario/);
  });
});

describe("Pigouvian tax vs sympy", () => {
  const ins: number[][] = [[100, 1, 10, 0.5, 6, 0.2], [80, 2, 20, 1, 5, 0], [50, 1, 5, 1, -4, -0.1]];
  test.each(ins.map((v, i) => [v.join(", "), i] as const))("%s", (_l, i) => {
    const [a, b, c, d, e0, e1] = ins[i];
    const r = pigou(a, b, c, d, e0, e1);
    if ("error" in r) throw new Error(r.error);
    const w = ORACLE.pigou[i];
    for (const k of ["qm", "pm", "qs", "ps", "tax", "dwl", "extM", "extS"] as const) close(r[k], w[k], 1e-12);
  });
  test("a positive externality is a subsidy, stated", () => {
    const o = run("cba-pigou", { e0: "−4", e1: "−0.1", a: "50", c: "5", d: "1" });
    expect(o.text).toMatch(/subsidy of 6\.5789 per unit/);
    expect(o.text).toMatch(/under-production/);
  });
  test("a corner optimum (no output) is stated, not refused", () => {
    const o = run("cba-pigou", { e0: "200" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Social optimum: no output/);
    // the DWL is the trapezoid ∫₀⁶⁰ (MSC − MB) dQ = ∫₀⁶⁰ (110 + 1.7Q) dQ = 9,660 (was the triangle ½·60·(MSC − MB)(60))
    expect(o.text).toMatch(/Deadweight loss of the unregulated market: 9,660\.00/);
  });
});

describe("CIP / UIP / PPP vs the parity identities", () => {
  type CipCase = { in: [number, number, number, number, number, number, string]; F: number };
  test.each((ORACLE.cip as CipCase[]).map((c): [string, CipCase] => [c.in.join(", "), c]))("%s", (_l, c) => {
    const [S, id, iff, days, bd, bf, comp] = c.in;
    const r = cipForward(S, id / 100, iff / 100, days, String(bd) as "360" | "365", String(bf) as "360" | "365", comp as "simple" | "continuous");
    close(r.F, c.F, 1e-13);
  });
  test("simple-compounding growth factors and F match QuantLib's InterestRate.compoundFactor", () => {
    for (const c of ORACLE.cipQuantLib as { in: number[]; growD: number; growF: number; F: number }[]) {
      const [S, id, iff, days, bd, bf] = c.in;
      const r = cipForward(S, id / 100, iff / 100, days, String(bd) as "360" | "365", String(bf) as "360" | "365", "simple");
      close(r.growD, c.growD, 1e-14);
      close(r.growF, c.growF, 1e-14);
      close(r.F, c.F, 1e-13);
    }
  });
  test("fx-ppp: the other mode's fields may be left blank", () => {
    expect(run("fx-ppp", { infd: "", inff: "", years: "" }).ok).not.toBe(false);
    expect(run("fx-ppp", { mode: "relative", pd: "", pf: "" }).ok).not.toBe(false);
    expect(calc("fx-ppp").fields.filter((f) => ["pd", "pf", "infd", "inff", "years"].includes(f.key)).every((f) => f.optional)).toBe(true);
  });
  test("covered arbitrage profit on the default quote", () => {
    const o = run("fx-cip");
    expect(o.text).toContain(`a riskless profit of ${ORACLE.cipProfit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
  });
  test("currency codes: amounts written with currencyAmount; unknown and non-currency codes refused by name", () => {
    const o = run("fx-cip", { base: "eur", quote: "USD" });
    expect(o.text).toMatch(/US\$1,000,000\.00.\(USD\)/u);
    expect(o.text).toMatch(/EUR\/USD: USD per EUR/);
    expect(run("fx-cip", { base: "XYZ" }).text).toMatch(/Foreign \(base\) currency: “XYZ” is not an ISO 4217 currency code/);
    expect(run("fx-cip", { quote: "XXX" }).text).toMatch(/Domestic \(quote\) currency: XXX is the ISO 4217 code for transactions/);
    expect(run("fx-cip", { base: "USD", quote: "usd" }).text).toMatch(/same \(USD\)/);
  });
  test("UIP", () => {
    const o = run("fx-uip");
    const rows = o.tables[0].rows;
    close(num(rows[1][1]) / 100, ORACLE.uip.dep, 1e-6);
    close(num(rows[4][1]), ORACLE.uip.ES, 1e-6);
    close(num(rows[5][1]) / 100, ORACLE.uip.excess, 1e-6);
    close(num(run("fx-uip", { years: "3" }).tables[0].rows[4][1]), ORACLE.uip.ES3, 1e-6);
  });
  test("PPP absolute and relative", () => {
    const a = run("fx-ppp").tables[0].rows;
    close(num(a[1][1]), ORACLE.ppp.sppp, 1e-6);
    close(num(a[3][1]), ORACLE.ppp.q, 1e-4);
    close(num(a[4][1]) / 100, ORACLE.ppp.mis, 1e-4);
    const r = run("fx-ppp", { mode: "relative" }).tables[0].rows;
    close(num(r[1][1]) / 100, ORACLE.ppp.perYear, 1e-6);
    close(num(r[3][1]), ORACLE.ppp.ST, 1e-6);
  });
});

describe("hostile inputs refuse by field name", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["cba-scenarios", { rate: "" }, /Enter the social discount rate/],
    ["cba-scenarios", { rate: "abc" }, /Social discount rate .*not a finite number/],
    ["cba-scenarios", { rate: "1e400" }, /Social discount rate/],
    ["cba-scenarios", { rate: "−100" }, /Social discount rate .* must be above −99/],
    ["cba-scenarios", { data: "Year\tA benefits\n2026\t5" }, /2 columns; expected a year column/],
    ["cba-scenarios", { data: "2026\t0\t100\n2026\t50\t0" }, /years must increase/],
    ["cba-scenarios", { data: "2026.5\t0\t100\n2027\t50\t0" }, /not a whole number/],
    ["cba-scenarios", { data: "Year\tB\tC\n2026\t0\t100\n2027\t\t0" }, /a value is missing/],
    ["cba-scenarios", { base: "2030" }, /base year 2030 is after the first year/],
    ["cba-scenarios", { data: "0\t0\t100\n500\t50\t0" }, /spans 500 years/],
    ["cba-scenarios", { factors: "1, 2, 3" }, /3 values; enter 2/],
    ["cba-scenarios", { factors: "1, −1" }, /factor 2 must be between 0 and 100/],
    ["cba-pigou", { b: "0" }, /Demand slope b must be above 0/],
    ["cba-pigou", { a: "5" }, /market does not trade/],
    ["fx-cip", { spot: "0" }, /Spot rate .* must be above 0/],
    ["fx-cip", { days: "0" }, /Tenor \(days\) must be at least 1/],
    ["fx-cip", { days: "30.5" }, /Tenor \(days\) must be a whole number/],
    ["fx-cip", { id: "−100" }, /Domestic interest rate .* must be above −99/],
    ["fx-uip", { years: "0" }, /Horizon \(years\) must be above 0/],
    ["fx-ppp", { pf: "" }, /Enter the foreign price level/],
    ["fx-ppp", { mode: "relative", inff: "nope" }, /Foreign inflation .*not a finite number/],
  ];
  test.each(cases)("%s %j", (id, over, re) => {
    const o = run(id, over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).toMatch(/^[A-Z“]/);
  });

  test("decimal comma, thousands and true minus are read by the pane's reader", () => {
    expect(run("fx-cip", { spot: "1,25" }).text).toContain("Spot S = 1.250000");
    expect(run("fx-cip", { notional: "2,000,000" }).text).toContain("Borrow 2,000,000.00 domestic");
    expect(run("cba-pigou", { e0: "−4" }).ok).not.toBe(false);
  });

  test("a 200-year, 4-scenario table stays fast", () => {
    const rows = ["Year\tA benefits\tA costs\tB benefits\tB costs\tC benefits\tC costs\tD benefits\tD costs"];
    for (let t = 0; t <= 200; t++) rows.push([2000 + t, t ? 100 : 0, t ? 20 : 1000, t ? 90 : 0, t ? 25 : 900, t ? 120 : 0, t ? 30 : 1300, t ? 80 : 0, t ? 10 : 700].join("\t"));
    const t0 = Date.now();
    const o = run("cba-scenarios", { data: rows.join("\n") });
    expect(o.ok).not.toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
