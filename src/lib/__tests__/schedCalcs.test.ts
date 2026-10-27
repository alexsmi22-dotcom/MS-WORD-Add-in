/**
 * Schedules and statement analysis (F1, gap items #9 and #13) against scripts/sched-oracle.py
 * (fixtures/sched-oracle.json): numpy-financial pmt/ipmt/ppmt for plain and balloon loans and an independent loop for
 * extra payments and rate changes; Excel SLN/SYD/DDB/VDB transcriptions checked against Microsoft's worked examples;
 * every IRS Pub 946 (2025) MACRS column re-derived from the method in exact Fractions; exact Fractions for the ratios,
 * DuPont, Altman Z and CVP.
 *
 * Tolerances: loan payments, interest and balances 1e-7 absolute (measured: about 1e-10); totals 1e-9 relative;
 * depreciation 1e-9 relative; MACRS method rates EXACT (strings); ratios 1e-12 relative to the exact fraction.
 */
import * as fs from "fs";
import * as path from "path";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";
import { SCHED_CALCS } from "../schedCalcs";
import { loanSchedule } from "../loanSchedule";
import { depreciationSchedule } from "../depreciation";
import { macrsMethodRates, macrsRates, macrsSchedule, PUB946_KNOWN_DEVIATIONS, MACRS_SL_PERIODS } from "../macrs";
import { PUB946_GDS, PUB946_SL } from "../macrsTables";
import { readStatement, ratioSuite, duPont, altmanZ, cvp } from "../statements";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sched-oracle.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any;
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));
const frac = (x: [number, number]): number => x[0] / x[1];

