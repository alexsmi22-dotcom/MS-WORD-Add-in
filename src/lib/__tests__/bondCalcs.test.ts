/**
 * BOND_CALCS (F1, gap items #3 and #16) through the pane's read path: number fields through readFinanceField first,
 * then compute (run() copied from finSpreadContract.test.ts). Every default must be insertable with ≤ 6-column tables,
 * a "Conventions:" line and a figure; hostile field text must refuse by name (never insertable); each compute must
 * finish within 300 ms at its caps.
 */
import * as fs from "fs";
import * as path from "path";
import { BOND_CALCS } from "../bondCalcs";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";

/** The pane's read: number fields through the product's cell reader, everything else as typed. */
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
const obj = (o: FinResult) => (typeof o === "string" ? { text: o, ok: undefined, svg: undefined, tables: undefined } : o);
const calc = (id: string): FinCalcDef => {
  const c = BOND_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const refusal = (id: string, over: Record<string, string>): string => {
  const o = obj(run(calc(id), over));
  expect(o.ok).toBe(false);
  return o.text;
};

test("ids, groups and names", () => {
  expect(BOND_CALCS.map((c) => c.id)).toEqual(["bond-dates", "bond-ytw", "tbill-yields", "curve-bootstrap", "curve-nelson-siegel"]);
  for (const c of BOND_CALCS) {
    expect(c.group).toBe("Fixed income");
    expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
    expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
    expect(c.id).toMatch(/^[a-z0-9-]+$/);
    expect(c.assumes ?? "").not.toContain("—");
  }
});

test("the module draws no Math.random", () => {
  for (const f of ["bondCalcs", "bondDates", "yieldCurve"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", f + ".ts"), "utf8")).not.toMatch(/Math\.random\s*\(/);
  }
});

describe.each(BOND_CALCS.map((c) => [c.id, c] as const))("%s defaults", (_id, c) => {
  test("insertable, Conventions line, figure, ≤ 6-column tables with insertable cells", () => {
    const o = obj(run(c));
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).toMatch(/\nConventions: /);
    expect(o.text).not.toMatch(/(^|[^\w])-\d/); // a true minus, never an ASCII hyphen before a number
    expect(o.text).not.toMatch(/\de[-+]?\d/); // no e-notation
    expect(o.svg ?? "").toContain("<svg");
    const tables = o.tables ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    }
  });
});

describe("solve options and alternatives", () => {
  test("bond-dates every basis and frequency, both solve directions, round trip", () => {
    for (const basis of ["30360us", "actact", "act360", "act365", "30e360"]) {
      for (const freq of ["1", "2", "4", "12"]) {
        const a = obj(run(calc("bond-dates"), { basis, freq }));
        expect(a.ok).not.toBe(false);
        const clean = /Clean price = ([\d.,]+) per 100/.exec(a.text)![1].replace(/,/g, "");
        const b = obj(run(calc("bond-dates"), { basis, freq, solve: "yield", price: clean }));
        expect(b.ok).not.toBe(false);
        expect(b.text).toMatch(/Yield to maturity = 4\.6000\d\d% \(solved/);
      }
    }
  });
  test("curve-bootstrap from coupon bond prices, and Svensson", () => {
    const p = obj(run(calc("curve-bootstrap"), { mode: "prices", rows: "0.5 0 98\n1 5 101.2\n1.5 5.5 101.9\n3 4 99.1\n4 6 104.8" }));
    expect(p.ok).not.toBe(false);
    expect(insertableResultText(p.text)).toBe(true);
    const s = obj(run(calc("curve-nelson-siegel"), { model: "svensson" }));
    expect(s.ok).not.toBe(false);
    expect(s.text).toMatch(/λ₂ = /);
  });
  test("tbill-yields from a price, Treasury year, long bill quadratic", () => {
    const o = obj(run(calc("tbill-yields"), { given: "price", value: "96.5", settle: "2027-06-10", maturity: "2028-05-25", year: "treasury" }));
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Treasury quadratic/);
    expect(o.text).toMatch(/\(366 here\)/);
  });
  test("decimal comma, thousands, true minus and percent sign through the pane's reader", () => {
    expect(obj(run(calc("bond-dates"), { coupon: "4,25" })).text).toMatch(/4\.2500% coupon/);
    expect(obj(run(calc("bond-dates"), { face: "1,000,000" })).text).toMatch(/on a face of 1,000,000\.00/);
    expect(obj(run(calc("bond-dates"), { yld: "−0.5" })).text).toMatch(/Yield to maturity = −0\.500000%/);
    expect(obj(run(calc("bond-dates"), { yld: "4.6%" })).text).toMatch(/Yield to maturity = 4\.600000%/);
    expect(obj(run(calc("bond-dates"), { yld: "0" })).ok).not.toBe(false);
    expect(obj(run(calc("bond-dates"), { coupon: "0" })).ok).not.toBe(false);
  });
  test("pasted curve with decimal commas (semicolon-separated) and a header row", () => {
    const o = obj(run(calc("curve-nelson-siegel"), { rows: "Maturity;Yield\n0,25;4,35\n1;4,18\n2;3,98\n5;3,97\n10;4,21\n30;4,47" }));
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/fit to 6 points/);
  });
});

