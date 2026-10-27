/**
 * F2 items #14 (Micro II) and #15 (Macro II): micromacro.ts engines and the MICROMACRO_STAT_CALCS registry, against
 * scripts/micromacro-oracle.py (sympy / statsmodels / numpy, fixtures/micromacro-oracle.json), plus the pane contract
 * (statSpreadContract's read path: every field AS TYPED) and hostile inputs.
 */
import * as fs from "fs";
import * as path from "path";
import { MICROMACRO_STAT_CALCS, PHILLIPS_DATA_DEFAULT } from "../micromacroStatCalcs";
import {
  consumerChoice,
  costAnalysis,
  supplyAt,
  priceDiscrimination,
  auction,
  firstPriceBid,
  auctionNum,
  firstPriceBidNum,
  mfSolve,
  growthAccounting,
  tfpIndex,
  type Utility,
  type MfParams,
  type Bundle,
} from "../micromacro";
import { parseRatLiteral, ratToNumber, type Rat } from "../cas";
import { ratOf } from "../currency";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";

const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "micromacro-oracle.json"), "utf8"));
const Q = (s: string): Rat => parseRatLiteral(s)!;
const ratText = (r: Rat): string => (r.d === 1n ? String(r.n) : `${r.n}/${r.d}`);
const calc = (id: string): StatCalcDef => MICROMACRO_STAT_CALCS.find((c) => c.id === id)!;
/** The pane's read: every field as typed. */
function run(c: StatCalcDef | string, over: Record<string, string> = {}): StatOutput {
  const cc = typeof c === "string" ? calc(c) : c;
  return cc.compute((k) => over[k] ?? cc.fields.find((f) => f.key === k)?.default ?? "");
}
const close = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cases = (arr: any[], lab: (d: any, i: number) => string): [string, any][] => arr.map((d, i) => [lab(d, i), d]);
const num = (s: string): number => Number(s.replace(/,/g, "").replace(/−/g, "-").replace(/%$/, ""));

describe("registry contract", () => {
  test("ids unique, lowercase kebab; names; select defaults among options; no Math.random", () => {
    const ids = MICROMACRO_STAT_CALCS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of MICROMACRO_STAT_CALCS) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/);
      for (const f of c.fields) {
        expect(typeof f.default).toBe("string");
        if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
      }
    }
    const src = fs.readFileSync(path.join(__dirname, "..", "micromacroStatCalcs.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random\s*\(/);
    expect(fs.readFileSync(path.join(__dirname, "..", "micromacro.ts"), "utf8")).not.toMatch(/Math\.random\s*\(/);
    // registry entry form: 4-space id line; compute: (r) => { + one-line comment + return
    for (const id of ids) expect(src).toMatch(new RegExp(`\\n {4}id: "${id}",`));
    const computes = [...src.matchAll(/compute: \(r\) => \{\n\s*\/\/ [^\n]+\n\s*return [A-Za-z]+\(r\);/g)];
    expect(computes.length).toBe(ids.length);
  });

  test("the ids do not collide with the pane's STAT_CALCS or FIN_CALCS", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const paneIds = new Set([...pane.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]));
    for (const c of MICROMACRO_STAT_CALCS) expect(paneIds.has(c.id)).toBe(false);
  });

  test.each(MICROMACRO_STAT_CALCS.map((c) => [c.id, c] as const))("%s: defaults give an insertable result with ≤ 6-column tables", (_id, c) => {
    const o = run(c);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toMatch(/\^|NaN|Infinity|undefined|—/);
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/m); // true minus only
    expect(o.text).toMatch(/Conventions:/);
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
    }
  });

  test("every calculator but the money multiplier draws a figure", () => {
    for (const c of MICROMACRO_STAT_CALCS) {
      const o = run(c);
      if (c.id === "macro-money-multiplier") expect(o.svg).toBeUndefined();
      else expect(o.svg).toMatch(/^<svg/);
    }
  });
});

// ------------------------------------------------------------------------------------------------ oracle cases

