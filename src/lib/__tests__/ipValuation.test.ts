/**
 * Release F1 gap items #1 and #2: IP valuation (ipValuation.ts), apportionment and royalty-rate methods
 * (apportionment.ts) and their registry (ipValuationCalcs.ts).
 *
 * Oracle: scripts/ipval-oracle.py → fixtures/ipval-oracle.json. Tolerances: deterministic valuation 1e-9 relative
 * (Python ** vs V8 Math.pow); Monte Carlo 1e-12 relative on every statistic and the first draws (the Python PCG32,
 * transforms and recurrences reproduce the TS stream; log/cos/pow may differ by an ulp), negative-draw and cap counts
 * exact; apportionment, EMVR/SSPPU and Nash cells exactly (Python fractions, half away from zero).
 */
import * as fs from "fs";
import * as path from "path";
import { IPVAL_CALCS } from "../ipValuationCalcs";
import { computeRfr, computeIncome, monteCarloNpv, orderStats, quantile7, readCurrency, IPV_WORK_BUDGET, IPV_MAX_SAMPLES, type Dist } from "../ipValuation";
import { computeComparable, UNILOC_CITATION, UNILOC_QUOTE } from "../apportionment";
import { readFinanceField } from "../finance";
import { insertableResultText } from "../insertGate";
import { FIN_GROUP_ORDER, type FinCalcDef, type FinResult } from "../finCalc";
import { budget } from "./timeBudget";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ORACLE = require("./fixtures/ipval-oracle.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cases = (arr: any[]): [string, any][] => arr.map((c) => [c.name, c]);

/**
 * The pane's read, as updateFinancePreview does it (taskpane.ts): number fields through readFinanceField, a number
 * field it cannot read refused with the pane's own message BEFORE compute, a blank non-optional non-select field
 * holding the result back ("Enter all values to compute."), everything else handed to compute as typed. (The
 * finSpreadContract.test.ts run() is the same without the two hold-backs.)
 */
function run(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  let fieldRefusal = "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const r = raw(f.key);
    if (!r.trim()) continue;
    const v = readFinanceField(r);
    if (!Number.isFinite(v)) {
      if (!fieldRefusal) fieldRefusal = `${f.label}: “${r.trim()}” is not a number.`;
    } else numeric.set(f.key, String(v));
  }
  const read = (k: string): string => numeric.get(k) ?? raw(k);
  if (c.fields.some((f) => f.kind !== "select" && !f.optional && read(f.key).trim() === "")) return { text: "Enter all values to compute.", ok: false };
  if (fieldRefusal) return { text: fieldRefusal, ok: false };
  return c.compute(read);
}
const calc = (id: string): FinCalcDef => {
  const c = IPVAL_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const obj = (r: FinResult) => (typeof r === "string" ? { text: r, ok: undefined, tables: undefined, svg: undefined } : r);
const ok = (id: string, over: Record<string, string> = {}) => {
  const o = obj(run(calc(id), over));
  if (o.ok === false) throw new Error(`${id} refused: ${o.text}`);
  // The display contract on every result: insertable text and cells, no caret, no ASCII hyphen before a digit, no
  // e-notation.
  expect(insertableResultText(o.text)).toBe(true);
  expect(o.text).not.toMatch(/\^|(?<![\p{L}\d])-\d|\de[+-]?\d/u);
  for (const t of o.tables ?? []) {
    for (const row of t.rows) {
      expect(row.length).toBeLessThanOrEqual(6);
      for (const cell of row) if (cell !== "") expect(insertableResultText(cell) && !/(?<![\p{L}\d])-\d|\de[+-]?\d/u.test(cell)).toBe(true);
    }
  }
  return o;
};
/** ok() without the per-cell display assertions (they cost more than the calculation on a 1,200-row table): for timing. */
const fast = (id: string, over: Record<string, string> = {}) => {
  const o = obj(run(calc(id), over));
  if (o.ok === false) throw new Error(`${id} refused: ${o.text}`);
  return o;
};
const refusal = (id: string, over: Record<string, string>): string => {
  const o = obj(run(calc(id), over));
  expect(o.ok).toBe(false);
  return o.text;
};
const rel = (a: number, b: number, tol: number, scale = Math.abs(b)) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(scale, 1e-300));