/** The pane's read path, copied from finSpreadContract.test.ts: number fields through readFinanceField first. */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}
const calc = (id: string): FinCalcDef => {
  const c = SCHED_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const out = (id: string, over: Record<string, string> = {}): { text: string; ok?: boolean; svg?: string; tables?: { label: string; rows: string[][]; note?: string }[] } => {
  const o = run(calc(id), over);
  return typeof o === "string" ? { text: o } : o;
};
const refused = (id: string, over: Record<string, string>): string => {
  const o = out(id, over);
  expect(o.ok).toBe(false);
  expect(o.text).not.toContain("—");
  return o.text;
};

// ------------------------------------------------------------------------------------------------------------------
describe("registry contract (the finSpreadContract read path)", () => {
  const SRC = path.join(__dirname, "..", "..");
  const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
  const i = PANE.indexOf("const FIN_CALCS: FinCalc[] = [");
  const BODY = PANE.slice(i, PANE.indexOf("\n];", i));
  const INLINE = [...BODY.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]);

  test("ids are lowercase kebab and unique against the pane's inline ids", () => {
    const ids = SCHED_CALCS.map((c) => c.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const all = [...INLINE, ...ids];
    expect(all.filter((id, k) => all.indexOf(id) !== k)).toEqual([]);
    expect(ids).toEqual(["loan-schedule", "depr-schedule", "macrs", "fin-ratios", "fin-common-size", "altman-z", "cvp-breakeven"]);
  });

  describe.each(SCHED_CALCS.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    test("known group, name not repeating it, defaults on every field", () => {
      expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
      expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
      for (const f of c.fields) expect(typeof f.default).toBe("string");
    });
    test("defaults compute to an insertable result with ≤ 6-column insertable tables", () => {
      const o0 = run(c);
      const o = typeof o0 === "string" ? { text: o0 } : o0;
      expect(o.ok).not.toBe(false);
      expect(insertableResultText(o.text)).toBe(true);
      expect(o.text).toMatch(/Conventions:/);
      const tables = o.tables ?? (o.table ? [o.table] : []);
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) {
        expect(t.rows.length).toBeGreaterThan(0);
        expect(t.rows[0].length).toBeLessThanOrEqual(6);
        for (const row of t.rows) {
          expect(row.length).toBe(t.rows[0].length);
          for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
        }
        if (t.note) expect(insertableResultText(t.note)).toBe(true);
      }
      // display contract: no ASCII minus before a digit, no e-notation in amounts
      expect(o.text).not.toMatch(/(^|[\s(])-\d/m);
      expect(o.text).not.toMatch(/\de[+-]?\d/);
    });
  });

  test("no module draws Math.random", () => {
    for (const f of ["schedCalcs", "loanSchedule", "depreciation", "macrs", "macrsTables", "statements"]) {
      expect(fs.readFileSync(path.join(SRC, "lib", f + ".ts"), "utf8")).not.toMatch(/Math\.random\s*\(/);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe("loans vs the oracle", () => {
  test.each((FX.loans as R[]).map((c: R): [string, R] => [c.name, c]))("%s", (_n, c: R) => {
    const i = c.input;
    const res = loanSchedule({
      principal: i.P,
      annualRate: i.annual,
      n: i.n,
      m: i.m,
      balloon: i.balloon ?? 0,
      amortN: i.amortN ?? undefined,
      extra: i.extra ?? 0,
      extraFrom: i.extra_from ?? 1,
      lumps: new Map(i.lumps as [number, number][]),
      rateChanges: (i.changes as [number, number][]).map(([k, rate]) => ({ k, rate })),
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.payoffK).toBe(c.payoffK);
    expect(rel(res.totalInterest, c.totalInterest)).toBeLessThan(1e-9);
    expect(rel(res.totalPaid, c.totalPaid)).toBeLessThan(1e-9);
    if (c.npfPayment !== undefined) expect(Math.abs(res.payment0 - c.npfPayment)).toBeLessThan(1e-7);
    for (const row of c.rows) {
      const t = res.rows[row.k - 1];
      for (const key of ["payment", "extra", "interest", "principal", "balance"]) expect(Math.abs(t[key as "payment"] - row[key])).toBeLessThan(1e-7);
    }
  });

  test("the calculator prints interest saved and months saved against the plain loan", () => {
    const o = out("loan-schedule");
    const c = FX.loans.find((x: R) => x.name === "extra 200 + lump 10000 at 60");
    const p = FX.loans.find((x: R) => x.name.startsWith("plain 250000 0.06 360/12 balloon 0"));
    const fmt = (x: number): string => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(o.text).toContain(`interest saved = ${fmt(p.totalInterest - c.totalInterest)}`);
    expect(o.text).toContain(`Time saved = ${p.payoffK - c.payoffK} months`);
    expect(o.text).toContain(`Paid off with payment ${c.payoffK}`);
  });

  test("biweekly loans report payments saved with months beside them", () => {
    const o = out("loan-schedule", { m: "26", years: "25", extra: "50", lumps: "" });
    expect(o.text).toMatch(/Time saved = \d+ payments \([\d.]+ months\)/);
  });

  test("the every-payment table is capped by name and falls back to the annual summary", () => {
    const o = out("loan-schedule", { view: "every", years: "40", extra: "", lumps: "" });
    expect(o.tables![0].label).toBe("Amortization schedule by year");
    expect(o.tables![0].note).toContain("at most 360 rows");
    const s = out("loan-schedule", { view: "every", years: "5", extra: "", lumps: "" });
    expect(s.tables![0].rows.length).toBe(1 + 60 + 1);
  });

  test("a long annual summary is capped at 80 rows with the omission named", () => {
    const o = out("loan-schedule", { years: "500", m: "1", rate: "1", extra: "", lumps: "" });
    expect(o.tables![0].rows.length).toBe(1 + 81 + 1);
    expect(o.tables![0].note).toContain("rows 61 to 480 are omitted");
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe("depreciation vs the oracle (Excel SLN/SYD/DDB/VDB)", () => {
  test.each((FX.depr as R[]).map((c: R): [string, R] => [`${c.cost}/${c.salvage}/${c.life} factor ${c.factor}`, c]))("%s", (_n, c: R) => {
    for (const m of ["sl", "syd", "db", "dbsl"] as const) {
      const s = depreciationSchedule({ method: m, cost: c.cost, salvage: c.salvage, life: c.life, factor: c.factor });
      if ("error" in s) throw new Error(s.error);
      expect(s.rows.map((x) => x.depreciation).length).toBe(c[m].length);
      s.rows.forEach((x, k) => expect(rel(x.depreciation, c[m][k])).toBeLessThan(1e-9));
      if (m !== "db") expect(Math.abs(s.rows[s.rows.length - 1].closing - c.salvage)).toBeLessThan(1e-9);
    }
  });
  test("units of production", () => {
    const u = FX.uop;
    const s = depreciationSchedule({ method: "uop", cost: u.cost, salvage: u.salvage, life: 0, units: u.units, totalUnits: u.total });
    if ("error" in s) throw new Error(s.error);
    s.rows.forEach((x, k) => expect(rel(x.depreciation, u.dep[k])).toBeLessThan(1e-12));
  });
  test("D11: plain DB at factor 1.5, life 5 leaves 680.70 above salvage and says so; DB → SL reaches salvage", () => {
    const o = out("depr-schedule", { method: "db", factor: "1.5", salvage: "1000" });
    expect(o.text).toContain("Book value ends 680.70 above salvage");
    const s = out("depr-schedule", { method: "dbsl", factor: "1.5", salvage: "1000" });
    expect(s.text).toContain("closing book value = 1,000.00");
    expect(s.text).toMatch(/Switches to straight line in year \d/);
  });
  test("the default DDB → SL switches in year 4 (10,000, no salvage, 5 years)", () => {
    expect(out("depr-schedule").text).toContain("Switches to straight line in year 4");
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe("MACRS: IRS Pub 946 (2025) tables re-derived from the method", () => {
  const cols = Object.entries(FX.macrs as Record<string, { dp: number; method: string[] }>);
  const deviations = new Set(PUB946_KNOWN_DEVIATIONS.flatMap((d) => d.years.map((y) => `${d.table}|${d.period}|${y}`)));

  test("every bundled column is in the oracle (6 × 5 GDS, 39 × 5 straight line)", () => {
    expect(cols.length).toBe(30 + 195);
    expect(MACRS_SL_PERIODS.length).toBe(39);
  });

  test("the TS method equals the oracle's exact-Fraction method in every column", () => {
    for (const [k, v] of cols) {
      const [tbl, per] = k.split("|");
      const gds = ["A-1", "A-2", "A-3", "A-4", "A-5"].includes(tbl);
      const conv = (["hy", "q1", "q2", "q3", "q4"] as const)[gds ? Number(tbl.slice(2)) - 1 : Number(tbl.slice(2)) - 8];
      const mult = gds ? (Number(per) >= 15 ? "1.5" : "2") : "1";
      expect([k, macrsMethodRates(per, mult, conv, v.dp)]).toEqual([k, v.method]);
    }
  });

  test("the published tables equal the method in every cell except the named deviations", () => {
    const found: string[] = [];
    let cells = 0;
    for (const [k, v] of cols) {
      const [tbl, per] = k.split("|");
      const pub = ((tbl <= "A-5" && tbl.length === 3 ? PUB946_GDS : PUB946_SL)[tbl][per] as string).split(" ");
      expect(pub.length).toBe(v.method.length);
      pub.forEach((s, y) => {
        cells++;
        if (Number(s) !== Number(v.method[y])) found.push(`${tbl}|${per}|${y + 1}`);
      });
    }
    expect(cells).toBe(3694);
    expect(found.sort()).toEqual([...deviations].sort());
  });

  test("every published column totals exactly 100%", () => {
    for (const t of [PUB946_GDS, PUB946_SL])
      for (const tbl of Object.values(t))
        for (const col of Object.values(tbl)) {
          const dp = 3;
          const total = col.split(" ").reduce((a, s) => a + Math.round(Number(s) * 10 ** dp), 0);
          expect(total).toBe(100 * 10 ** dp);
        }
  });

  test("Pub 946 (2025) chapter 4 example: 5-year property, fourth quarter, basis 10,000: 3,800 then 2,280", () => {
    const r = macrsRates("gds", "5", "q4");
    if ("error" in r) throw new Error(r.error);
    const s = macrsSchedule(10000, r.published);
    expect(s[1].depreciation).toBeCloseTo(3800, 9);
    expect(s[2].depreciation).toBeCloseTo(2280, 9);
  });

  test("the result names the table, the edition, the deviation and 'not tax advice'", () => {
    const o = out("macrs", { class: "7", conv: "q2" });
    expect(o.text).toContain("Table A-3 (the 2025 edition");
    expect(o.text).toContain("17.85%");
    expect(o.text).toContain("Not tax advice");
    expect(o.text).toMatch(/differs from the method in recovery years 1, 8/);
    expect(out("macrs").text).toContain("re-derives exactly from the method");
    expect(out("macrs", { system: "sl", slperiod: "40", conv: "q4" }).text).toContain("Table A-12");
  });

  test("schedules end at a remaining basis of exactly 0", () => {
    for (const cls of ["3", "5", "7", "10", "15", "20"])
      for (const conv of ["hy", "q1", "q2", "q3", "q4"]) {
        const t = out("macrs", { class: cls, conv, basis: "123456.78" }).tables![0];
        expect(t.rows[t.rows.length - 2][4]).toBe("0.00");
        expect(t.rows[t.rows.length - 2][3]).toBe("123,456.78");
      }
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe("statements vs exact fractions", () => {
  const stmt = calc("fin-ratios").fields.find((f) => f.key === "stmt")!.default;
  const st0 = readStatement(stmt);
  if ("error" in st0) throw new Error(st0.error);
  const st = st0;

  test("the default statement: every line recognised, a prior year, header taken off", () => {
    expect(st.unknown).toEqual([]);
    expect(st.hasPrior).toBe(true);
    expect(st.header).toEqual(["Line item", "This year", "Prior year"]);
    expect(st.items.size).toBe(19);
  });

  const check = (rows: ReturnType<typeof ratioSuite>, exp: Record<string, [number, number]>, period: "current" | "prior") => {
    for (const r of rows) {
      const f = period === "current" ? r.current : r.prior!;
      if (!f.ok) throw new Error(`${r.name}: ${f.why}`);
      const want = frac(exp[r.name]) * (r.unit === "%" ? 1 : 1);
      expect([r.name, rel(f.value, want) < 1e-12]).toEqual([r.name, true]);
    }
  };
  test("year-end ratios, this year and prior", () => {
    const rows = ratioSuite(st, { days: 365, balances: "end" });
    check(rows, FX.ratios.end, "current");
    check(rows, FX.ratios.prior, "prior");
  });
  test("average balances and a 360-day year", () => {
    check(ratioSuite(st, { days: 365, balances: "average" }), FX.ratios.average, "current");
    check(ratioSuite(st, { days: 360, balances: "end" }), FX.ratios.days360, "current");
  });
  test("DuPont 5-step components (year-end and average) multiply to ROE", () => {
    for (const [opts, exp] of [
      [{ days: 365, balances: "end" as const }, FX.ratios.dupont5_end],
      [{ days: 365, balances: "average" as const }, FX.ratios.dupont5_avg],
    ] as const) {
      const d = duPont(st, opts);
      d.five.forEach((x, k) => {
        if (!x.value.ok) throw new Error(x.label);
        expect(rel(x.value.value, frac(exp[k]))).toBeLessThan(1e-12);
      });
      const prod = d.five.reduce((a, x) => a * (x.value as { value: number }).value, 1);
      expect(rel(prod, (d.roe as { value: number }).value)).toBeLessThan(1e-12);
    }
  });
  test("Altman Z, Z′, Z″", () => {
    const a = readStatement(calc("altman-z").fields[0].default);
    if ("error" in a) throw new Error(a.error);
    for (const v of ["z", "zprime", "zdouble"] as const) {
      const z = altmanZ(a, v);
      if ("error" in z) throw new Error(z.error);
      expect(rel(z.z, frac(FX.altman[v]))).toBeLessThan(1e-12);
    }
  });
  test("CVP: the default and an awkward-decimal case with a negative target", () => {
    const c = cvp({ price: 50, variableCost: 30, fixedCosts: 40000, units: 3000, targetProfit: 20000 });
    if ("error" in c) throw new Error(c.error);
    for (const k of Object.keys(FX.cvp)) expect([k, rel(c[k as "cmUnit"] as number, frac(FX.cvp[k])) < 1e-12]).toEqual([k, true]);
    const i = FX.cvp2.input;
    const c2 = cvp({ price: Number(i.price), variableCost: Number(i.vc), fixedCosts: Number(i.fixed), units: Number(i.units), targetProfit: Number(i.target) });
    if ("error" in c2) throw new Error(c2.error);
    for (const k of Object.keys(FX.cvp2.out)) expect([k, rel(c2[k as "cmUnit"] as number, frac(FX.cvp2.out[k])) < 1e-12]).toEqual([k, true]);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe("hostile inputs and the adversarial pass", () => {
  test.each([
    ["p", "", /Enter the loan amount/],
    ["p", "NaN", /loan amount/],
    ["p", "1e400", /loan amount/],
    ["p", "−5", /loan amount must be above 0/],
    ["p", "0", /loan amount must be above 0/],
    ["rate", "-1", /annual interest rate \(%\) must be at least 0/],
    ["years", "0", /loan term \(years\) must be above 0/],
    ["years", "2.03", /whole number of payments/],
    ["extra", "-50", /Extra principal each payment cannot be negative/],
    ["extrafrom", "0", /first payment with the extra principal must be at least 1/],
    ["balloon", "300000", /balloon \(300,000.00\) cannot exceed the loan amount/],
    ["lumps", "60\t-100", /cannot be negative/],
    ["lumps", "400\t100", /from 1 to 360/],
    ["lumps", "60\t100\n60\t200", /listed twice/],
    ["lumps", "abc", /One-off extra payments/],
    ["changes", "1\t5", /from 2 to 360/],
    ["changes", "61\t150", /0% to 100%/],
    ["m", "7", /Payments per year/],
  ])("loan %s = %j is refused by name", (k, v, re) => {
    expect(refused("loan-schedule", { [k]: v })).toMatch(re);
  });

  test("balloon and amortise-over together are refused; amortise shorter than the term is refused", () => {
    expect(refused("loan-schedule", { balloon: "1000", amort: "40" })).toMatch(/either a balloon/);
    expect(refused("loan-schedule", { amort: "20" })).toMatch(/cannot be shorter/);
  });

  test("decimal comma, thousands and true minus reach the loan the way the pane reads them", () => {
    const a = out("loan-schedule", { p: "250,000", rate: "6", extra: "", lumps: "" }).text;
    expect(a).toContain("Loan 250,000.00");
    expect(out("loan-schedule", { rate: "3,5", extra: "", lumps: "" }).text).toContain("at 3.5% a year");
    expect(refused("loan-schedule", { extra: "−50" })).toMatch(/cannot be negative/);
  });

  test("0% rate: payment = principal ÷ payments, no interest", () => {
    const o = out("loan-schedule", { rate: "0", extra: "", lumps: "", years: "2", p: "12000" });
    expect(o.text).toContain("Scheduled payment = 500.00");
    expect(o.text).toContain("Total interest = 0.00");
  });

  test("an extra payment larger than the balance clears it and stops", () => {
    const o = out("loan-schedule", { lumps: "2\t10000000", extra: "" });
    expect(o.text).toContain("Paid off with payment 2");
    expect(o.ok).not.toBe(false);
    expect(o.text).not.toMatch(/−\d/); // no negative balance or interest saved
  });

  test("a balloon equal to the principal is interest-only, then the whole principal", () => {
    const o = out("loan-schedule", { balloon: "250000", extra: "", lumps: "", years: "5" });
    expect(o.text).toContain("Scheduled payment = 1,250.00");
    expect(o.text).toContain("Balloon paid with payment 60 = 250,000.00");
  });

  test("a balloon with extras: the extras reduce the balloon", () => {
    const o = out("loan-schedule", { balloon: "100000", years: "10" });
    expect(o.text).toContain("the extra payments reduce the balloon instead");
  });

  test("rate changes after payoff are named as not applying", () => {
    const o = out("loan-schedule", { lumps: "2\t10000000", extra: "", changes: "100\t7" });
    expect(o.text).toContain("Rate changes after the loan is paid off (payment 100) do not apply");
  });

  test.each([
    [{ life: "0" }, /useful life \(years\) must be at least 1/],
    [{ life: "2.5" }, /useful life \(years\) must be a whole number/],
    [{ life: "101" }, /at most 100/],
    [{ salvage: "20000" }, /Salvage value cannot exceed the cost/],
    [{ salvage: "-1" }, /salvage value must be at least 0/],
    [{ cost: "1e400" }, /cost/],
    [{ factor: "0" }, /factor must be above 0/],
    [{ method: "uop", units: "" }, /Units produced each year/],
    [{ method: "uop", units: "100, abc" }, /Units produced each year/],
    [{ method: "uop", units: "100, -5" }, /zero or more/],
    [{ method: "uop", totalunits: "0" }, /total units/],
    [{ method: "nope" }, /Choose a depreciation method/],
  ])("depreciation %j is refused by name", (over, re) => {
    expect(refused("depr-schedule", over as Record<string, string>)).toMatch(re);
  });

  test("life 1 depreciates everything in year 1 by every method", () => {
    for (const method of ["sl", "db", "dbsl", "syd"]) {
      const o = out("depr-schedule", { method, life: "1", salvage: "100" });
      expect(o.text).toContain("closing book value = 100.00");
    }
  });

  test("units beyond the estimate stop at salvage, and say so", () => {
    const o = out("depr-schedule", { method: "uop", totalunits: "4000" });
    expect(o.text).toContain("exceed the total-units estimate");
    expect(o.text).toContain("closing book value = 0.00");
  });

  test.each([
    [{ class: "8" }, /GDS property class must be 3, 5, 7, 10, 15 or 20/],
    [{ system: "sl", slperiod: "41" }, /not one Pub 946 Tables A-8 to A-12 print/],
    [{ conv: "q5" }, /half-year or a mid-quarter/],
    [{ basis: "0" }, /depreciable basis must be above 0/],
    [{ basis: "1e400" }, /depreciable basis/],
  ])("MACRS %j is refused by name", (over, re) => {
    expect(refused("macrs", over as Record<string, string>)).toMatch(re);
  });

  test("MACRS mid-quarter edges: Q4 3-year (8.33% then 61.11%) and Q1 3-year last year 1.54%", () => {
    expect(out("macrs", { class: "3", conv: "q4" }).text).toContain("8.33%, 61.11%, 20.37%, 10.19%");
    expect(out("macrs", { class: "3", conv: "q1" }).text).toContain("58.33%, 27.78%, 12.35%, 1.54%");
    expect(out("macrs", { system: "sl", slperiod: "2.5", conv: "q4" }).ok).not.toBe(false);
  });

  test("statement: duplicate items refused by line; unknown names listed, never guessed", () => {
    expect(refused("fin-ratios", { stmt: "Revenue\t100\nSales\t200\nTotal assets\t50" })).toMatch(/lines 1 \(“Revenue”\) and 2 \(“Sales”\) both give Revenue/);
    const o = out("fin-ratios", { stmt: "Revenue\t100\nTotal assets\t50\nNet income\t10\nGoodwill\t5\nRevenu\t3" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Not used (names not recognised): “Goodwill” (line 4), “Revenu” (line 5)");
    expect(refused("fin-ratios", { stmt: "Widgets\t100\nGadgets\t50" })).toMatch(/None of the line items is one this calculator recognises/);
  });

  test("statement: missing items leave ratios 'not computed' with the reason", () => {
    const o = out("fin-ratios", { stmt: "Revenue\t100\nTotal assets\t50\nNet income\t10" });
    expect(o.text).toContain("Asset turnover = revenue ÷ total assets = 2.00×");
    expect(o.text).toMatch(/Current ratio \(needs Total current assets\)/);
    const t = o.tables![0];
    expect(t.rows[0].length).toBe(4); // no prior-year column
  });

  test("statement: zero denominators are named, never Infinity", () => {
    const o = out("fin-ratios", { stmt: "Revenue\t0\nTotal assets\t50\nNet income\t10\nTotal current assets\t10\nTotal current liabilities\t0" });
    expect(o.text).toMatch(/Current ratio \(total current liabilities is 0|current liabilities is 0\)/);
    expect(o.text).toMatch(/revenue is 0/);
    expect(insertableResultText(o.text)).toBe(true);
    expect(refused("altman-z", { stmt: "Total assets\t0\nTotal current assets\t1\nTotal current liabilities\t1\nRetained earnings\t1\nOperating income\t1\nNet sales\t1\nTotal liabilities\t1\nMarket value of equity\t1" })).toMatch(/total assets is 0/);
    expect(refused("cvp-breakeven", { vc: "50" })).toMatch(/must exceed variable cost/);
  });

  test("statement: 1e400, three amounts, parentheses negatives, a blank prior year", () => {
    expect(refused("fin-ratios", { stmt: "Revenue\t1e400\nTotal assets\t50" })).toMatch(/Statement, line 1 \(“Revenue”\): an amount is not a finite number|Statement/);
    expect(refused("fin-ratios", { stmt: "Revenue\t1e400\nTotal assets\t50" })).not.toMatch(/No ratio/);
    expect(refused("fin-ratios", { stmt: "Revenue 12x\nTotal assets 50" })).toMatch(/line 1 \(“Revenue 12x”\): no amount/);
    expect(refused("fin-ratios", { stmt: "Revenue 100 90 80\nTotal assets 50" })).toMatch(/at most two amounts/);
    const o = out("fin-ratios", { stmt: "Revenue\t100\t90\nNet income\t(10)\t5\nTotal assets\t50\t" });
    expect(o.text).toContain("Net margin = net income ÷ revenue = −10.00%");
    expect(o.text).toContain("amounts in parentheses were read as negative");
    expect(o.text).toMatch(/Return on assets \(prior year\) \(needs Total assets for the prior year\)/);
  });

  test("statement: space-separated lines with comma-space labels and thousands", () => {
    const st = readStatement("Accounts receivable, net 1,500,000\nNet sales 12,000\nTotal assets 10,000");
    if ("error" in st) throw new Error(st.error);
    expect(st.items.get("receivables")!.current).toBe(1500000);
    expect(st.items.get("revenue")!.current).toBe(12000);
    // RULE N: a block whose only comma-numbers are undecidable ("1,500") is refused by name, never guessed
    const amb = readStatement("Accounts receivable 1,500\nNet sales 12,000");
    expect("error" in amb && amb.error).toMatch(/could be a number with a thousands comma/);
    // a year header is taken off; a first line of words with digits is not a header to drop
    const yr = readStatement("Line item\t2025\t2024\nRevenue\t10\t9");
    expect("error" in yr ? yr.error : yr.header).toEqual(["Line item", "2025", "2024"]);
  });

  test("statement: a number inside a name is never silently a prior-year amount", () => {
    // tab-separated, the name is one cell: its number stays in the name
    const tab = readStatement("Item\tAmount\nRevenue\t100\nLong-term debt 2027\t300\nTotal assets\t50");
    expect("error" in tab ? tab.error : tab.lines[1]).toMatchObject({ label: "Long-term debt 2027", current: 300, prior: null });
    // space-separated, a header with one amount column refuses a line with two
    expect(refused("fin-ratios", { stmt: "Item Amount\nRevenue 100\nLong-term debt 2027 300\nTotal assets 50" })).toMatch(/line 3 \(“Long-term debt”\): two amounts, but the header names one/);
    // no header: the lone two-amount line is named
    const o = out("fin-ratios", { stmt: "Revenue 100\nLong-term debt 2027 300\nTotal assets 50\nNet income 10" });
    expect(o.text).toContain("only line 2 has a second (prior-year) amount");
    // a long list of unrecognised names is cut, with the count
    const many = ["Revenue\t100", "Total assets\t50", ...Array.from({ length: 20 }, (_, i) => `Other item ${"abcdefghijklmnopqrst"[i]}\t1`)].join("\n");
    expect(out("fin-ratios", { stmt: many }).text).toContain("and 8 more");
    // currency symbols are taken off and said so
    expect(out("fin-ratios", { stmt: "Revenue\t$1,200,000\nTotal assets\t$1,000,000" }).text).toContain("currency symbols were ignored");
  });

  test("Altman: the original needs the market value of equity; Z″ does not need sales", () => {
    const base = calc("altman-z").fields[0].default.split("\n").filter((l) => !l.startsWith("Market")).join("\n");
    expect(refused("altman-z", { stmt: base })).toMatch(/needs the Market value of equity/);
    const noSales = base.split("\n").filter((l) => !l.startsWith("Net sales")).join("\n");
    expect(out("altman-z", { stmt: noSales, variant: "zdouble" }).ok).not.toBe(false);
    expect(refused("altman-z", { stmt: noSales, variant: "zprime" })).toMatch(/needs Revenue/);
  });

  test("CVP: zero sales, break-even exactly (no DOL), huge values", () => {
    expect(out("cvp-breakeven", { units: "0" }).text).toContain("Margin of safety: no sales entered");
    expect(out("cvp-breakeven", { units: "2000", target: "" }).text).toContain("operating income is 0 (at break-even)");
    expect(refused("cvp-breakeven", { price: "1e400" })).toMatch(/selling price per unit/);
    expect(refused("cvp-breakeven", { price: "0" })).toMatch(/must be above 0/);
  });
});