describe("micro-demand vs sympy", () => {
  test.each(cases(ORACLE.demand, (d, i) => `${d.form} ${i}`))("%s", (_l, d: Record<string, unknown>) => {
    const params = d.params as string[];
    const over: Record<string, string> = { form: d.form as string, p: d.p as string, mc: (d.c as string) ?? "" };
    if (d.form === "loglog") Object.assign(over, { A: params[0], eps: params[1] });
    else Object.assign(over, { a: params[0], b: params[1] });
    const o = run("micro-demand", over);
    expect(o.ok).not.toBe(false);
    const m = /At P = [^:]+: Q = ([\d,.]+), elasticity ε = ([−\d.]+) .*revenue P·Q = ([\d,.]+), marginal revenue ([−\d,.]+)\./.exec(o.text)!;
    close(num(m[1]), d.q as number, 1e-4);
    close(num(m[2]), d.eps as number, 1e-4);
    close(num(m[3]), d.rev as number, 1e-4);
    close(num(m[4]), d.mr as number, 1e-4);
    if (d.pStar !== undefined) {
      const s = /P\* = [^=]*= ((?:[\d/]+ ≈ )?[\d,]+(?:\.\d+)?)[ (,].*?Q\* = ([\d,]+(?:\.\d+)?).*?profit ([\d,]+(?:\.\d+)?)/.exec(o.text)!;
      const ps = s[1].includes("≈") ? num(s[1].split("≈")[1].trim()) : num(s[1]);
      close(ps, d.pStar as number, 1e-4);
      close(num(s[2]), d.qStar as number, 1e-4);
      close(num(s[3]), d.profit as number, 1e-4);
    }
    if (d.pR !== undefined) {
      const s = /P = 1\/b = ([\d,.]+), Q = e to the power \(a − 1\) = ([\d,]+(?:\.\d+)?), revenue ([\d,]+(?:\.\d+)?)/.exec(o.text)!;
      close(num(s[1]), d.pR as number, 1e-9);
      close(num(s[2]), d.qR as number, 1e-4);
      close(num(s[3]), d.revMax as number, 1e-4);
    }
  });
});

describe("consumer choice vs sympy (Lagrangian demands, expenditure minimisation)", () => {
  test.each(cases(ORACLE.consumer, (d, i) => `${d.kind} ${i}`))("%s", (_l, d: Record<string, unknown>) => {
    const n = (s: unknown): number => ratToNumber(Q(s as string));
    const u: Utility = { kind: d.kind as Utility["kind"], a: n(d.a), b: n(d.b), rho: d.rho ? n(d.rho) : undefined };
    const r = consumerChoice(u, n(d.p1), n(d.p1new), n(d.p2), n(d.m));
    const chk = (b: Bundle | null, want: number[]): void => {
      expect(b && !b.tie).toBe(true);
      const bb = b as { x: number; y: number };
      close(bb.x, want[0], 1e-9);
      close(bb.y, want[1], 1e-9);
    };
    chk(r.A, d.A as number[]);
    chk(r.B, d.B as number[]);
    chk(r.C, d.C as number[]);
    chk(r.S, d.S as number[]);
    close(r.u0, d.u0 as number);
    close(r.u1, d.u1 as number);
    close(r.eHicks, d.eHicks as number);
    close(r.mSlutsky!, d.mSlutsky as number);
    close(r.cv, d.cv as number);
    close(r.ev, d.ev as number);
  });

  test("perfect substitutes at the tie price ratio: demand not unique, decomposition stated as not defined", () => {
    const o = run("micro-consumer", { util: "linear", a: "1", b: "1", p1: "1", p1new: "2", p2: "1" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/any bundle on the budget line/);
    expect(o.text).toMatch(/Hicks decomposition: not defined/);
    expect(insertableResultText(o.text)).toBe(true);
  });

  test("perfect complements: zero substitution effect, stated", () => {
    const o = run("micro-consumer", { util: "leontief", a: "1", b: "2" });
    expect(o.text).toMatch(/substitution effect B − A = 0\.0000/);
    expect(o.text).toMatch(/substitution effect is zero by construction/);
  });
});

describe("cost curves vs sympy", () => {
  test.each(cases(ORACLE.cost, (d, i) => `TC ${d.coefs.join(", ")} (${i})`))("%s", (_l, d: Record<string, unknown>) => {
    const c = (d.coefs as string[]).map(Q);
    const an = costAnalysis(c, null);
    if ("error" in an) throw new Error(an.error);
    close(an.shutdown.q, d.shutdownQ as number, 1e-9);
    close(an.shutdown.value, d.shutdownP as number, 1e-9);
    if (d.breakEvenQ !== undefined) {
      close(an.breakEven!.q, d.breakEvenQ as number, 1e-9);
      close(an.breakEven!.value, d.breakEvenP as number, 1e-9);
    }
    if (d.supplyQ !== undefined) {
      const s = supplyAt(an, Q(d.price as string));
      close(s.q, d.supplyQ as number, 1e-9);
      close(s.profit, d.profit as number, 1e-7);
    }
  });

  test("the default's shutdown and break-even are exact (q = 4, AVC = 8; q = 10, AC = 47)", () => {
    const o = run("micro-cost");
    expect(o.text).toMatch(/Shutdown point \(minimum AVC, where MC = AVC\): q = 4, AVC = MC = 8\./);
    expect(o.text).toMatch(/Break-even point \(minimum AC, where MC = AC\): q = 10, AC = MC = 47\./);
  });

  test("negative MC and a non-positive leading coefficient are refused by name", () => {
    expect(run("micro-cost", { tc: "100, 2, −4, 1" }).text).toMatch(/Marginal cost MC\(q\) = TC′\(q\) is negative/);
    expect(run("micro-cost", { tc: "100, 2, 4, −1" }).text).toMatch(/leading coefficient c₃ must be positive/);
    expect(run("micro-cost", { tc: "−5, 2, 1" }).text).toMatch(/fixed cost c₀ must be 0 or more/);
  });
});

describe("price discrimination vs sympy", () => {
  test.each(cases(ORACLE.pricedisc, (d, i) => d.in.join(", ") + ` (${i})`))("%s", (_l, d: Record<string, any>) => {
    const [a1, b1, a2, b2, c] = (d.in as string[]).map(Q);
    const r = priceDiscrimination([{ a: a1, b: b1 }, { a: a2, b: b2 }], c);
    if ("error" in r) throw new Error(r.error);
    r.third.q.forEach((q, i) => close(ratToNumber(q), d.third.q[i]));
    close(ratToNumber(r.third.profit), d.third.profit);
    close(ratToNumber(r.third.cs), d.third.cs);
    r.first.q.forEach((q, i) => close(ratToNumber(q), d.first.q[i]));
    close(ratToNumber(r.first.profit), d.first.profit);
    close(ratToNumber(r.uniformPrice), d.uniform.p);
    r.uniform.q.forEach((q, i) => close(ratToNumber(q), d.uniform.q[i]));
    close(ratToNumber(r.uniform.profit), d.uniform.profit);
    close(ratToNumber(r.uniform.cs), d.uniform.cs);
    close(ratToNumber(r.tsMax), d.tsMax);
  });
});

describe("auctions vs sympy order statistics", () => {
  test.each(cases(ORACLE.auction, (d, i) => `n = ${d.n}, reserve ${d.r} (${i})`))("%s", (_l, d: Record<string, any>) => {
    const lo = Q(d.lo);
    const hi = Q(d.hi);
    const r = auction(d.n, lo, hi, Q(d.r));
    expect(ratText(r.revFirst)).toBe(d.revFirst);
    expect(ratText(r.revSecond)).toBe(d.revSecond);
    close(ratToNumber(r.pSale), d.pSale);
    for (const [v, b] of d.bids as number[][]) close(ratToNumber(firstPriceBid(d.n, lo, hi, r.s, ratOf(v)!)), b, 1e-12);
  });
});

describe("growth accounting vs numpy", () => {
  const Y = [1000, 1031, 1058, 1092, 1124, 1151, 1118, 1176, 1212, 1243, 1275];
  const K = [3000, 3093, 3189, 3290, 3394, 3498, 3571, 3660, 3770, 3881, 3995];
  const L = [500, 505, 509, 515, 520, 524, 510, 518, 526, 531, 536];
  test.each(["log", "simple"] as const)("%s growth", (kind) => {
    const rows = growthAccounting(Y, K, L, 0.35, kind);
    const o = ORACLE[`growth_${kind}`];
    rows.forEach((r, i) => {
      close(r.gY, o.gY[i], 1e-12);
      close(r.capital, o.capital[i], 1e-12);
      close(r.labour, o.labour[i], 1e-12);
      close(r.tfp, o.tfp[i], 1e-12);
    });
  });
  test("TFP index", () => close(tfpIndex(Y, K, L, 0.35)[10], ORACLE.growth_tfpIndexLast, 1e-12));
  test("the calculator's average row matches", () => {
    const o = run("macro-growth-accounting");
    const avg = o.tables![0].rows.find((r) => r[0] === "Average")!;
    ORACLE.growth_log.mean.forEach((m: number, j: number) => close(num(avg[j + 1]) / 100, m, 5e-3 / Math.max(Math.abs(m), 1e-3) * 1e-2 + 1e-4));
  });
});

describe("Mundell–Fleming vs sympy.solve (exact)", () => {
  const base: MfParams = {
    C0: Q("200"), c: Q("3/4"), T: Q("200"), I0: Q("300"), b: Q("25"), G: Q("250"), NX0: Q("-140"), n: Q("200"), m: Q("1/10"),
    M: Q("600"), P: Q("1"), k: Q("1/2"), h: Q("50"), rw: Q("4"), f: null, e0: Q("1"),
  };
  const cases: [string, Partial<MfParams>, "floating" | "fixed"][] = [];
  for (const tag of ["perfect", "imperfect"]) {
    const fv = tag === "perfect" ? null : Q("100");
    for (const rg of ["floating", "fixed"] as const) {
      cases.push([`${tag}_${rg}_base`, { f: fv }, rg]);
      cases.push([`${tag}_${rg}_dG`, { f: fv, G: Q("300") }, rg]);
    }
    cases.push([`${tag}_floating_dM`, { f: fv, M: Q("650") }, "floating"]);
    cases.push([`${tag}_fixed_de`, { f: fv, e0: Q("11/10") }, "fixed"]);
  }
  test.each(cases)("%s", (key, over, rg) => {
    const s = mfSolve({ ...base, ...over }, rg)!;
    const want = ORACLE.mf[key];
    expect(ratText(s.Y)).toBe(want.Y);
    expect(ratText(s.r)).toBe(want.r);
    expect(ratText(s.e)).toBe(want.e);
    expect(ratText(s.M)).toBe(want.M);
  });
});

describe("multipliers vs sympy Rationals", () => {
  test("money multiplier default and a second case", () => {
    const o = run("macro-money-multiplier");
    const t = o.tables![0].rows;
    expect(t[1][1]).toBe(ORACLE.money.mult);
    expect(num(t[2][1])).toBe(Number(ORACLE.money.M));
    const o2 = run("macro-money-multiplier", { rr: "8", cr: "35", er: "2", base: "2500", dB: "" });
    expect(o2.text).toContain(`m = (1 + c)/(r + e + c) = ${ORACLE.money2.mult} (`);
  });
  test("fiscal multipliers default and a second case", () => {
    const o = run("macro-fiscal-multipliers");
    expect(o.text).toContain(`ΔY/ΔG = 1/(1 − c(1 − t) + m) = ${ORACLE.fiscal.k};`);
    expect(o.text).toContain(`= ${ORACLE.fiscal.kT.replace("-", "−")}`.replace("−8/5", "−1.6"));
    expect(o.text).toContain("budget balance changes by −50");
    const o2 = run("macro-fiscal-multipliers", { c: "0.9", t: "30", m: "0.2" });
    expect(o2.text).toContain(`ΔY/ΔG = 1/(1 − c(1 − t) + m) = ${ORACLE.fiscal2.k} ≈`);
  });
});

describe("Phillips curve vs statsmodels", () => {
  test("the default table is the oracle's synthetic table", () => {
    expect(PHILLIPS_DATA_DEFAULT).toBe(ORACLE.phillipsTable);
  });
  test.each([["classical", "nonrobust"], ["hc1", "HC1"], ["hac", "HAC"]])("%s SEs: α, β, NAIRU and its delta-method SE", (se, key) => {
    const o = run("macro-phillips", { se });
    const rows = o.tables![0].rows;
    const want = ORACLE.phillips[key];
    close(num(rows[1][1]), want.beta, 1e-4);
    close(num(rows[1][2]), want.seBeta, 1e-4);
    close(num(rows[2][1]), want.alpha, 1e-4);
    close(num(rows[2][2]), want.seAlpha, 1e-4);
    close(num(rows[3][1]), want.nairu, 1e-4);
    close(num(rows[3][2]), want.nairuSe, 2e-4);
  });
  test("expectations form", () => {
    const o = run("macro-phillips", { form: "expect" });
    const rows = o.tables![0].rows;
    close(num(rows[3][1]), ORACLE.phillips.expect.nairu, 1e-4);
    close(num(rows[3][2]), ORACLE.phillips.expect.nairuSe, 2e-4);
  });
});

// ------------------------------------------------------------------------------------------------ hostile inputs

describe("hostile inputs refuse by field name", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["micro-demand", { p: "" }, /price P is empty/],
    ["micro-demand", { p: "NaN" }, /price P/],
    ["micro-demand", { p: "1e400" }, /price P.*too large/],
    ["micro-demand", { p: "−3" }, /price P must be greater than 0/],
    ["micro-demand", { eps: "0.5" }, /elasticity ε must be less than 0/],
    ["micro-demand", { form: "semilog", b: "0" }, /slope b must be greater than 0/],
    ["micro-consumer", { m: "0" }, /Income m must be greater than 0/],
    ["micro-consumer", { util: "ces", rho: "0" }, /Cobb–Douglas limit/],
    ["micro-consumer", { util: "ces", rho: "1" }, /CES exponent ρ must be at most 0.95/],
    ["micro-consumer", { p1: "abc" }, /price of good 1/],
    ["micro-cost", { tc: "" }, /Total cost coefficients/],
    ["micro-cost", { tc: "1, 2, 3, 4, 5, 6, 7, 8" }, /at most 7/],
    ["micro-cost", { tc: "100" }, /at least c₀ and c₁/],
    ["micro-price-disc", { b1: "0" }, /Market 1 demand slope b₁ must be greater than 0/],
    ["micro-price-disc", { a1: "10", a2: "10", c: "20" }, /Neither market can be served profitably/],
    ["micro-auction", { n: "1" }, /number of bidders n must be at least 2/],
    ["micro-auction", { n: "2.5" }, /whole number/],
    ["micro-auction", { n: "201" }, /at most 200/],
    ["micro-auction", { hi: "0" }, /highest value must be greater than the lowest/],
    ["micro-auction", { reserve: "100" }, /reserve price must be below the highest value/],
    ["macro-growth-accounting", { alpha: "1" }, /capital share α must be less than 1/],
    ["macro-growth-accounting", { kcol: "Capital" }, /Capital column: No column is named/],
    ["macro-growth-accounting", { data: "Year\tY\tK\tL\n2020\t100\t0\t5\n2021\t101\t3\t5" }, /every value must be a positive number/],
    ["macro-mundell-fleming", { c: "1" }, /marginal propensity to consume c must be less than 1/],
    ["macro-mundell-fleming", { n: "0" }, /net-export sensitivity/],
    ["macro-mundell-fleming", { mobility: "imperfect", f: "" }, /capital-flow sensitivity f is empty/],
    ["macro-mundell-fleming", { dG: "1000" }, /exchange rate would fall/],
    ["macro-money-multiplier", { rr: "0", cr: "0", er: "0" }, /multiplier is unbounded/],
    ["macro-money-multiplier", { rr: "80", er: "30" }, /add up to more than 100%/],
    ["macro-fiscal-multipliers", { t: "100" }, /tax rate t must be less than 100/],
    ["macro-phillips", { picol: "infl" }, /Inflation column: No column is named/],
    ["macro-phillips", { data: "Year\tinflation\tunemployment\n2020\t2\t5\n2021\t3\t4" }, /at least 4|minimum|rows/],
    ["macro-phillips", { ucol: "inflation" }, /must be different columns/],
  ];
  test.each(cases)("%s %j", (id, over, re) => {
    const o = run(id, over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).toMatch(/^[A-Z“ΔΣ]/);
  });

  test("decimal comma, thousands separators and the true minus are read", () => {
    expect(run("micro-demand", { eps: "−1,5" }).text).toContain("ε = −1.5");
    expect(run("macro-money-multiplier", { base: "1,000" }).text).toContain("B = 1,000");
    expect(run("micro-demand", { A: "1,000", eps: "-1.5" }).ok).not.toBe(false);
  });
});