const UNILOC_TEXT =
  "Uniloc USA, Inc. v. Microsoft Corp., 632 F.3d 1292 (Fed. Cir. 2011), slip op. at 41: “This court now holds as a matter of Federal Circuit law that the 25 percent rule of thumb is a fundamentally flawed tool for determining a baseline royalty rate in a hypothetical negotiation.”";

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

describe("relief-from-royalty vs the Python oracle (1e-9 relative)", () => {
  test.each(cases(ORACLE.rfr))("%s", (_n, c: any) => {
    const r = computeRfr({ revenue: c.revenue, firstYear: null, royaltyPct: c.royalty, taxPct: c.tax, discountPct: c.disc, life: c.life, attrition: c.attr, decayPct: c.decay, timing: c.timing, tabYears: c.tab });
    if ("error" in r) throw new Error(r.error);
    expect(r.years.length).toBe(c.expect.pvs.length);
    r.years.forEach((y, i) => rel(y.pv, c.expect.pvs[i], 1e-9));
    rel(r.pvSum, c.expect.pvSum, 1e-9);
    rel(r.value, c.expect.value, 1e-9);
    if (c.expect.tabFactor === null) expect(r.tabFactor).toBeNull();
    else rel(r.tabFactor!, c.expect.tabFactor, 1e-12);
  });
});

describe("income approach vs the Python oracle (1e-9 relative)", () => {
  test.each(cases(ORACLE.income))("%s", (_n, c: any) => {
    const r = computeIncome({ flows: c.flows, firstYear: 2027, preTax: c.preTax, taxPct: c.tax, discountPct: c.disc, life: c.life, attrition: c.attr, decayPct: c.decay, timing: c.timing });
    if ("error" in r) throw new Error(r.error);
    const scale = Math.max(...c.expect.pvs.map((x: number) => Math.abs(x)));
    r.years.forEach((y, i) => rel(y.pv, c.expect.pvs[i], 1e-9, scale));
    rel(r.value, c.expect.value, 1e-9, scale);
  });
});

describe("Monte Carlo NPV reproduces the Python PCG32 stream (1e-12 relative, counts exact)", () => {
  test.each(cases(ORACLE.mc))("%s", (_n, c: any) => {
    const d = (x: [string, number[]]): Dist => ({ kind: x[0] as Dist["kind"], p: x[1] });
    const r = monteCarloNpv({ revenue: d(c.revenue), royaltyPct: d(c.rate), life: d(c.life), discountPct: d(c.disc), growthPct: c.growth, taxPct: c.tax, cost: c.cost, timing: c.timing, straightLine: c.straight, samples: c.samples, seed: c.seed });
    const e = c.expect;
    const scale = Math.max(Math.abs(e.mean), e.sd, Math.abs(e.p90), Math.abs(e.p10));
    for (const k of ["mean", "sd", "p10", "p50", "p90", "central"] as const) rel(r[k], e[k], 1e-12, scale);
    for (let i = 0; i < 5; i++) rel(r.draws[i], e.first[i], 1e-12, scale);
    expect(r.negCount).toBe(e.negCount);
    expect(r.capped).toEqual(e.capped);
  });

  test("the caps case really hits the caps (the counts above are not all zero)", () => {
    const c = ORACLE.mc.find((x: { name: string }) => x.name.startsWith("caps"));
    expect(c.expect.capped.some((n: number) => n > 0)).toBe(true);
  });

  test.each([
    ["mid, none, partial life", "mid", false, 7.4],
    ["end, straight-line, partial life", "end", true, 9.6],
    ["mid, straight-line, whole life", "mid", true, 12],
  ] as const)("an all-fixed Monte Carlo equals the relief-from-royalty PV less the price (recurrence vs pow path): %s", (_n, timing, straight, life) => {
    const g = 4;
    const revenue = Array.from({ length: 13 }, (_, k) => 2_000_000 * Math.pow(1 + g / 100, k));
    const rfr = computeRfr({ revenue, firstYear: null, royaltyPct: 3.5, taxPct: 21, discountPct: 12.5, life, attrition: straight ? "straight" : "none", decayPct: 0, timing, tabYears: 0 });
    if ("error" in rfr) throw new Error(rfr.error);
    const fx = (v: number): Dist => ({ kind: "fixed", p: [v] });
    const mc = monteCarloNpv({ revenue: fx(2_000_000), royaltyPct: fx(3.5), life: fx(life), discountPct: fx(12.5), growthPct: g, taxPct: 21, cost: 250_000, timing, straightLine: straight, samples: 1000, seed: 5 });
    rel(mc.draws[0], rfr.pvSum - 250_000, 1e-12, rfr.pvSum);
    expect(mc.sd).toBeLessThan(1e-9);
  });

  test("the same seed gives the same draws; another seed gives other draws", () => {
    const inp = { revenue: { kind: "tri", p: [1, 2, 4] } as Dist, royaltyPct: { kind: "logn", p: [2, 5] } as Dist, life: { kind: "tri", p: [3, 5, 9] } as Dist, discountPct: { kind: "fixed", p: [10] } as Dist, growthPct: 0, taxPct: 0, cost: 0, timing: "mid" as const, straightLine: false, samples: 2000, seed: 99 };
    const a = monteCarloNpv(inp);
    const b = monteCarloNpv(inp);
    const c = monteCarloNpv({ ...inp, seed: 100 });
    expect(Array.from(a.draws)).toEqual(Array.from(b.draws));
    expect(a.mean).not.toBe(c.mean);
  });
});

