/**
 * Schedules and statement analysis (F1, gap items #9 and #13) against scripts/sched-oracle.py
 * (fixtures/sched-oracle.json): numpy-financial pmt/ipmt/ppmt for plain and balloon loans and an independent loop for
 * extra payments and rate changes; Excel SLN/SYD/DDB/VDB transcriptions checked against Microsoft's worked examples;
 * every IRS Pub 946 (2025) MACRS column re-derived from the method in exact Fractions; exact Fractions for the ratios,
 * DuPont, Altman Z and CVP.
 *
 * Tolerances: loans EXACT to the cent against the oracle's Decimal ROUND_HALF_UP loop (the lender cent convention), and
 * within the derived cent-rounding bound of the unrounded numpy-financial schedule (stated at that test); totals exact;
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
import { readStatement, ratioSuite, duPont, altmanZ, cvp, LINE_ITEMS, LOSS_NAMES } from "../statements";

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
  const loanOf = (i: R) =>
    loanSchedule({
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

  // EXACT: the lender cent convention against the oracle's independent Decimal ROUND_HALF_UP loop, every row, in cents
  test.each((FX.loansCents as R[]).map((c: R): [string, R] => [c.name, c]))("cents, exact: %s", (name, c: R) => {
    const res = loanOf(FX.loans.find((x: R) => x.name === name).input);
    if ("error" in res) throw new Error(res.error);
    expect(res.payoffK).toBe(c.payoffK);
    expect(Math.round(res.payment0 * 100)).toBe(c.payment0C);
    expect(res.totalsC.interest).toBe(c.totalInterestC);
    expect(res.totalsC.paid).toBe(c.totalPaidC);
    expect(res.totalsC.extra).toBe(c.totalExtraC);
    expect(res.rows.map((x) => `${x.k} ${x.c.payment} ${x.c.extra} ${x.c.interest} ${x.c.principal} ${x.c.balance}`)).toEqual(c.rows);
  });

  // TOLERANCE vs the exact (unrounded) numpy-financial schedule. Cent rounding moves the schedule: the payment is off
  // by at most ½ cent and each period's interest by at most ½ cent, and those differences compound in the balance, so
  // after k payments |Δbalance| ≤ 0.01 × ((1 + i)ᵏ − 1)/i (i the largest periodic rate in force); about 5.02 at
  // payment 360 of a 6% monthly loan. Interest per row is within i × that bound + 0.005; totals within n × 0.01 plus
  // the final balance bound. The exact cent schedule is pinned above; this checks it stays near the textbook one.
  test.each((FX.loans as R[]).map((c: R): [string, R] => [c.name, c]))("near numpy-financial: %s", (_n, c: R) => {
    const i = c.input;
    const res = loanOf(i);
    if ("error" in res) throw new Error(res.error);
    expect(res.payoffK).toBe(c.payoffK);
    const iMax = Math.max(i.annual, ...(i.changes as [number, number][]).map((x) => x[1])) / i.m;
    const balBound = (k: number): number => 0.01 * (iMax === 0 ? k : (Math.pow(1 + iMax, k) - 1) / iMax) + 1e-9;
    const n = res.payoffK;
    expect(Math.abs(res.totalPaid - c.totalPaid)).toBeLessThanOrEqual(n * 0.01 + balBound(n));
    expect(Math.abs(res.totalInterest - c.totalInterest)).toBeLessThanOrEqual(n * 0.01 + balBound(n));
    if (c.npfPayment !== undefined) expect(Math.abs(res.payment0 - c.npfPayment)).toBeLessThanOrEqual(0.005 + 1e-9);
    for (const row of c.rows) {
      const t = res.rows[row.k - 1];
      expect(Math.abs(t.balance - row.balance)).toBeLessThanOrEqual(balBound(row.k));
      expect(Math.abs(t.interest - row.interest)).toBeLessThanOrEqual(iMax * balBound(row.k - 1) + 0.005 + 1e-9);
    }
  });

  /** Cells → whole cents (BigInt), exactly as printed. */
  const C = (s: string): bigint => {
    const neg = s.startsWith("−");
    const [w, f] = s.replace("−", "").replace(/,/g, "").split(".");
    const v = BigInt(w) * 100n + BigInt(f);
    return neg ? -v : v;
  };
  const sumCol = (rows: string[][], j: number): bigint => rows.reduce((a, r) => a + C(r[j]), 0n);
  test.each([
    ["default", {}],
    ["plain 360 payments", { extra: "", lumps: "" }],
    ["balloon", { balloon: "100000", years: "10" }],
    ["rate change", { changes: "61\t7.25\n121\t4.125", extra: "", lumps: "" }],
    ["rate change with extras", { changes: "61\t7.25" }],
    ["0% loan", { rate: "0", p: "10000", years: "3", extra: "", lumps: "" }],
    ["very large principal", { p: "9876543210987.65", rate: "7.3", extra: "", lumps: "" }],
    ["biweekly odd amounts", { p: "123456.78", rate: "5.125", m: "26", years: "13", extra: "37.11", lumps: "100\t5000.55" }],
  ])("printed tables add up exactly to the cent: %s", (_n, over) => {
    for (const view of ["every", "annual"]) {
      // every-payment view needs ≤ 360 rows; the 13-year biweekly loan has 338
      const o = out("loan-schedule", { ...(over as Record<string, string>), view });
      expect(o.ok).not.toBe(false);
      const t = o.tables![0];
      const body = t.rows.slice(1, -1);
      const total = t.rows[t.rows.length - 1];
      expect(body.some((r) => r.includes("…"))).toBe(false);
      if (t.label === "Amortization schedule, every payment") {
        let prev: bigint | null = null;
        for (const r of body) {
          // scheduled payment + extra = interest + principal; previous balance − principal = balance
          expect(C(r[1]) + C(r[2])).toBe(C(r[3]) + C(r[4]));
          if (prev !== null) expect(prev - C(r[4])).toBe(C(r[5]));
          prev = C(r[5]);
        }
        for (const j of [1, 2, 3, 4]) expect(sumCol(body, j)).toBe(C(total[j]));
      } else {
        for (const r of body) expect(C(r[1]) + C(r[2])).toBe(C(r[4]));
        for (const j of [1, 2, 3, 4]) expect(sumCol(body, j)).toBe(C(total[j]));
      }
      expect(body[body.length - 1][5]).toBe("0.00");
      expect(C(total[view === "every" ? 4 : 2])).toBe(C(o.text.match(/^Loan ([\d,.]+)/)![1]));
    }
  });

  test("a one-off payment at the last scheduled payment is reported as not applied, never dropped silently", () => {
    const o = out("loan-schedule", { extra: "", lumps: "360\t5000" });
    expect(o.text).toContain("One-off extra payment listed for payment 360 is not applied: that payment clears the loan anyway");
    const b = out("loan-schedule", { extra: "", lumps: "60\t5000", balloon: "100000", years: "5" });
    expect(b.text).toContain("One-off extra payment listed for payment 60 is not applied");
    expect(b.text).toContain("balloon included");
  });

  test("tiny loans: below 1.00 refused; a payment that rounds to no more than its interest refused", () => {
    expect(refused("loan-schedule", { p: "0.01", extra: "", lumps: "" })).toMatch(/Loan amount must be at least 1/);
    expect(refused("loan-schedule", { p: "1", extra: "", lumps: "" })).toMatch(/^Over 360 payments the payment rounds to 0\.01 a period, no more than the first period's interest \(0\.01\)/);
    expect(out("loan-schedule", { p: "1", years: "1", extra: "", lumps: "" }).ok).not.toBe(false);
  });

  test("the last payment adjusts for the cents and says so", () => {
    const o = out("loan-schedule", { rate: "0", p: "10000", years: "3", extra: "", lumps: "" });
    expect(o.text).toContain("Scheduled payment = 277.78");
    expect(o.text).toContain("Last payment (payment 36) = 277.70");
    expect(o.text).toContain("interest rounded half up to the cent each period");
    expect(o.text).toContain("the last payment adjusts");
  });

  test("the calculator prints interest saved and months saved against the plain loan", () => {
    const o = out("loan-schedule");
    const c = FX.loansCents.find((x: R) => x.name === "extra 200 + lump 10000 at 60");
    const p = FX.loansCents.find((x: R) => x.name.startsWith("plain 250000 0.06 360/12 balloon 0"));
    const fmt = (x: number): string => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(o.text).toContain(`interest saved = ${fmt((p.totalInterestC - c.totalInterestC) / 100)}`);
    expect(o.text).toContain("interest saved = 103,259.80");
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

  test("the default statement: every line recognized, a prior year, header taken off", () => {
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
    ["p", "NaN", /^Loan amount/],
    ["p", "1e400", /^Loan amount/],
    ["p", "−5", /^Loan amount must be at least 1\./],
    ["p", "0", /^Loan amount must be at least 1\./],
    ["p", "0.99", /^Loan amount must be at least 1\./],
    ["rate", "-1", /^Annual interest rate \(%\) must be at least 0/],
    ["years", "0", /^Loan term \(years\) must be above 0/],
    ["years", "2.03", /whole number of payments/],
    ["extra", "-50", /Extra principal each payment cannot be negative/],
    ["extrafrom", "0", /^First payment with the extra principal must be at least 1/],
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

  test("balloon and amortize-over together are refused; amortize shorter than the term is refused", () => {
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

  // F1 review round 2, item 1: a re-amortized payment that rounds to no more than that period's interest went
  // interest-only silently (357 payments of 0.02) and ended in a huge last payment called "cent rounding"
  test("a recast payment that would not amortize is refused, naming the rate change", () => {
    const a = refused("loan-schedule", { p: "1000", rate: "6", years: "30", extra: "", lumps: "2\t994.00", changes: "3\t6" });
    expect(a).toMatch(/^At the rate change at payment 3 \(6% a year\) the payment re-amortized over the 358 payments left rounds to 0\.02 a period, no more than that period's interest \(0\.02\)/);
    expect(a).toContain("or make smaller extra payments before it");
    const b = refused("loan-schedule", { p: "100000", rate: "1", years: "1000", extra: "", lumps: "", changes: "2\t3" });
    expect(b).toMatch(/^At the rate change at payment 2 \(3% a year\) the payment re-amortized over the 11,999 payments left rounds to 250\.00 a period, no more than that period's interest \(250\.00\)/);
    expect(b).not.toContain("extra payments");
    // interest-only to a balloon equal to the balance is intended, at a recast too
    const c = out("loan-schedule", { balloon: "250000", extra: "", lumps: "", years: "5", changes: "13\t7" });
    expect(c.ok).not.toBe(false);
    expect(c.text).toContain("From payment 13: 7% a year, payment re-amortized to 1,458.33");
    expect(c.text).toContain("Balloon paid with payment 60 = 250,000.00");
  });

  test("the last payment says 'cent rounding' only when it is rounding-sized; otherwise its size and why", () => {
    // a 1,000-year loan at 0.51%: the payment 42.76 is rounded down and the shortfall grows with interest over 12,000
    // payments to a last payment ten times the scheduled one: stated plainly, never "cent rounding"
    const t = out("loan-schedule", { p: "100000", rate: "0.51", years: "1000", extra: "", lumps: "", changes: "" }).text;
    expect(t).toContain(
      "Last payment (payment 12,000) = 434.59: the remaining balance plus its interest, 391.83 more than the scheduled 42.76: rounding the payment and each period's interest to the cent leaves part of the balance unpaid, and interest over 12,000 payments grows that difference to this size",
    );
    expect(t).not.toContain("cent rounding)");
    // the default 30-year loan: 3.43 less than the payment over 360 payments is rounding-sized
    const d = out("loan-schedule", { extra: "", lumps: "", changes: "" }).text;
    expect(d).toContain("Last payment (payment 360) = 1,495.45: the remaining balance plus its interest (the last payment adjusts for the cent rounding)");
    // an extra payment that does not shorten the loan lowers the last payment: said, not called cent rounding
    const e = out("loan-schedule", { p: "100000", rate: "0", years: "1000", m: "1", extra: "", lumps: "2\t1", changes: "" }).text;
    expect(e).toContain("Last payment (payment 1,000) = 99.00: the remaining balance plus its interest (the last payment adjusts after the extra payments)");
  });

  // F1 review round 2, item 2: a payment rounded UP ended the loan early with no extra payments, silently, and the text
  // blamed "extra payments"
  test("a payment rounded up that ends the loan early says so; extra payments are not mentioned when there are none", () => {
    const a = out("loan-schedule", { p: "10", rate: "0", years: "30", extra: "", lumps: "", changes: "" }).text;
    expect(a).toContain("Scheduled payment = 0.03");
    expect(a).toContain("Paid off with payment 334 of 360 (27 years 10 months): the payment rounded up to the cent pays the loan off early");
    expect(a).toContain("Last payment (payment 334) = 0.01: the remaining balance plus its interest (the last payment is smaller: the payment rounded up to the cent pays the loan off with payment 334 of 360)");
    expect(a).not.toMatch(/extra payment/i);
    const b = out("loan-schedule", { p: "2", rate: "0", years: "10", extra: "", lumps: "", changes: "" }).text;
    expect(b).toContain("Paid off with payment 100 of 120 (8 years 4 months)");
    const c = out("loan-schedule", { p: "100000", rate: "1", years: "1000", extra: "", lumps: "", changes: "" }).text;
    expect(c).toContain("Paid off with payment 11,331 of 12,000 (944 years 3 months)");
    expect(c).not.toMatch(/extra payment/i);
    // with extras that do shorten it, both payoffs are named and the rounding is said
    const d = out("loan-schedule", { p: "10", rate: "0", years: "30", extra: "", lumps: "5\t1", changes: "" }).text;
    expect(d).toMatch(/Paid off with payment \d+ \(.*\) instead of payment 334 \(27 years 10 months\); without them the payment rounded up to the cent pays the loan off with payment 334 of 360/);
    // an extra payment that changes nothing never yields "payment X instead of payment X"
    const e = out("loan-schedule", { p: "10", rate: "0", years: "30", extra: "", lumps: "334\t1", changes: "" }).text;
    expect(e).not.toMatch(/payment (\d+) \([^)]*\) instead of payment \1 /);
    expect(e).toContain("Paid off with payment 334 of 360 (27 years 10 months): the payment rounded up to the cent pays the loan off early, and the extra payments do not end it sooner");
  });

  // F1 review round 2, item 6: the float payment formula was a cent off exact half-up in 73 of 30,000 random loans above
  // about 1.2·10¹⁰ (checked with the reviewer's Decimal oracle, pm.py, prec 60); now exact (0 of 26,033 after the fix)
  test.each([
    [7031359672646, 3.466, 12, 39, 190896300923], // exact 190,896,300,922.50027… cents: half up
    [1222117208044, 0.287, 52, 6, 203725549841],
    [1343889236550, 0.029, 26, 83, 16199022806],
    [1337211132149, 0.001, 24, 425, 3146658384],
    [1841901540856, 0.027, 26, 17, 108357276034],
  ])("exact level payment: %d cents at %d%%, m = %d, n = %d → %d cents", (pc, rp, m, n, want) => {
    const r = loanSchedule({ principal: pc / 100, annualRate: rp / 100, n, m });
    if ("error" in r) throw new Error(r.error);
    expect(Math.round(r.payment0 * 100)).toBe(want);
  });
  test("exact payment through the pane, and 120 recasts on 12,000 payments stay fast", () => {
    expect(out("loan-schedule", { p: "70313596726.46", rate: "3.466", years: "3.25", extra: "", lumps: "", changes: "" }).text).toContain("Scheduled payment = 1,908,963,009.23");
    const changes = Array.from({ length: 120 }, (_, j) => `${j + 2}\t${(0.3123456789 + j * 0.0013).toFixed(10)}`).join("\n");
    const t0 = Date.now();
    const o = out("loan-schedule", { p: "9876543210000", rate: "0.3123457", years: "1000", extra: "1", lumps: "100\t50", changes });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(o.ok).not.toBe(false);
  });

  test("extra payments before a recast that make the loan run longer: said, never a negative time saved", () => {
    const o = out("loan-schedule", { p: "10", rate: "0", years: "30", extra: "", lumps: "5\t1", changes: "100\t0" }).text;
    expect(o).toContain(
      "Paid off with payment 360 (30 years) against payment 334 (27 years 10 months) without the extra payments: the extra payments lowered the payment re-amortized at the rate change, so the loan runs longer",
    );
    expect(o).toContain("Time saved: none (the loan runs 26 months longer)");
    expect(o).not.toMatch(/-\d|−\d/);
  });

  test("years of a long payoff are grouped in thousands", () => {
    const o = out("loan-schedule", { p: "100000", rate: "0", years: "1000", m: "1", extra: "", lumps: "2\t50000", changes: "" }).text;
    expect(o).toContain("Paid off with payment 500 (500 years) instead of payment 1,000 (1,000 years)");
  });

  test("rate changes after payoff are named as not applying", () => {
    const o = out("loan-schedule", { lumps: "2\t10000000", extra: "", changes: "100\t7" });
    expect(o.text).toContain("Rate changes after the loan is paid off (payment 100) do not apply");
  });

  test.each([
    [{ life: "0" }, /^Useful life \(years\) must be at least 1/],
    [{ life: "2.5" }, /^Useful life \(years\) must be a whole number/],
    [{ life: "101" }, /at most 100/],
    [{ salvage: "20000" }, /Salvage value cannot exceed the cost/],
    [{ salvage: "-1" }, /^Salvage value must be at least 0/],
    [{ cost: "1e400" }, /^Cost: /],
    [{ factor: "0" }, /factor must be above 0/],
    [{ method: "uop", units: "" }, /Units produced each year/],
    [{ method: "uop", units: "100, abc" }, /Units produced each year/],
    [{ method: "uop", units: "100, -5" }, /zero or more/],
    [{ method: "uop", totalunits: "0" }, /^Total units/],
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
    [{ basis: "0" }, /^Depreciable basis must be above 0/],
    [{ basis: "1e400" }, /^Depreciable basis/],
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
    expect(o.text).toContain("Not used (names not recognized): “Goodwill” (line 4), “Revenu” (line 5)");
    expect(refused("fin-ratios", { stmt: "Widgets\t100\nGadgets\t50" })).toMatch(/None of the line items is one this calculator recognizes/);
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
    // a statement is read in the US style (stated in Conventions): a lone "1,500" is fifteen hundred
    const amb = readStatement("Accounts receivable 1,500\nNet sales 12,000");
    expect("error" in amb ? amb.error : amb.items.get("receivables")!.current).toBe(1500);
    // a year header is taken off; a first line of words with digits is not a header to drop
    const yr = readStatement("Line item\t2025\t2024\nRevenue\t10\t9");
    expect("error" in yr ? yr.error : yr.header).toEqual(["Line item", "2025", "2024"]);
  });

  test("statement: a number inside a name is never silently a prior-year amount", () => {
    // tab-separated, the name is one cell: its number stays in the name
    const tab = readStatement("Item\tAmount\nRevenue\t100\nLong-term debt 2027\t300\nTotal assets\t50");
    expect("error" in tab ? tab.error : tab.lines[1]).toMatchObject({ label: "Long-term debt 2027", current: 300, prior: null });
    // space-separated, a header with one amount column: the last number is the amount, the rest the name (round 2)
    const hd = readStatement("Item Amount\nRevenue 100\nLong-term debt 2027 300\nTotal assets 50");
    if ("error" in hd) throw new Error(hd.error);
    expect(hd.lines[1]).toMatchObject({ label: "Long-term debt 2027", current: 300, prior: null });
    expect(hd.notes).toContain("Statement, line 3: the header names 1 amount column, so the last number is the amount and “Long-term debt 2027” is the line-item name, numbers included.");
    // tab-separated, a header with one amount column still refuses a line with two cells of amounts
    expect(refused("fin-ratios", { stmt: "Item\tAmount\nRevenue\t100\nLong-term debt\t2027\t300\nTotal assets\t50" })).toMatch(/line 3 \(“Long-term debt”\): two amounts, but the header names one/);
    // no header, space-separated: the lone two-amount line is refused, quoted as typed (round 2: was a note)
    expect(refused("fin-ratios", { stmt: "Revenue 100\nLong-term debt 2027 300\nTotal assets 50\nNet income 10" })).toMatch(
      /^Statement: line 2 \(“Long-term debt 2027 300”\) has two amounts where the other lines have one, and there is no header row/,
    );
    // no header, tab-separated: the name is its own cell, so it stays a note
    const o = out("fin-ratios", { stmt: "Revenue\t100\nLong-term debt\t2027\t300\nTotal assets\t50\nNet income\t10" });
    expect(o.text).toContain("only line 2 (“Long-term debt”) has a second (prior-year) amount");
    // a long list of unrecognized names is cut, with the count
    const many = ["Revenue\t100", "Total assets\t50", ...Array.from({ length: 20 }, (_, i) => `Other item ${"abcdefghijklmnopqrst"[i]}\t1`)].join("\n");
    expect(out("fin-ratios", { stmt: many }).text).toContain("and 8 more");
    // currency symbols are taken off and said so
    expect(out("fin-ratios", { stmt: "Revenue\t$1,200,000\nTotal assets\t$1,000,000" }).text).toContain("currency symbols were ignored");
  });

  test("F1 review C: a line named as a loss or deficit is a negative amount, and the result says so", () => {
    const def = calc("altman-z").fields[0].default.replace("Retained earnings\t350,000", "Accumulated deficit\t350,000");
    const a = out("altman-z", { stmt: def });
    expect(a.text).toContain("X₂ = retained earnings ÷ total assets = −0.3500");
    expect(a.text).toContain("Z = 2.6240: grey zone");
    expect(a.text).toContain("“Accumulated deficit 350,000” read as retained earnings −350,000: a line named as a loss is a negative amount");
    // typed negative, parentheses: still −|x|, never flipped back to positive
    expect(out("altman-z", { stmt: def.replace("350,000", "(350,000)") }).text).toContain("Z = 2.6240");
    const r = out("fin-ratios", { stmt: "Revenue\t1,000\nNet loss\t50\nTotal assets\t500" });
    expect(r.text).toContain("Net margin = net income ÷ revenue = −5.00%");
    expect(r.text).toContain("“Net loss 50” read as net income −50");
    // two columns, other loss names
    const t = readStatement("Revenue 1000 900\nOperating loss 30 20\nLoss before income taxes 40 25\nNet loss for the year 45 −10\nTotal assets 500 450");
    if ("error" in t) throw new Error(t.error);
    expect([t.items.get("ebit")!.current, t.items.get("ebit")!.prior, t.items.get("ebt")!.current, t.items.get("netIncome")!.prior]).toEqual([-30, -20, -40, -10]);
    // combined names keep the sign as typed
    const k = readStatement("Revenue 1000\nNet income (loss) 50\nRetained earnings (accumulated deficit) −20\nOperating income (loss) 7");
    if ("error" in k) throw new Error(k.error);
    expect([k.items.get("netIncome")!.current, k.items.get("retainedEarnings")!.current, k.items.get("ebit")!.current]).toEqual([50, -20, 7]);
    expect(k.notes.join(" ")).not.toContain("read as");
  });

  // F1 review round 2, item 8a: a loss line with an amount typed as negative keeps both signs as typed
  test("loss line with mixed signs keeps the signs as typed, and says so", () => {
    const a = readStatement("Revenue\t100\t90\nNet loss\t(50)\t30\nTotal assets\t500\t400");
    if ("error" in a) throw new Error(a.error);
    expect([a.items.get("netIncome")!.current, a.items.get("netIncome")!.prior]).toEqual([-50, 30]);
    expect(a.notes).toContain("Statement: “Net loss (50) 30” read as net income −50 (prior year 30): a loss line with an amount typed as negative keeps each amount’s sign as typed.");
    const b = readStatement("Revenue 100 90\nNet loss 50 (20)\nTotal assets 500 400");
    if ("error" in b) throw new Error(b.error);
    expect([b.items.get("netIncome")!.current, b.items.get("netIncome")!.prior]).toEqual([50, -20]);
    // bare positives: a loss by the name
    const c = readStatement("Revenue 100 90\nNet loss 50 20\nTotal assets 500 400");
    if ("error" in c) throw new Error(c.error);
    expect([c.items.get("netIncome")!.current, c.items.get("netIncome")!.prior]).toEqual([-50, -20]);
    // through the pane: net margin of the typed −50
    expect(out("fin-ratios", { stmt: "Revenue\t1,000\t900\nNet loss\t(50)\t30\nTotal assets\t500\t400" }).text).toContain("Net margin = net income ÷ revenue = −5.00%");
  });

  // F1 review round 2, item 3: comma rows were refused as possibly one amount whenever the second part had 3 digits
  test("comma-separated statements: only a 1–3 digit part then 3 digits is ambiguous; CSV names with spaces and quotes read", () => {
    const rd = (s: string): string => {
      const r = readStatement(s);
      return "error" in r ? r.error : r.lines.map((l) => `${l.label}|${l.current}|${l.prior}`).join(";");
    };
    expect(rd("Revenue,1000,900")).toBe("Revenue|1000|900");
    expect(rd("Revenue,-1000,900")).toBe("Revenue|-1000|900");
    expect(rd("Revenue,1000.5,900.25")).toBe("Revenue|1000.5|900.25");
    expect(rd("Revenue,1500,1200\nCOGS,600,450")).toBe("Revenue|1500|1200;COGS|600|450");
    expect(rd('"Revenue","1,000","900"')).toBe("Revenue|1000|900");
    expect(rd("Cost of sales,600,500\nRevenue,1000,900")).toBe("Cost of sales|600|500;Revenue|1000|900");
    expect(rd("Revenue,100,900")).toMatch(/^Statement, line 1 \(“Revenue”\): “100,900” could be one amount with a thousands comma or two amounts/);
    expect(rd("Revenue,5,900")).toMatch(/“5,900” could be one amount/);
    expect(rd("Cost of sales,5,900")).toMatch(/“5,900” could be one amount/);
    // a block whose other lines settle two columns reads the pair as two amounts, and says so
    const st = readStatement("Revenue,1500,1200\nCOGS,600,450");
    if ("error" in st) throw new Error(st.error);
    expect(st.notes.join(" ")).toContain("line 2 (“600,450”): read as two amounts");
    // space-separated grouped amounts are unchanged
    expect(rd("Accounts receivable 1,500\nNet sales 12,000")).toBe("Accounts receivable|1500|null;Net sales|12000|null");
    // through the pane
    expect(out("fin-ratios", { stmt: "Revenue,1000,900\nNet income,100,90\nTotal assets,500,450" }).text).toContain("Net margin = net income ÷ revenue = 10.00%");
  });

  // F1 review round 2, item 4: a number inside a name between spaces is never read silently into the wrong columns;
  // refusals quote the whole line as typed
  test("numbers inside a line-item name between spaces: header decides, else refused quoting the line", () => {
    expect(refused("fin-ratios", { stmt: "Preferred stock, 5,000 shares authorized 500\nRevenue 1000" })).toMatch(/^Statement, line 1 \(“Preferred stock, 5,000 shares authorized 500”\): a number inside the line-item name \(“5,000”\)/);
    expect(refused("fin-ratios", { stmt: "Common stock, $0.01 par value 500\nRevenue 1000" })).toMatch(/^Statement, line 1 \(“Common stock, \$0\.01 par value 500”\)/);
    expect(refused("fin-ratios", { stmt: "Accounts receivable, net of allowance of $1,200 50,000\nRevenue 1000" })).toMatch(
      /^Statement: line 1 \(“Accounts receivable, net of allowance of \$1,200 50,000”\) has two amounts where the other lines have one, and there is no header row/,
    );
    const h = readStatement("Item 2025 2024\nAccounts receivable, net of allowance of $1,200 50,000 40,000\nRevenue 1000 900");
    if ("error" in h) throw new Error(h.error);
    expect(h.lines[0]).toMatchObject({ label: "Accounts receivable, net of allowance of $1,200", current: 50000, prior: 40000 });
    expect(h.notes.join(" ")).toContain("the header names 2 amount columns, so the last 2 numbers are the amounts and “Accounts receivable, net of allowance of $1,200” is the line-item name");
    const h1 = readStatement("Item 2025\nCommon stock, $0.01 par value 500\nRevenue 1000");
    if ("error" in h1) throw new Error(h1.error);
    expect(h1.lines[0]).toMatchObject({ label: "Common stock, $0.01 par value", current: 500, prior: null });
    expect(refused("fin-ratios", { stmt: "Revenue 100 90 80\nTotal assets 50" })).toMatch(/^Statement, line 1 \(“Revenue 100 90 80”\): 3 numbers at the end of the line, but a line has at most two amounts/);
    // the earlier reviewer cases still behave
    expect(readStatement("Line item FY2023 FY2022\nRevenue 10 9\nTotal assets 5 4")).toMatchObject({ header: ["Line", "item", "FY2023", "FY2022"] });
    // "FY 2023" between spaces is one heading in two tokens: two amount columns, not one
    for (const hdr of ["Line item FY 2023 FY 2022", "Line item CY 2023 CY 2022", "Line item FY’ 2023 FY’ 2022"]) {
      const fy = readStatement(`${hdr}\nRevenue 10 9\nTotal assets 5 4`);
      if ("error" in fy) throw new Error(fy.error);
      expect([hdr, fy.items.get("revenue")?.current, fy.items.get("revenue")?.prior, fy.notes]).toEqual([hdr, 10, 9, []]);
    }
    // a no-break space before an amount (from Word or a PDF): the name is still the name
    const nb = String.fromCharCode(0xa0);
    const nbs = readStatement(`Revenue${nb}1,000\nTotal assets 500`);
    if ("error" in nbs) throw new Error(nbs.error);
    expect(nbs.items.get("revenue")?.current).toBe(1000);
    // tab-separated, three amounts: the refusal quotes the line
    expect(refused("fin-ratios", { stmt: "Revenue\t100\t90\t80\nTotal assets\t50" })).toMatch(/^Statement, line 1 \(“Revenue 100 90 80”\): at most two amounts per line/);
    expect("error" in readStatement("Revenue 100\nNotes 5.25% due later 1,000")).toBe(false);
  });

  test("every loss name is a recognized line-item name", () => {
    const all = new Set(LINE_ITEMS.flatMap((x) => x.names));
    expect([...LOSS_NAMES].filter((n) => !all.has(n))).toEqual([]);
  });

  test("timing: a 12,000-payment loan with extra payments (both schedules) stays under 300 ms", () => {
    const t0 = Date.now();
    const o = out("loan-schedule", { years: "1000", m: "12", rate: "0.5", extra: "1", lumps: "100\t50" });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(o.ok).not.toBe(false);
    // at 3% over 1,000 years the exact payment (625.000000000000…) rounds to the 625.00 interest: refused, not a
    // 12,000-row schedule that repays nothing until a 250,000 last payment
    expect(refused("loan-schedule", { years: "1000", rate: "3", extra: "", lumps: "" })).toMatch(/no more than the first period's interest \(625\.00\)/);
  });

  test("F1 review C: percentages in a statement are refused by line, quoting what was typed", () => {
    expect(refused("fin-ratios", { stmt: "Revenue 1000\nGross margin 40% 38%" })).toBe("Statement, line 2 (“Gross margin”): “40%” is a percentage; a statement line takes amounts, not percentages.");
  });

  test("F1 review C: US accounting formats read; European refused by line; refusals quote the user's text", () => {
    const st = readStatement("Revenue\t$1,234.5\nCash\t1,234.50\nNet income\t($1,000)\nInventory\t$(1,000)\nTotal assets\t1,250\nAccounts payable\t1,000\nTotal liabilities\t-$2,000");
    if ("error" in st) throw new Error(st.error);
    expect(["revenue", "cash", "netIncome", "inventory", "totalAssets", "payables", "totalLiabilities"].map((k) => st.items.get(k as "cash")!.current)).toEqual([1234.5, 1234.5, -1000, -1000, 1250, 1000, -2000]);
    expect(st.notes.join(" ")).toContain("amounts in parentheses were read as negative");
    expect(st.notes.join(" ")).toContain("currency symbols were ignored");
    expect(refused("fin-ratios", { stmt: "Revenue\t1.234,56\nTotal assets\t50" })).toBe(
      "Statement, line 1 (“Revenue”): “1.234,56” is in the European style (point = thousands, comma = decimal); a statement is read in the US style (comma = thousands, point = decimal): write 1,234.56.",
    );
    expect(refused("fin-ratios", { stmt: "Revenue\t3,5\nTotal assets\t50" })).toMatch(/“3,5” has a comma that is not a thousands separator/);
    expect(refused("fin-ratios", { stmt: "Revenue\t(−1,000)\nTotal assets\t50" })).toMatch(/“\(−1,000\)” has both parentheses and a sign/);
    expect(refused("fin-ratios", { stmt: "Revenue\t1,00,000\nTotal assets\t50" })).toMatch(/“1,00,000”/);
    expect(out("fin-ratios", { stmt: "Revenue\t1,200\nTotal assets\t500" }).text).toMatch(/Conventions: statement amounts are read in the US style \(comma = thousands separator, point = decimal/);
    for (const id of ["fin-common-size", "altman-z"]) expect(out(id).text).toContain("read in the US style");
  });

  test("F1 review C: an accurate reason instead of “no amount” (unit suffix, header row, extra text column)", () => {
    expect(refused("fin-ratios", { stmt: "Revenue 50k\nTotal assets 50" })).toMatch(/line 1 \(“Revenue 50k”\): no amount: “50k”: a unit suffix \(k, m, bn, million\) is not read/);
    expect(refused("fin-ratios", { stmt: "Revenue 100\nTotal assets 50\nLine item FY2023 FY2022" })).toMatch(/line 3 .*no amount: this looks like a header row/);
    expect(refused("fin-ratios", { stmt: "Revenue\t1,000\tsee note 3\nTotal assets\t50" })).toBe(
      "Statement, line 1 (“Revenue”): text after the amounts (“see note 3”) is an extra column; remove it (a statement line is: line item, amount, prior-year amount).",
    );
    // between spaces a line ending in a number cannot be told from a name with a number in it: refused, quoted whole
    expect(refused("fin-ratios", { stmt: "Revenue 1,000 see note 3\nTotal assets 50" })).toMatch(/^Statement, line 1 \(“Revenue 1,000 see note 3”\): a number inside the line-item name \(“1,000”\), or an extra column; .*Separate the columns with tabs/);
    expect(refused("fin-ratios", { stmt: "Revenue 1,000 see note\nTotal assets 50" })).toBe(
      "Statement, line 1 (“Revenue 1,000 see note”): text after the amounts (“see note”) is an extra column; remove it (a statement line is: line item, amount, prior-year amount).",
    );
    // a header of fiscal years is a header
    const fy = readStatement("Line item FY2023 FY2022\nRevenue 10 9\nTotal assets 5 4");
    expect("error" in fy ? fy.error : fy.header).toEqual(["Line", "item", "FY2023", "FY2022"]);
    // a name with a percentage in it is still a name
    const nm = readStatement("Revenue\t100\nNotes 5.25% due 2027\t1,000");
    expect("error" in nm ? nm.error : nm.lines[1]).toMatchObject({ label: "Notes 5.25% due 2027", current: 1000 });
    expect("error" in readStatement("Revenue 100\nNotes 5.25% due later 1,000")).toBe(false);
  });

  test("F1 review C: a header row (2023) (2022) is a header, not amounts −2023 and −2022", () => {
    const st = readStatement("Line item\t(2023)\t(2022)\nRevenue\t10\t9\nTotal assets\t5\t4");
    if ("error" in st) throw new Error(st.error);
    expect(st.header).toEqual(["Line item", "(2023)", "(2022)"]);
    expect(st.lines.length).toBe(2);
  });

  test("F1 review C: a dash of any kind alone is a missing amount", () => {
    for (const d of ["—", "–", "-", "−"]) {
      const st = readStatement(`Revenue\t100\t90\nCash\t${d}\t50\nTotal assets\t50\t40`);
      if ("error" in st) throw new Error(d + st.error);
      expect([d, st.items.get("cash")!.label, st.items.get("cash")!.current, st.items.get("cash")!.prior]).toEqual([d, "Cash", null, 50]);
    }
    const sp = readStatement("Revenue 100 90\nCash — 50\nTotal assets 50 40");
    expect("error" in sp ? sp.error : [sp.items.get("cash")!.current, sp.items.get("cash")!.prior]).toEqual([null, 50]);
  });

  test("F1 review C: CVP target met with no sales says so in words, never −500 units", () => {
    const o = out("cvp-breakeven", { target: "-50000" });
    expect(o.text).toContain("Units for a target operating profit of −50,000.00: none; the target is met with no sales at all");
    expect(o.text).not.toMatch(/−[\d,.]+ units/);
    expect(o.tables![0].rows.find((r) => r[0] === "Units for target profit")![2]).toBe("none (met at 0 units)");
  });

  test("F1 review C: singular years", () => {
    expect(out("loan-schedule", { years: "1", extra: "", lumps: "" }).text).toContain("for 1 year (12 payments)");
    expect(out("loan-schedule", { years: "1", m: "1", extra: "", lumps: "" }).text).toContain("for 1 year (1 payment)");
    expect(out("depr-schedule", { life: "1" }).text).toContain("useful life 1 year");
    expect(out("depr-schedule", { life: "1" }).text).not.toContain("1 years");
  });

  test("F1 review C: every refusal of every schedule calculator starts with a capital", () => {
    for (const c of SCHED_CALCS)
      for (const f of c.fields) {
        if (f.kind === "select" || f.kind === "block" || f.kind === "list" || f.kind === "text") continue;
        for (const v of ["−5", "0", "1e400", "abc", "2.5", "-0.5"]) {
          const o = run(c, { [f.key]: v });
          if (typeof o !== "string" && o.ok === false) expect([c.id, f.key, v, /^[A-Z“(]/.test(o.text)]).toEqual([c.id, f.key, v, true]);
        }
      }
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
    expect(refused("cvp-breakeven", { price: "1e400" })).toMatch(/^Selling price per unit/);
    expect(refused("cvp-breakeven", { price: "0" })).toMatch(/must be above 0/);
  });
});