describe("adversarial-pass regressions", () => {
  test("a price far above the cost range still finds the rising-branch output (was: 'below the shutdown price')", () => {
    const o = run("micro-cost", { price: "1e12" });
    expect(o.text).toMatch(/output q ≈ 1,154,703\.2050/);
    expect(o.text).not.toMatch(/shuts down/);
  });
  test("a linear TC: output unbounded above c₁, shut below, stated (no false shutdown)", () => {
    expect(run("micro-cost", { tc: "100, 5", price: "50" }).text).toMatch(/output is unbounded/);
    expect(run("micro-cost", { tc: "100, 5", price: "5" }).text).toMatch(/output is not determined/);
    expect(run("micro-cost", { tc: "100, 5", price: "4" }).text).toMatch(/shuts down/);
  });
  test("a zero price change prints zero effects, not float noise", () => {
    const o = run("micro-consumer", { p1new: "2" });
    expect(o.text).toMatch(/substitution effect B − A = 0\.0000, income effect C − B = 0\.0000/);
    expect(o.text).not.toMatch(/10⁻¹/);
  });
  test("constant unemployment is refused by name before the regression", () => {
    const o = run("macro-phillips", { data: ["Year,inflation,unemployment", "2001,2,5", "2002,3,5", "2003,2,5", "2004,4,5", "2005,1,5"].join(String.fromCharCode(10)) });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Unemployment column “unemployment”: every usable value is 5\.00/);
  });
  test("without a date column the periods are named", () => {
    expect(run("macro-growth-accounting", { data: ["Y,K,L", "100,300,50", "102,306,50.5"].join(String.fromCharCode(10)) }).text).toMatch(/\(period 1 to period 2\)/);
  });
});