describe("apportionment, EMVR/SSPPU and Nash: exact cents vs Python fractions", () => {
  test.each(cases(ORACLE.chain))("chain: %s", (_n, c: any) => {
    const o = ok("ipv-apportion", { basis: c.basis, revenue: c.revenue ?? "1", units: c.units ?? "1", price: c.price ?? "1", ssu: c.ssu, feature: c.feature, patent: c.patent, rate: c.rate });
    const rows = o.tables![0].rows;
    expect(rows.slice(1, 6).map((r) => r[3])).toEqual(c.expect.cells);
    expect(rows[6][2]).toBe(c.expect.effective);
    expect(rows[6][3]).toBe(c.expect.royalty);
    expect(o.text).toContain(`Royalty: ${c.expect.royalty}`);
  });
  test.each(cases(ORACLE.emvr))("EMVR vs SSPPU: %s", (_n, c: any) => {
    const o = ok("ipv-emvr-ssppu", { basis: "revenue", emv: c.emv, ssppu: c.ssppu, rate: c.rate });
    const rows = o.tables![0].rows;
    expect(rows[1][3]).toBe(c.expect.emvRoyalty);
    expect(rows[2][3]).toBe(c.expect.ssppuRoyalty);
    expect(rows[3][3]).toBe(c.expect.difference);
    expect(o.text).toContain(`The SSPPU base is ${c.expect.sharePct} of the entire-product base; ${c.expect.equivalentPct} on the entire product`);
  });
  test.each(cases(ORACLE.nash))("Nash: %s", (_n, c: any) => {
    const o = ok("ipv-nash", { with: c.with, alt: c.alt, share: c.share });
    const rows = o.tables![0].rows;
    expect(rows[3][1]).toBe(c.expect.surplus);
    expect(rows[4][1]).toBe(c.expect.patentee);
    expect(rows[5][1]).toBe(c.expect.licensee);
  });
});

