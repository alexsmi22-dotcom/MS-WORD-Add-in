/**
 * Release E5b: micro-market (supply and demand) and micro-oligopoly (market structures), from field strings to the
 * StatOutput: exact oracle values (scripts/econ-micro-oracle.py, sympy integrals and KKT enumeration), the display
 * contract, the figure's geometry (every shaded polygon bounded by drawn lines, its area the printed surplus), and
 * hostile fields.
 */
import * as fs from "fs";
import * as path from "path";
import type { StatOutput } from "../analyzeBlocks";
import type { Rat } from "../cas";
import {
  MICRO_MARKET_FIELDS,
  MICRO_MARKET_DEFAULTS,
  MICRO_OLIGOPOLY_FIELDS,
  MICRO_OLIGOPOLY_DEFAULTS,
  microMarketCalc,
  microOligopolyCalc,
  parseFirms,
  welfareIdentityHolds,
} from "../microCalcs";
import { solveMarket, readRatField, fmtExact, fmtPct, clipToNonNegativeP, polygonArea, type MarketSpec, type Policy, type Side, type RegionKind } from "../microMarket";
import { solveOligopoly, stackelberg, OLIGOPOLY_MAX_FIRMS } from "../oligopoly";
import { budget } from "./timeBudget";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const layoutAudit = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (name: string, svg: string) => { found: string[] } };

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-micro-oracle.json"), "utf8"));