describe("caps stay fast", () => {
  const time = (f: () => unknown): number => {
    const t0 = Date.now();
    f();
    return Date.now() - t0;
  };
  test("auction at n = 200 with a rational reserve", () => {
    expect(time(() => expect(run("micro-auction", { n: "200", reserve: "100/3" }).ok).not.toBe(false))).toBeLessThan(1500);
  });
  test("highly composite and long-decimal cost coefficients skip the rational-root search (was 670 ms)", () => {
    for (const tc of ["963761198400, 963761198401, 963761198400, 1, 1, 1, 963761198400", "720720, 360360, 0.000001, 0.0000017, 0.0000013, 0.0000019, 0.0000023"]) {
      expect(time(() => run("micro-cost", { tc, price: "999999" }))).toBeLessThan(300);
    }
  });
  test("long decimals at n = 200 switch the auction to floating point and say so (was 2.4 s exact)", () => {
    let o: StatOutput | null = null;
    expect(time(() => (o = run("micro-auction", { n: "200", lo: "0.1234567890123", hi: "987654.321098765", reserve: "123456.789012345" })))).toBeLessThan(300);
    expect(o!.ok).not.toBe(false);
    expect(o!.text).toMatch(/evaluated in floating point/);
    expect(o!.text).toMatch(/equal to floating-point precision/);
  });
  test("the floating-point auction agrees with the exact one", () => {
    for (const d of ORACLE.auction) {
      const f = auctionNum(d.n, ratToNumber(Q(d.lo)), ratToNumber(Q(d.hi)), ratToNumber(Q(d.r)));
      close(f.revFirst, d.revFirstF, 1e-12);
      close(f.revSecond, d.revSecondF, 1e-12);
      for (const [v, b] of d.bids as number[][]) close(firstPriceBidNum(d.n, ratToNumber(Q(d.lo)), ratToNumber(Q(d.hi)), f.s, v), b, 1e-12);
    }
  });
  test("degree-6 cost polynomial", () => {
    expect(time(() => expect(run("micro-cost", { tc: "500, 40, −3, 0.1, 0.002, 0.0001, 0.00001" }).ok).not.toBe(false))).toBeLessThan(1500);
  });
  test("2,000-row growth table and 5,000-row Phillips table", () => {
    const g = ["Period\tY\tK\tL", ...Array.from({ length: 2000 }, (_, i) => `${i + 1}\t${(100 * Math.pow(1.01, i)).toFixed(4)}\t${(300 * Math.pow(1.012, i)).toFixed(4)}\t${(50 * Math.pow(1.002, i)).toFixed(4)}`)].join("\n");
    expect(time(() => expect(run("macro-growth-accounting", { data: g }).ok).not.toBe(false))).toBeLessThan(1500);
    const p = ["t\tinflation\tunemployment", ...Array.from({ length: 5000 }, (_, i) => `${i + 1}\t${(3 + Math.sin(i / 7)).toFixed(3)}\t${(5 + Math.cos(i / 5)).toFixed(3)}`)].join("\n");
    expect(time(() => expect(run("macro-phillips", { data: p }).ok).not.toBe(false))).toBeLessThan(1500);
  });
});