describe("comparable licence vs the Python oracle (1e-9 relative)", () => {
  test.each(cases(ORACLE.comparable))("%s", (_n, c: any) => {
    const r = computeComparable({ bases: c.bases, labels: c.bases.map((_: number, i: number) => `P${i + 1}`), direction: c.direction, lump: c.lump, ratePct: c.rate, discountPct: c.disc, periodsPerYear: c.ppy });
    if ("error" in r) throw new Error(r.error);
    rel(r.pvBase, c.expect.pvBase, 1e-9);
    rel(r.ratePct, c.expect.ratePct, 1e-9);
    rel(r.lump, c.expect.lump, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// The 25% rule refusal
// ---------------------------------------------------------------------------

describe("the 25% rule of thumb is an explained refusal, quoting Uniloc verbatim", () => {
  test("the citation and quotation constants are exactly the verified text", () => {
    expect(`${UNILOC_CITATION}: “${UNILOC_QUOTE}”`).toBe(UNILOC_TEXT);
  });
  test.each([
    ["the rule-of-thumb option", { method: "rule25" }],
    ["a patentee share of 25", { share: "25" }],
    ["a patentee share typed 25%", { share: "25%" }],
    ["a patentee share typed 25.0", { share: "25.0" }],
  ])("%s", (_n, over) => {
    const t = refusal("ipv-nash", over as Record<string, string>);
    expect(t).toContain(UNILOC_TEXT);
    expect(t).toContain("not offered as a calculator");
  });
  test("24.99 and 25.01 are ordinary shares (the refusal is the rule, not a range)", () => {
    expect(ok("ipv-nash", { share: "24.99" }).text).toContain("24.99%");
    expect(ok("ipv-nash", { share: "25.01" }).text).toContain("25.01%");
  });
  test("no other case citation appears in either engine or the registry", () => {
    for (const f of ["ipValuation.ts", "apportionment.ts", "ipValuationCalcs.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      const cites = src.match(/\bv\.\s+[A-Z]|F\.\s?(?:2d|3d|4th|Supp)|\bU\.S\.C\./g) ?? [];
      expect(cites.length).toBe(f === "apportionment.ts" ? 2 : 0); // the Uniloc constant: "v. Microsoft" and "F.3d"
    }
  });
});

// ---------------------------------------------------------------------------
// Hostile inputs
// ---------------------------------------------------------------------------

describe("hostile inputs are refused by field name", () => {
  test.each([
    ["ipv-apportion", { ssu: "120" }, "Smallest salable unit share (%)"],
    ["ipv-apportion", { feature: "-5" }, "Feature share (%)"],
    ["ipv-apportion", { patent: "0" }, "Patent share (%)"],
    ["ipv-apportion", { rate: "abc" }, "Royalty rate (%)"],
    ["ipv-apportion", { revenue: "1e400" }, "Revenue"],
    ["ipv-apportion", { revenue: "2e12" }, "Revenue"],
    ["ipv-apportion", { revenue: "" }, "Revenue"],
    ["ipv-apportion", { basis: "unit", units: "-3" }, "Units"],
    ["ipv-emvr-ssppu", { ssppu: "130000000" }, "SSPPU base is larger"],
    ["ipv-emvr-ssppu", { emv: "0" }, "Entire-product revenue"],
    ["ipv-comparable", { disc: "-5" }, "Discount rate"],
    ["ipv-comparable", { lump: "200000000" }, "worth more than the whole discounted royalty base"],
    ["ipv-nash", { alt: "9500000" }, "no bargaining surplus"],
    ["ipv-nash", { share: "100" }, "Patentee share of the surplus (%)"],
    ["ipv-nash", { units: "0" }, "Units (optional)"],
    ["ipv-rfr", { life: "0" }, "Remaining life (years)"],
    ["ipv-rfr", { life: "51" }, "Remaining life (years)"],
    ["ipv-rfr", { life: "n/a" }, "Remaining life (years)"],
    ["ipv-rfr", { royalty: "150" }, "Royalty rate (%)"],
    ["ipv-rfr", { tax: "100" }, "Tax rate (%)"],
    ["ipv-rfr", { disc: "-1" }, "Discount rate (%)"],
    ["ipv-rfr", { life: "12" }, "needs 12"],
    ["ipv-rfr", { forecast: "2027 100\n2029 100" }, "does not follow 2027"],
    ["ipv-rfr", { forecast: "2027 100\n2028 −100" }, "cannot be negative"],
    ["ipv-rfr", { forecast: "100\n200" }, "needs the year"],
    ["ipv-rfr", { forecast: "2027 2e12" }, "above one trillion"],
    ["ipv-rfr", { attr: "decay", decay: "0" }, "Attrition (% a year)"],
    ["ipv-rfr", { tabyears: "7.5" }, "Amortisation period (years)"],
    ["ipv-rfr", { mode: "growth", growth: "-100" }, "Revenue growth"],
    ["ipv-rfr", { currency: "ABC" }, "ABC is not in ISO 4217"],
    ["ipv-rfr", { currency: "XXX" }, "Currency: XXX"],
    ["ipv-rfr", { currency: "EURO" }, "three-letter"],
    ["ipv-income", { flows: "2027 100 200 300 400" }, "at most 2"],
    ["ipv-income", { basis: "pre", tax: "-3" }, "Tax rate (%)"],
    ["ipv-mc", { samples: "100001" }, "Samples"],
    ["ipv-mc", { samples: "1e400" }, "Samples"],
    ["ipv-mc", { samples: "50000.5" }, "Samples"],
    ["ipv-mc", { samples: "999" }, "Samples"],
    ["ipv-mc", { seed: "-1" }, "Seed"],
    ["ipv-mc", { seed: "abc" }, "Seed"],
    ["ipv-mc", { seed: "9007199254740993" }, "Seed"],
    ["ipv-mc", { rev: "6000000, 4000000, 2500000" }, "in order"],
    ["ipv-mc", { rev: "2500000, 4000000" }, "takes 3 numbers"],
    ["ipv-mc", { discdist: "logn", disc: "18, 10" }, "P90 must be above"],
    ["ipv-mc", { lifedist: "tri", life: "0, 5, 10" }, "Remaining life (years)"],
    ["ipv-mc", { ratedist: "fixed", rate: "120" }, "Royalty rate (%)"],
    ["ipv-mc", { lifedist: "logn", life: "5, 14", samples: "100000" }, "work budget"],
    ["ipv-mc", { rev: "1e400, 2e400, 3e400" }, "First-year revenue"],
    ["ipv-mc", { ratedist: "fixed", rate: "4,5" }, "Royalty rate (%)"],
    ["ipv-rfr", { mode: "growth", base: "" }, "First-year revenue: enter a number"],
    ["ipv-comparable", { direction: "rate2lump", rate: "" }, "Running royalty rate (%): enter a number"],
    ["ipv-emvr-ssppu", { basis: "unit", emvprice: "" }, "Entire-product price per unit: enter a number"],
  ])("%s %j", (id, over, needle) => {
    const t = refusal(id, over as Record<string, string>);
    expect(t).toContain(needle);
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
  });

  test.each([
    ["ipv-apportion", { revenue: "€1,000,000" }, "Revenue"],
    ["ipv-apportion", { revenue: "EUR 1,000,000" }, "Revenue"],
    ["ipv-apportion", { basis: "unit", price: "£300" }, "Price per unit"],
    ["ipv-emvr-ssppu", { ssppu: "C$18,000,000" }, "SSPPU revenue"],
    ["ipv-nash", { with: "¥9,000,000" }, "Profit with the patented feature"],
    ["ipv-comparable", { periods: "2027 €20,000,000\n2028 €24,000,000" }, "The table"],
  ])("foreign currency in the US-dollar worksheet: %s %j", (id, over, what) => {
    const t = refusal(id, over as Record<string, string>);
    expect(t).toContain(what);
    expect(t).toContain("not the US dollar");
  });

  test("US-dollar markings, thousands, decimal commas and a true minus are read", () => {
    expect(ok("ipv-apportion", { revenue: "$120,000,000" }).text).toContain("Royalty: $432,000.00");
    expect(ok("ipv-apportion", { revenue: "US$120,000,000" }).text).toContain("Royalty: $432,000.00");
    expect(ok("ipv-apportion", { rate: "5,0" }).text).toContain("Royalty: $432,000.00");
    expect(ok("ipv-nash", { alt: "−500000" }).text).toContain("−$500,000.00");
    expect(ok("ipv-rfr", { royalty: "4,0", forecast: "Year\tRevenue\n2027\t4000000\n2028\t4600000\n2029\t5100000\n2030\t5400000\n2031\t5500000\n2032\t5300000\n2033\t5000000\n2034\t4600000" }).text).toContain(
      "Value of the patent: 809,521.89",
    );
  });

  test("the Monte Carlo lists use the one block reader: 3,500,000; 5,000,000; 8,000,000 is three numbers", () => {
    const a = ok("ipv-mc", { rev: "3,500,000; 5,000,000; 8,000,000", samples: "2000" });
    const b = ok("ipv-mc", { rev: "3500000, 5000000, 8000000", samples: "2000" });
    expect(a.text.split("\n")[1]).toBe(b.text.split("\n")[1]);
    expect(refusal("ipv-mc", { rev: "1,250 2,000 3,000" })).toContain("First-year revenue");
  });
});

// ---------------------------------------------------------------------------
// Currency (IP valuation)
// ---------------------------------------------------------------------------

describe("the optional ISO 4217 currency", () => {
  test("blank: bare numbers; EUR: € in the text and (EUR) in the headers; lower case accepted", () => {
    const bare = ok("ipv-rfr");
    expect(bare.text).toContain("Value of the patent: 809,521.89");
    const eur = ok("ipv-rfr", { currency: "eur" });
    expect(eur.text).toContain("Value of the patent: €809,521.89");
    expect(eur.text).toContain("(EUR)");
    expect(eur.tables![1].rows[0]).toContain("Present value (EUR)");
    expect(eur.text).not.toContain("$");
  });
  test("JPY prints whole yen (ISO minor units 0); BHD three decimals", () => {
    expect(ok("ipv-rfr", { currency: "JPY" }).text).toMatch(/Value of the patent: JP¥809,522\s\(JPY\)/);
    expect(ok("ipv-income", { currency: "BHD" }).text).toMatch(/Value of the patent: BHD\s1,704,610\.415\b/);
  });
  test("readCurrency refuses by name", () => {
    expect(readCurrency("QQQ")).toEqual({ error: expect.stringContaining("QQQ is not in ISO 4217") });
    expect(readCurrency("")).toEqual({ code: null, minor: 2 });
  });
});

// ---------------------------------------------------------------------------
// Registry through the pane's read path
// ---------------------------------------------------------------------------

describe("IPVAL_CALCS through the pane's read path", () => {
  test("seven calculators, unique kebab ids, one group, names that do not repeat it", () => {
    expect(IPVAL_CALCS.map((c) => c.id)).toEqual(["ipv-rfr", "ipv-income", "ipv-mc", "ipv-apportion", "ipv-emvr-ssppu", "ipv-comparable", "ipv-nash"]);
    for (const c of IPVAL_CALCS) {
      expect(c.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(c.group).toBe("IP valuation & licensing");
      expect(FIN_GROUP_ORDER as readonly string[]).toContain(c.group);
      expect(c.name.toLowerCase().startsWith(c.group.toLowerCase())).toBe(false);
      expect((c.assumes ?? "").length).toBeGreaterThan(40);
      for (const f of c.fields) expect(typeof f.default).toBe("string");
      for (const f of c.fields) if (f.kind === undefined || f.kind === "number") expect(f.default.trim()).not.toBe("25");
    }
  });

  test.each(IPVAL_CALCS.map((c) => [c.id, c]))("%s: defaults give insertable text, a Conventions line and tables of at most 6 columns", (_id, c) => {
    const o = obj(run(c as FinCalcDef));
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).toMatch(/^Conventions: /m);
    expect(o.text).not.toMatch(/[\^]|\de[+-]?\d|-\d/);
    const tables = o.tables ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBeLessThanOrEqual(6);
        for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
    }
    if (["ipv-rfr", "ipv-income", "ipv-mc", "ipv-comparable"].includes(c.id)) expect(o.svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  test("the engines and the registry draw no Math.random", () => {
    for (const f of ["ipValuation.ts", "apportionment.ts", "ipValuationCalcs.ts"]) {
      expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
    }
  });

  test("growth mode, end-of-year and every attrition option compute", () => {
    for (const attr of ["none", "straight", "decay"]) {
      for (const timing of ["mid", "end"]) {
        const o = ok("ipv-rfr", { mode: "growth", attr, timing, tab: "no" });
        expect(o.text).toContain(timing === "mid" ? "mid-year discounting" : "end-of-year discounting");
      }
    }
    expect(ok("ipv-income", { basis: "after" }).text).toContain("after tax (not taxed again)");
    expect(ok("ipv-comparable", { direction: "rate2lump" }).text).toContain("Lump-sum equivalent: $");
    expect(ok("ipv-emvr-ssppu", { basis: "unit" }).text).toContain("400,000 units");
    expect(ok("ipv-apportion", { basis: "unit" }).text).toContain("400,000 units × $300.00");
    const n = ok("ipv-nash", { units: "100000", revenue: "50000000" });
    expect(n.text).toContain("Per unit over 100,000 units: $12.50.");
    expect(n.text).toContain("As a rate on revenue of $50,000,000.00: 2.50%.");
  });
});

// ---------------------------------------------------------------------------
// Order statistics and timing
// ---------------------------------------------------------------------------

test("orderStats matches a full sort (ties, ends, adjacent indices)", () => {
  const a = new Float64Array(10001);
  for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin(i * 7.1) * 50);
  const s = a.slice().sort();
  const ks = [0, 1, 10, 500, 5000, 5001, 9999, 10000];
  const os = orderStats(a, ks);
  for (const k of ks) expect(os.get(k)).toBe(s[k]);
  expect(quantile7(s, 0.5)).toBe(s[5000]);
});

describe("timing at the caps (≤ 300 ms)", () => {
  const time = (fn: () => unknown): number => {
    fn(); // warm-up
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  test(`Monte Carlo: ${IPV_MAX_SAMPLES.toLocaleString("en-US")} samples × 40 years, all inputs uncertain`, () => {
    expect(IPV_MAX_SAMPLES * 40).toBe(IPV_WORK_BUDGET);
    const over = { samples: String(IPV_MAX_SAMPLES), revdist: "logn", rev: "2000000, 6000000", ratedist: "logn", rate: "2, 6", lifedist: "tri", life: "30, 36, 40", discdist: "logn", disc: "10, 18", attr: "straight" };
    const ms = time(() => fast("ipv-mc", over));
    expect(ms).toBeLessThan(budget(300));
  });
  test("Monte Carlo: 80,000 samples × 50 years (lognormal life)", () => {
    const over = { samples: "80000", revdist: "logn", rev: "2000000, 6000000", ratedist: "logn", rate: "2, 6", lifedist: "logn", life: "20, 40", discdist: "logn", disc: "10, 18" };
    const ms = time(() => fast("ipv-mc", over));
    expect(ms).toBeLessThan(budget(300));
  });
  test("50-year relief-from-royalty and income approach; 1,200-period comparable licence", () => {
    const years = Array.from({ length: 50 }, (_, i) => `${2027 + i} ${1000000 + i * 1000}`).join("\n");
    const flows = Array.from({ length: 50 }, (_, i) => `${2027 + i} ${500000 + i * 1000} 1000`).join("\n");
    const periods = Array.from({ length: 1200 }, (_, i) => `M${i + 1} ${100000 + i}`).join("\n");
    expect(time(() => fast("ipv-rfr", { forecast: years, life: "50", attr: "decay" }))).toBeLessThan(budget(300));
    expect(time(() => fast("ipv-income", { flows, life: "50" }))).toBeLessThan(budget(300));
    expect(time(() => fast("ipv-comparable", { periods, ppy: "12" }))).toBeLessThan(budget(300));
    expect(refusal("ipv-comparable", { periods: periods + "\nM1201 5" })).toContain("1,200 periods");
  });
});