const reader = (base: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => (k in over ? over[k] : base[k] ?? "");
const market = (over: Record<string, string> = {}): StatOutput => microMarketCalc(reader(MICRO_MARKET_DEFAULTS, over));
const olig = (over: Record<string, string> = {}): StatOutput => microOligopolyCalc(reader(MICRO_OLIGOPOLY_DEFAULTS, over));

const rs = (r: Rat): string => (r.d === 1n ? String(r.n) : `${r.n}/${r.d}`);
const rat = (s: string): Rat => {
  const r = readRatField(s, "x");
  if (!r.ok || !r.v) throw new Error(`bad literal ${s}`);
  return r.v;
};

function shown(o: StatOutput): string {
  return [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
}

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`);

function expectDisplayContract(o: StatOutput): void {
  expect(o.ok).not.toBe(false);
  const s = shown(o);
  expect(s).not.toMatch(/NaN|Infinity/);
  expect(s).not.toMatch(/[=:[;]\s*(undefined|null)\b/);
  expect(s).not.toMatch(/\d[eE][+-]?\d/);
  expect(s).not.toMatch(/(^|[\s([;:=,])-\d/m);
  expect(s).not.toContain("—");
  // No combining diacritic anywhere (a hat over theta renders detached in Word): U+0300 to U+036F.
  expect(s).not.toMatch(COMBINING);
  for (const t of o.tables ?? []) {
    expect(t.align).toBeDefined();
    expect(t.align!.length).toBe(t.rows[0].length);
    expect(t.align![0]).toBe("left");
    // Word layout: at most six columns, so Word never squeezes a cell until it breaks a number.
    expect(t.rows[0].length).toBeLessThanOrEqual(6);
    for (const r of t.rows) {
      expect(r.length).toBe(t.rows[0].length);
      for (const cell of r) {
        expect(cell.trim()).not.toBe("");
        expect(cell).not.toMatch(/^(undefined|null)$/);
      }
    }
  }
  if (o.svg) {
    expect(o.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(layoutAudit.auditSvg("micro", o.svg).found).toEqual([]);
  }
}

// --------------------------------------------------------------------------------------------- figure geometry
interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
function lines(svg: string): Seg[] {
  const out: Seg[] = [];
  for (const m of svg.matchAll(/<line [^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] });
  return out;
}
function polygons(svg: string): { kind: string; pts: [number, number][] }[] {
  const out: { kind: string; pts: [number, number][] }[] = [];
  for (const m of svg.matchAll(/<polygon data-region="(\w+)" points="([^"]+)"/g)) {
    out.push({ kind: m[1], pts: m[2].split(" ").map((p) => p.split(",").map(Number) as [number, number]) });
  }
  return out;
}
const distToSeg = (px: number, py: number, s: Seg): number => {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
};
const pxArea = (pts: [number, number][]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
};

/** Every polygon edge lies along ONE drawn line (both ends within 0.05 px of it). */
function expectEdgesOnLines(svg: string): void {
  const segs = lines(svg);
  const polys = polygons(svg);
  expect(polys.length).toBeGreaterThan(0);
  for (const p of polys) {
    for (let i = 0; i < p.pts.length; i++) {
      const [ax, ay] = p.pts[i];
      const [bx, by] = p.pts[(i + 1) % p.pts.length];
      const ok = segs.some((s) => distToSeg(ax, ay, s) < 0.05 && distToSeg(bx, by, s) < 0.05);
      if (!ok) throw new Error(`${p.kind} edge (${ax},${ay})-(${bx},${by}) is not on a drawn line`);
    }
  }
}

const SPEC_DEFAULT = { a: "120", b: "2", c: "20", d: "3" };
const specOf = (o: { a: string; b: string; c: string; d: string; policy?: string; amount?: string; side?: string }): MarketSpec => ({
  a: rat(o.a),
  b: rat(o.b),
  c: rat(o.c),
  d: rat(o.d),
  policy: (o.policy ?? "none") as Policy,
  amount: o.amount ? rat(o.amount) : null,
  side: (o.side ?? "sellers") as Side,
});

describe("field declarations", () => {
  it("declare every field with a default, and selects with options", () => {
    expect(MICRO_MARKET_FIELDS.map((f) => f.key)).toEqual(["a", "b", "c", "d", "policy", "amount", "side", "qunit", "cur"]);
    expect(MICRO_OLIGOPOLY_FIELDS.map((f) => f.key)).toEqual(["a", "b", "costs", "qunit", "cur"]);
    for (const f of MICRO_MARKET_FIELDS) expect(MICRO_MARKET_DEFAULTS[f.key]).toBeDefined();
    for (const f of MICRO_OLIGOPOLY_FIELDS) expect(MICRO_OLIGOPOLY_DEFAULTS[f.key]).toBeDefined();
    for (const f of [...MICRO_MARKET_FIELDS, ...MICRO_OLIGOPOLY_FIELDS]) if (f.kind === "select") expect(f.options!.length).toBeGreaterThan(1);
  });
});

describe("micro-market against the sympy oracle (exact)", () => {
  for (const c of fixture.market) {
    it(c.name, () => {
      const res = solveMarket(specOf(c.input));
      if (!res.ok) throw new Error(res.reason);
      const r = res.r;
      const e = c.expect;
      expect(rs(r.qe)).toBe(e.qe);
      expect(rs(r.pe)).toBe(e.pe);
      expect(rs(r.eps)).toBe(e.eps);
      expect(r.eta === null ? null : rs(r.eta)).toBe(e.eta);
      expect(rs(r.csE)).toBe(e.csE);
      expect(rs(r.psE)).toBe(e.psE);
      expect(r.binding).toBe(e.policy.binding);
      if (e.policy.binding) {
        for (const k of ["q", "buyers", "sellers", "cs", "ps", "dwl"]) expect([k, rs((r as unknown as Record<string, Rat>)[k])]).toEqual([k, e.policy[k]]);
        if (e.policy.rev) expect(rs(r.rev)).toBe(e.policy.rev);
        if (e.policy.sub) expect(rs(r.sub)).toBe(e.policy.sub);
        if ("qd" in e.policy) expect(rs(r.qd!)).toBe(e.policy.qd);
        if ("qs" in e.policy) expect(r.qs === null ? null : rs(r.qs!)).toBe(e.policy.qs);
      }
      if (e.ways) {
        for (const side of ["sellers", "buyers"] as const) {
          const w = r.ways![side];
          for (const k of ["q", "buyers", "sellers", "buyerShare", "sellerShare"] as const) expect([side, k, rs(w[k])]).toEqual([side, k, e.ways[side][k]]);
        }
      }
      expect(welfareIdentityHolds(r)).toBe(true);
      // The calculator end to end on the same input keeps the display contract and draws a clean figure.
      const o = microMarketCalc(reader({ ...MICRO_MARKET_DEFAULTS, policy: "none", amount: "" }, c.input));
      expectDisplayContract(o);
      expectEdgesOnLines(o.svg!);
    });
  }
});

describe("micro-market figure: the shading is the printed surplus", () => {
  const cases: Record<string, string>[] = [
    { policy: "none" },
    { policy: "tax", amount: "10", side: "sellers" },
    { policy: "tax", amount: "10", side: "buyers" },
    { policy: "subsidy", amount: "5" },
    { policy: "ceiling", amount: "56" },
    { policy: "floor", amount: "95" },
    { a: "50", b: "0.5", c: "−5", d: "0.25", policy: "tax", amount: "12" },
    { a: "50", b: "0.5", c: "−5", d: "0.25", policy: "ceiling", amount: "5" },
    { a: "30", b: "1", c: "12", d: "0", policy: "tax", amount: "3" },
    { a: "30", b: "1", c: "12", d: "0", policy: "floor", amount: "20" },
  ];
  for (const over of cases) {
    it(JSON.stringify(over), () => {
      const o = market(over);
      expectDisplayContract(o);
      const svg = o.svg!;
      expectEdgesOnLines(svg);
      const res = solveMarket(specOf({ ...SPEC_DEFAULT, ...MICRO_MARKET_DEFAULTS, ...over, c: (over.c ?? "20").replace("−", "-") }));
      if (!res.ok) throw new Error(res.reason);
      const regions = res.r.binding ? res.r.regions : res.r.regionsE;
      const drawn = polygons(svg);
      const nonzero = regions.filter((g) => g.poly.length >= 3 && g.area.n !== 0n);
      expect(drawn.map((p) => p.kind).sort()).toEqual(nonzero.map((g) => g.kind).sort());
      // Pixel areas are proportional to the exact areas (one scale for every region): compare ratios to the largest.
      const big = nonzero.reduce((m, g) => (Number(g.area.n) / Number(g.area.d) > Number(m.area.n) / Number(m.area.d) ? g : m));
      const bigPx = pxArea(drawn.find((p) => p.kind === big.kind)!.pts);
      for (const g of nonzero) {
        const want = Number(g.area.n) / Number(g.area.d) / (Number(big.area.n) / Number(big.area.d));
        const got = pxArea(drawn.find((p) => p.kind === (g.kind as RegionKind))!.pts) / bigPx;
        expect(Math.abs(got - want)).toBeLessThan(2e-3);
      }
    });
  }

  it("the default figure carries its axes with units, a legend and the title", () => {
    const svg = market().svg!;
    expect(svg).toContain("Quantity Q (unit)");
    expect(svg).toContain("Price P ($ per unit)");
    for (const l of ["Demand D", "Supply S", "S + t (tax on sellers)", "Equilibrium E", "Consumer surplus", "Producer surplus", "Tax revenue", "Deadweight loss"]) expect(svg).toContain(l);
    expect(svg).toContain("Supply and demand with a per-unit tax");
  });

  it("geometry and drawing stay inside the frame: curves are clipped, never past the plot rectangle", () => {
    const overs: Record<string, string>[] = [{ d: "300" }, { b: "0.01" }, { policy: "floor", amount: "119" }, { a: "900000000000", b: "0.000001", c: "1000", d: "0.000003", amount: "100000000" }];
    for (const over of overs) {
      const o = market(over);
      expectDisplayContract(o);
      const svg = o.svg!;
      const roles = [...svg.matchAll(/<line data-role="(demand|supply|shifted|control|guide)" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)];
      const ax = [...svg.matchAll(/<line data-role="axis" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)];
      const left = Math.min(...ax.map((m) => Math.min(+m[1], +m[3])));
      const right = Math.max(...ax.map((m) => Math.max(+m[1], +m[3])));
      const top = Math.min(...ax.map((m) => Math.min(+m[2], +m[4])));
      const bottom = Math.max(...ax.map((m) => Math.max(+m[2], +m[4])));
      for (const m of roles) {
        for (const [x, y] of [[+m[2], +m[3]], [+m[4], +m[5]]]) {
          expect(x).toBeGreaterThanOrEqual(left - 0.01);
          expect(x).toBeLessThanOrEqual(right + 0.01);
          expect(y).toBeGreaterThanOrEqual(top - 0.01);
          expect(y).toBeLessThanOrEqual(bottom + 0.01);
        }
      }
      expectEdgesOnLines(svg);
    }
  });
});

describe("micro-market text and tables", () => {
  it("the worked default prints the model back, the equilibrium, incidence and welfare exactly", () => {
    const o = market();
    expectDisplayContract(o);
    expect(o.text).toContain("demand P = 120 − 2Q, supply P = 20 + 3Q");
    expect(o.text).toContain("Q* = 20, P* = 80");
    expect(o.text).toContain("demand ε = −2, supply η = 4/3 ≈ 1.333");
    expect(o.text).toContain("quantity 18, buyers pay 84, sellers receive 74");
    expect(o.text).toContain("buyers bear 40% of the tax and sellers 60%");
    expect(o.text).toContain("Consumer surplus 324, producer surplus 486, tax revenue 180, deadweight loss 10 ($)");
    expect(o.text).toMatch(/Conventions:/);
    const inc = o.tables!.find((t) => t.label.startsWith("Incidence"))!;
    expect(inc.rows[1]).toEqual(["Quantity traded (unit)", "18", "18"]);
    expect(inc.rows[2]).toEqual(["Buyers' price ($ per unit)", "84", "84"]);
  });

  it("a tax on buyers and on sellers give the same incidence (columns computed separately)", () => {
    for (const side of ["sellers", "buyers"]) {
      const o = market({ side, a: "100", b: "1.5", c: "10", d: "0.7", amount: "7/3" });
      expectDisplayContract(o);
      const inc = o.tables!.find((t) => t.label.startsWith("Incidence"))!;
      for (const row of inc.rows.slice(1)) expect(row[1]).toBe(row[2]);
    }
  });

  it("perfectly elastic supply: η printed in words and buyers bear all of the tax", () => {
    const o = market({ a: "30", b: "1", c: "12", d: "0", amount: "3" });
    expectDisplayContract(o);
    expect(o.text).toContain("supply η = perfectly elastic (d = 0)");
    expect(o.text).toContain("buyers bear 100% of the tax and sellers 0%");
  });

  it("a non-binding ceiling or floor is reported, not refused", () => {
    const c = market({ policy: "ceiling", amount: "90" });
    expectDisplayContract(c);
    expect(c.text).toContain("does not bind");
    expect(c.svg).toContain("Price ceiling (not binding)");
    const f = market({ policy: "floor", amount: "80" });
    expectDisplayContract(f);
    expect(f.text).toContain("does not bind");
  });

  it("binding controls: shortage, excess supply and the rationing assumption", () => {
    const c = market({ policy: "ceiling", amount: "56" });
    expect(c.text).toContain("quantity demanded 32, quantity supplied 12, shortage 20");
    expect(c.text).toContain("Efficient rationing is assumed");
    const f = market({ policy: "floor", amount: "95" });
    expect(f.text).toContain("quantity demanded 12.5, quantity supplied 25, excess supply 12.5");
    expect(f.text).toContain("Efficient production is assumed");
    const u = market({ a: "30", b: "1", c: "12", d: "0", policy: "floor", amount: "20" });
    expectDisplayContract(u);
    expect(u.text).toContain("excess supply unbounded");
  });

  it("subsidy: overlap explained, government cost and DWL", () => {
    const o = market({ policy: "subsidy", amount: "5" });
    expectDisplayContract(o);
    expect(o.text).toContain("subsidy cost 105");
    expect(o.text).toContain("deadweight loss 2.5 ($)");
    expect(o.svg).toContain("CS and PS overlap");
    expect(o.svg).toContain("Subsidy cost");
  });

  it("formats: exact decimals, short fractions with a decimal, true minus, percents", () => {
    expect(fmtExact(rat("2.5"))).toBe("2.5");
    expect(fmtExact(rat("1250"))).toBe("1,250");
    expect(fmtExact(rat("-70/3"))).toBe("−70/3 ≈ −23.333");
    expect(fmtPct(rat("1/3"))).toBe("≈ 33.333%");
    expect(fmtPct(rat("2/5"))).toBe("40%");
  });

  it("polygon helpers: clipping at P = 0 and the shoelace area", () => {
    const tri = clipToNonNegativeP([[rat("0"), rat("-5")], [rat("10"), rat("5")], [rat("0"), rat("5")]]);
    expect(tri.length).toBe(4);
    expect(rs(polygonArea(tri))).toBe("75/2");
  });
});

describe("micro-market hostile fields", () => {
  const refused = (over: Record<string, string>, re: RegExp): void => {
    const o = market(over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
  };
  it("rubbish, blank, huge and tiny numbers are refused by name", () => {
    refused({ a: "abc" }, /demand intercept a: “abc” is not a number/i);
    refused({ a: "" }, /Enter the demand intercept a/);
    refused({ b: "1e400" }, /larger in magnitude than 10¹²/);
    refused({ b: "1e-12" }, /smaller in magnitude than 10⁻⁹/);
    refused({ c: "1,2,3" }, /not a number/);
    refused({ d: "x".repeat(80) }, /longer than 40 characters/);
    refused({ amount: "abc" }, /Tax per unit: “abc” is not a number/);
    refused({ amount: "" }, /Enter the tax per unit/);
    refused({ policy: "quota" }, /Unknown policy/);
    refused({ side: "both" }, /Unknown side/);
    refused({ qunit: "a very long unit name here" }, /at most 16 characters/);
  });
  it("degenerate models are refused with the reason", () => {
    refused({ b: "−1" }, /demand slope b must be greater than 0/);
    refused({ b: "0" }, /demand slope b must be greater than 0/);
    refused({ d: "−1" }, /supply slope d must be 0 or more/);
    refused({ a: "20" }, /No equilibrium with a positive quantity/);
    refused({ a: "10", c: "20" }, /No equilibrium with a positive quantity/);
    refused({ a: "10", b: "1", c: "−30", d: "0.1" }, /equilibrium price would be/);
    refused({ amount: "100" }, /no quantity would be traded/);
    refused({ amount: "120" }, /no quantity would be traded/);
    refused({ amount: "−3" }, /must be greater than 0/);
    refused({ policy: "subsidy", amount: "1000" }, /buyers' price would be/);
    refused({ policy: "ceiling", amount: "−1" }, /must be 0 or more/);
    // A market closed without a policy stays refused for every policy but a subsidy large enough to open it.
    refused({ a: "10", c: "12", policy: "tax", amount: "1" }, /No equilibrium with a positive quantity/);
    refused({ a: "10", c: "12", policy: "ceiling", amount: "11" }, /No equilibrium with a positive quantity/);
    refused({ a: "10", c: "12", policy: "subsidy", amount: "2" }, /A subsidy opens the market only when it exceeds c − a = 2/);
    refused({ a: "50", b: "0.5", c: "−5", d: "0.25", amount: "45" }, /sellers' price would be −5\/3, below 0/);
    // At exactly a sellers' price of 0 the tax is accepted (producer surplus 0).
    const edge = market({ a: "50", b: "0.5", c: "−5", d: "0.25", amount: "40" });
    expectDisplayContract(edge);
    expect(edge.text).toContain("sellers receive 0");
  });
  it("a subsidy that opens a market closed without it is solved on the post-policy curves (a = 10, c = 12, s = 5)", () => {
    const o = market({ a: "10", b: "1", c: "12", d: "1", policy: "subsidy", amount: "5" });
    expectDisplayContract(o);
    expect(o.text).toContain("Without the policy the market is closed");
    expect(o.text).toContain("quantity 1.5, buyers pay 8.5, sellers receive 13.5");
    expect(o.text).toContain("Consumer surplus 1.125, producer surplus 1.125, subsidy cost 7.5, deadweight loss 5.25 ($)");
    expect(o.text).toContain("The subsidy opens the market: it exceeds c − a = 2");
    // The results block (above the conventions) prints no no-policy price, elasticity or incidence share.
    expect(o.text.split("\n\n")[0]).not.toMatch(/Incidence:|P\* =|ε =/);
    const w = o.tables!.find((t) => /welfare/.test(t.label))!;
    expect(w.rows[1]).toEqual(["Quantity traded (unit)", "0", "1.5", "1.5"]);
    expect(w.rows[2]).toEqual(["Buyers' price ($ per unit)", "no trade", "8.5", "not defined"]);
    expect(o.tables!.some((t) => t.label.startsWith("Incidence"))).toBe(false);
    expect(o.svg).not.toContain("Equilibrium E");
    expectEdgesOnLines(o.svg!);
    const res = solveMarket({ a: rat("10"), b: rat("1"), c: rat("12"), d: rat("1"), policy: "subsidy", amount: rat("5"), side: "buyers" });
    if (!res.ok) throw new Error(res.reason);
    expect(welfareIdentityHolds(res.r)).toBe(true);
    expect(rs(res.r.dwl)).toBe("21/4");
  });
  it("a ceiling at or below c, or a floor at or above a, closes the market (Q = 0) with welfare, not a refusal", () => {
    const c = market({ policy: "ceiling", amount: "15" });
    expectDisplayContract(c);
    expect(c.text).toContain("The market closes (Q = 0): the ceiling is at or below the lowest price at which anything is supplied (c = 20)");
    expect(c.text).toContain("quantity demanded 52.5, quantity supplied 0, shortage 52.5; quantity traded 0");
    expect(c.text).toContain("Consumer surplus 0, producer surplus 0, deadweight loss 1,000 ($)");
    expectEdgesOnLines(c.svg!);
    const f = market({ policy: "floor", amount: "130" });
    expectDisplayContract(f);
    expect(f.text).toContain("The market closes (Q = 0): the floor is at or above the demand intercept a = 120");
    expect(f.text).toContain("deadweight loss 1,000 ($)");
    expectEdgesOnLines(f.svg!);
    for (const [policy, amount] of [["ceiling", "20"], ["floor", "120"], ["ceiling", "0"]]) {
      const res = solveMarket({ a: rat("120"), b: rat("2"), c: rat("20"), d: rat("3"), policy: policy as Policy, amount: rat(amount), side: "sellers" });
      if (!res.ok) throw new Error(res.reason);
      expect(res.r.closes).toBe(true);
      expect(rs(res.r.q)).toBe("0");
      expect(welfareIdentityHolds(res.r)).toBe(true);
    }
    // A negative supply intercept: the lost surplus is clipped at P = 0, as the no-policy surplus is.
    const neg = solveMarket({ a: rat("50"), b: rat("0.5"), c: rat("−5"), d: rat("0.25"), policy: "floor", amount: rat("60"), side: "sellers" });
    if (!neg.ok) throw new Error(neg.reason);
    expect(welfareIdentityHolds(neg.r)).toBe(true);
  });
  it("a non-zero value whose double underflows to 0 is refused, not read as 0", () => {
    for (const v of ["1e-400", "1e-330", "−1e-330"]) {
      refused({ b: v }, /smaller in magnitude than 10⁻⁹/);
      refused({ d: v }, /smaller in magnitude than 10⁻⁹/);
      refused({ amount: v }, /smaller in magnitude than 10⁻⁹/);
    }
    expect(olig({ costs: "A\t1e-400\nB\t2" }).text).toMatch(/smaller in magnitude than 10⁻⁹/);
  });
  it("tiny scales print four significant digits and still draw a clean figure", () => {
    const o = market({ a: "0.00002", b: "0.000001", c: "0.00001", d: "0.000002", amount: "0.000001" });
    expectDisplayContract(o);
    expectEdgesOnLines(o.svg!);
    expect(o.text).toContain("P* = 1/60000 ≈ 1.667×10⁻⁵");
    expect(o.text).toContain("deadweight loss 1/6000000 ≈ 1.667×10⁻⁷ ($)");
    const t = market({ a: "1.0000000000000000000000000000000000001", b: "1", c: "1", d: "1", policy: "none" });
    expectDisplayContract(t);
    expect(t.text).toContain("Q* ≈ 5.000×10⁻³⁸");
    expect(t.text).not.toContain("= ≈");
    expectEdgesOnLines(t.svg!);
  });
  it("labels at their maximum length keep the figures' layout clean", () => {
    const o = market({ qunit: "kilowatt-hour xx", cur: "pounds sterling", a: "120000000", b: "2", c: "20000000", d: "3", amount: "10000000" });
    expectDisplayContract(o);
    const names = "A very long firm name number1\t10\nA very long firm name number2\t20";
    const g = olig({ costs: names, qunit: "kilowatt-hour xx" });
    expectDisplayContract(g);
    expect(g.svg).toContain("q₁, output of firm 1 (kilowatt-hour xx)");
    expect(g.svg).toContain("Firm 1 is A very long firm name number1.");
  });
  it("accepts a true minus, decimal commas, grouped thousands and fractions", () => {
    const o = market({ a: "1,200", b: "2,5", c: "−20", d: "7/2", amount: "10" });
    expectDisplayContract(o);
    expect(o.text).toContain("demand P = 1,200 − 2.5Q, supply P = −20 + 3.5Q");
  });
  it("the largest inputs run quickly (closed form; measured ≪ 50 ms, bounded at 3 s)", () => {
    const t0 = Date.now();
    for (const pol of ["tax", "subsidy", "ceiling", "floor", "none"]) {
      const o = market({ a: "999999999999.123456789012345678901234", b: "0.000000001234567890123456789012345678", c: "1.23456789012345678901234567890123456", d: "0.00000000987654321098765432109876543", policy: pol, amount: pol === "ceiling" ? "300000" : pol === "floor" ? "999999999990" : "12345.6789" });
      if (o.ok !== false) expectDisplayContract(o);
    }
    expect(Date.now() - t0).toBeLessThan(budget(3000));
  });
});

// ------------------------------------------------------------------------------------------------- oligopoly
describe("micro-oligopoly against the oracle (exact)", () => {
  for (const c of fixture.oligopoly) {
    it(c.name, () => {
      const firms = c.input.costs.map((x: string, i: number) => ({ name: `Firm ${i + 1}`, c: rat(x) }));
      const res = solveOligopoly(rat(c.input.a), rat(c.input.b), firms);
      if (!res.ok) throw new Error(res.reason);
      const keys = Object.keys(c.expect);
      expect(res.r.structures.map((s) => s.key)).toEqual(keys);
      for (const s of res.r.structures) {
        const e = c.expect[s.key];
        expect([s.key, "price", rs(s.price)]).toEqual([s.key, "price", e.price]);
        expect([s.key, "total", rs(s.total)]).toEqual([s.key, "total", e.total]);
        expect([s.key, s.q.map(rs)]).toEqual([s.key, e.q]);
        expect([s.key, s.profit.map(rs)]).toEqual([s.key, e.profit]);
        for (const k of ["cs", "ts", "dwl", "lerner", "hhi"] as const) expect([s.key, k, rs(s[k])]).toEqual([s.key, k, e[k]]);
        for (const q of s.q) expect(q.n >= 0n).toBe(true);
      }
      const o = microOligopolyCalc(reader(MICRO_OLIGOPOLY_DEFAULTS, { a: c.input.a, b: c.input.b, costs: c.input.costs.join("\n") }));
      expectDisplayContract(o);
    });
  }
});

describe("micro-oligopoly behaviour", () => {
  it("the worked default compares five structures and draws the best responses with both points", () => {
    const o = olig();
    expectDisplayContract(o);
    expect(o.text).toContain("Cournot–Nash: price 50, total output 70");
    expect(o.text).toContain("Stackelberg (firm 1 leads): price 40, total output 80");
    expect(o.text).toContain("Bertrand: price 20, total output 100");
    expect(o.svg).toContain("Cournot best responses");
    expect(o.svg).toContain("Stackelberg");
    expect(o.svg).toContain("q₁, output of Firm 1 (unit)");
    const m = o.tables![0];
    expect(m.rows[0]).toEqual(["Measure", "Competition", "Monopoly", "Cournot", "Bertrand", "Stackelberg"]);
    expect(m.rows.map((r) => r[0])).toEqual(["Measure", "Price ($ per unit)", "Total output (unit)", "Consumer surplus ($)", "Total profit ($)", "Total surplus ($)", "Deadweight loss ($)", "Lerner index", "HHI"]);
  });

  it("Word layout: the structure table is transposed (≤ 6 columns), cells are decimals only, exact fractions are in the text", () => {
    // The Word pass: 9 columns with "250000/49 ≈ 5,102.041" cells broke numbers mid-digit.
    const o = olig({ a: "100", b: "0.7", costs: "A\t3\nB\t9" });
    expectDisplayContract(o);
    for (const t of o.tables!) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const cell of t.rows.slice(1).flatMap((r) => r.slice(1))) {
        expect(cell).not.toMatch(/\/|≈/);
        expect(cell.length).toBeLessThanOrEqual(14);
      }
      expect(t.note).toMatch(/Decimals: exact when they terminate within three places/);
    }
    const m = o.tables![0];
    const lerner = m.rows.find((r) => r[0] === "Lerner index")!;
    expect(lerner.every((c) => !/\//.test(c))).toBe(true);
    // The exact fraction is in the text with its decimal.
    expect(o.text).toMatch(/Cournot–Nash: price [\d,]+\/\d+ ≈ [\d,.]+/);
    expect(o.text).toMatch(/Lerner index \d+\/\d+ ≈ 0\.\d{4}/);
    // Per-firm tables carry the marginal cost in the firm's cell.
    expect(o.tables![1].rows[0][0]).toBe("Firm (marginal cost)");
    expect(o.tables![1].rows[1][0]).toBe("A (3)");
  });

  it("Cournot exits are named and never negative; Stackelberg is omitted beyond two firms with a note", () => {
    const o = olig({ a: "100", b: "2", costs: "A\t10\nB\t20\nC\t30\nD\t70\nE\t90" });
    expectDisplayContract(o);
    expect(o.text).toContain("Cournot exits: D, E");
    expect(o.text).toContain("Stackelberg is computed for exactly two firms");
    expect(o.svg).toContain("held at their Cournot output");
  });

  it("Stackelberg corners: monopoly output, limit quantity, a leader that stays out", () => {
    const r = (a: string, c1: string, c2: string) => stackelberg(rat(a), rat("1"), rat(c1), rat(c2));
    expect(r("50", "10", "40").regime).toMatch(/monopoly quantity/);
    const lim = r("100", "10", "45");
    expect(rs(lim.q1)).toBe("55");
    expect(rs(lim.q2)).toBe("0");
    expect(lim.regime).toMatch(/limit quantity/);
    expect(r("100", "60", "10").regime).toMatch(/produces nothing/);
  });

  it("zero marginal cost: the Lerner index is 0 at P = MC = 0 (no 0/0)", () => {
    const o = olig({ a: "90", b: "3", costs: "0\n0" });
    expectDisplayContract(o);
    const lerner = o.tables![0].rows.find((r) => r[0] === "Lerner index")!;
    expect(lerner.slice(1)).toEqual(["0", "1", "1", "0", "1"]);
    expect(o.tables![0].note).toContain("The Lerner index is 0 where P = MC = 0.");
    expect(o.text).toContain("Perfect competition: price 0, total output 30, deadweight loss 0; consumer surplus 1,350, total profit 0, Lerner index 0 (P = MC = 0)");
  });

  it("one firm: monopoly everywhere, no best-response figure", () => {
    const o = olig({ costs: "Solo\t8" });
    expectDisplayContract(o);
    expect(o.svg).toBeUndefined();
    expect(o.text).toContain("no best-response functions");
  });

  it("parses names, colons, bare costs and a header row", () => {
    const p = parseFirms("Firm\tMC\nAcme: 3\nBeta 4.5\n6");
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.firms.map((f) => `${f.name}=${rs(f.c)}`)).toEqual(["Acme=3", "Beta=9/2", "Firm 3=6"]);
  });

  it("hostile fields are refused by name", () => {
    const refused = (over: Record<string, string>, re: RegExp): void => {
      const o = olig(over);
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(re);
    };
    refused({ costs: "" }, /at least one firm/);
    refused({ costs: "abc" }, /Line 1 \(“abc”\) has no marginal cost/);
    refused({ costs: "Name\tMC\nAcme\t" }, /Line 2 \(“Acme”\) has no marginal cost/);
    refused({ costs: "A\t10\nB\tabc" }, /Marginal cost of B: “abc” is not a number/);
    refused({ costs: "A\t−1\nB\t2" }, /cannot be negative/);
    refused({ costs: "A\t130\nB\t140" }, /No firm can sell/);
    refused({ costs: "A\t1\nA\t2" }, /Two firms are named/);
    refused({ costs: Array.from({ length: 22 }, (_, i) => String(i)).join("\n") }, /At most 20 firms/);
    refused({ costs: Array.from({ length: 21 }, (_, i) => `F${i}\t${i}`).join("\n") }, /At most 20 firms/);
    refused({ b: "0" }, /demand slope b must be greater than 0/);
    refused({ b: "−2" }, /demand slope b must be greater than 0/);
    refused({ a: "1e400" }, /larger in magnitude/);
    refused({ a: "" }, /Enter the demand intercept a/);
    refused({ costs: "x".repeat(5000) }, /longer than 40 characters|no marginal cost/);
  });

  it("the clock stops a runaway iteration by name", () => {
    let t = 0;
    const firms = Array.from({ length: 5 }, (_, i) => ({ name: `F${i}`, c: rat(String(10 * i)) }));
    const res = solveOligopoly(rat("100"), rat("1"), firms, () => (t += 7000));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/exceeded 6 s/);
  });

  it(`the largest input (${OLIGOPOLY_MAX_FIRMS} firms, 40-character costs) runs in well under a second (bounded at 3 s)`, () => {
    const costs = Array.from({ length: OLIGOPOLY_MAX_FIRMS }, (_, i) => `F${i}\t${(i + 1).toString()}.${"1234567890123456789012345678901234567".slice(0, 36 - String(i + 1).length)}`).join("\n");
    const t0 = Date.now();
    const o = olig({ a: "999999999999.12345678901234567890123", b: "0.0000000012345678901234567890123", costs });
    const ms = Date.now() - t0;
    expectDisplayContract(o);
    expect(ms).toBeLessThan(budget(3000));
  });
});