describe("hostile inputs refuse by name (never insertable)", () => {
  test("blank, 1e400, words", () => {
    expect(refusal("bond-dates", { coupon: "" })).toMatch(/coupon rate/);
    expect(refusal("bond-dates", { yld: "1e400" })).toMatch(/yield to maturity \(%\): “1e400” is not a finite number/);
    expect(refusal("bond-dates", { face: "abc" })).toMatch(/face value/);
    expect(refusal("bond-dates", { solve: "yield", price: "0" })).toMatch(/clean price \(per 100\) must be above 0/);
    expect(refusal("bond-dates", { solve: "yield", price: "-3" })).toMatch(/clean price/);
    expect(refusal("bond-ytw", { callprice: "" })).toMatch(/call price/);
    expect(refusal("tbill-yields", { value: "1e400" })).toMatch(/discount rate/);
  });
  test("dates: settlement after maturity, bad date text, Feb 30, blank", () => {
    expect(refusal("bond-dates", { settle: "2037-01-01" })).toMatch(/Maturity date must be after the settlement date/);
    expect(refusal("bond-dates", { maturity: "soon" })).toMatch(/Maturity date/);
    expect(refusal("bond-dates", { settle: "2026-02-30" })).toMatch(/Settlement date/);
    expect(refusal("bond-dates", { settle: "" })).toMatch(/settlement date/);
    expect(refusal("bond-ytw", { calldate: "2029-03-01" })).toMatch(/odd last period/);
    expect(refusal("tbill-yields", { maturity: "2027-06-30" })).toMatch(/more than one year/);
  });
  test("Feb 29 dates are accepted; frequency 3 is refused", () => {
    expect(obj(run(calc("bond-dates"), { settle: "2028-02-29", maturity: "2038-02-28" })).ok).not.toBe(false);
    expect(refusal("bond-dates", { freq: "3" })).toMatch(/Coupons per year must be 1, 2, 4 or 12 \(got 3\)/);
    expect(refusal("curve-bootstrap", { freq: "4" })).toMatch(/Coupons per year must be 1 or 2/);
    expect(refusal("bond-dates", { basis: "act999" })).toMatch(/day-count basis/);
  });
  test("pasted blocks", () => {
    expect(refusal("curve-bootstrap", { rows: "" })).toMatch(/Instruments: nothing to read/);
    expect(refusal("curve-bootstrap", { rows: "1 4 100" })).toMatch(/Instruments, line 1: has 3 numbers/);
    expect(refusal("curve-bootstrap", { mode: "prices", rows: "1 4" })).toMatch(/needs 3 numbers/);
    expect(refusal("curve-bootstrap", { rows: "0.75 4" })).toMatch(/half-years/);
    expect(refusal("curve-nelson-siegel", { rows: "1 4\n2 x" })).toMatch(/Curve points/);
    expect(refusal("curve-nelson-siegel", { rows: "1 4\n2 4.1\n3 4.2" })).toMatch(/at least 4 points/);
    expect(refusal("curve-nelson-siegel", { rows: "1 4\n2 1e400\n3 4.2\n4 4" })).toMatch(/Curve points|Row 2/);
  });
});

describe("timing at the caps (≤ 300 ms each)", () => {
  const time = (c: FinCalcDef, over: Record<string, string>): number => {
    const t0 = performance.now();
    const o = obj(run(c, over));
    const ms = performance.now() - t0;
    expect(o.ok).not.toBe(false);
    return ms;
  };
  test("100-year monthly bond (1,200 coupons), solved for yield", () => {
    expect(time(calc("bond-dates"), { settle: "2026-01-10", maturity: "2125-12-15", freq: "12", solve: "yield", price: "80" })).toBeLessThan(300);
  });
  test("100 semiannual par instruments to 50 years", () => {
    const rows = Array.from({ length: 100 }, (_, i) => `${(i + 1) / 2}\t${(3 + 0.01 * i).toFixed(2)}`).join("\n");
    expect(time(calc("curve-bootstrap"), { rows })).toBeLessThan(300);
  });
  test("Svensson on 200 points (the cap)", () => {
    const rows = Array.from({ length: 200 }, (_, i) => {
      const t = 0.1 + (i * 29.9) / 199;
      const y = 4 + 0.5 * Math.exp(-t / 2) - 0.8 * (1 - Math.exp(-t / 5)) + 0.02 * Math.sin(i);
      return `${t.toFixed(4)}\t${y.toFixed(4)}`;
    }).join("\n");
    expect(time(calc("curve-nelson-siegel"), { model: "svensson", rows })).toBeLessThan(300);
  });
});
