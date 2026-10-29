/**
 * Release F2 forensic and actuarial calculators (gap items #8 and #17): the bundled CDC 2024 life table against the
 * printed report, the engines against scripts/forensic-oracle.py (fixtures/forensic-oracle.json) and the Society of
 * Actuaries' printing of the Illustrative Life Table, the registry through the pane's read path, and hostile inputs.
 */
import * as fs from "fs";
import * as path from "path";
import { FORENSIC_CALCS } from "../forensicCalcs";
import { readFinanceField } from "../finance";
import type { FinCalcDef, FinResult } from "../finCalc";
import { insertableResultText } from "../insertGate";
import { US_LIFE_2024 } from "../usLifeTable2024";
import { cdcTable, chooseTable, commutation, completeExpectation, isRefusal, lAt, userTable, type LifeTable } from "../lifeTable";
import { lostEarningsLpe, type LpeInput } from "../forensicEarnings";
import { percentiles109050, quantileScratch, retirementSchedule, swrMonteCarlo } from "../retirement";
import { quantilesOf } from "../ipValuation";
import { Pcg32 } from "../prng";
import { sigText } from "../forensicReports";
import { civilDay } from "../damagesInterest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ORACLE = require("./fixtures/forensic-oracle.json");

/** The pane's read (finSpreadContract.test.ts): number fields through readFinanceField, everything else as typed. */
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
const calc = (id: string): FinCalcDef => FORENSIC_CALCS.find((c) => c.id === id)!;
const out = (r: FinResult) => (typeof r === "string" ? { text: r, ok: true as boolean | undefined, tables: undefined, table: undefined, svg: undefined } : r);

// ---------------------------------------------------------------------------------------------------------------
// The bundled life table against the printed report (NVSR Vol. 75, No. 5, Tables 1–3 and the text)
// ---------------------------------------------------------------------------------------------------------------

/** Age: [qx as printed to 6 decimals, lx as printed]. Transcribed from the report PDF (Tables 1, 2, 3). */
const PRINTED: Record<"total" | "male" | "female", Record<number, [number, number]>> = {
  total: {
    0: [0.005531, 100000], 1: [0.000401, 99447], 5: [0.000148, 99344], 10: [0.000098, 99282], 20: [0.000714, 98950], 25: [0.000942, 98541],
    30: [0.001269, 98027], 40: [0.00219, 96428], 45: [0.002786, 95262], 50: [0.003898, 93763], 60: [0.008779, 88595], 65: [0.012723, 84133],
    70: [0.01811, 78082], 80: [0.046154, 58997], 90: [0.138036, 25811], 99: [0.311054, 3072], 100: [1, 2116],
  },
  male: {
    0: [0.005886, 100000], 1: [0.000444, 99411], 5: [0.000161, 99297], 10: [0.000092, 99230], 20: [0.001028, 98783], 25: [0.00136, 98194],
    30: [0.001759, 97465], 40: [0.002855, 95339], 45: [0.003529, 93853], 50: [0.004894, 91999], 60: [0.010888, 85721], 65: [0.015689, 80401],
    70: [0.022217, 73331], 80: [0.053909, 52469], 90: [0.156662, 20201], 99: [0.343262, 1782], 100: [1, 1170],
  },
  female: {
    0: [0.005161, 100000], 1: [0.000356, 99484], 5: [0.000134, 99393], 10: [0.000104, 99336], 20: [0.000384, 99124], 25: [0.00051, 98905],
    30: [0.000767, 98614], 40: [0.001512, 97564], 45: [0.002041, 96729], 50: [0.002909, 95595], 60: [0.006751, 91574], 65: [0.009963, 87990],
    70: [0.01447, 82959], 80: [0.040007, 65626], 90: [0.127213, 31379], 99: [0.301068, 4243], 100: [1, 2966],
  },
};

describe("bundled CDC 2024 life table", () => {
  test.each(["total", "male", "female"] as const)("%s: 17 printed ages of qx (6 dp) and lx recomputed from qx", (sex) => {
    const t = cdcTable(sex);
    for (const [age, [q, l]] of Object.entries(PRINTED[sex])) {
      const x = Number(age);
      expect(Math.round(US_LIFE_2024[sex].qx[x] * 1e6) / 1e6).toBeCloseTo(q, 9);
      expect(Math.round(t.lx[x])).toBe(l);
    }
  });

  test("the report's text: e65 19.7, e85 6.7, e100 2.2; survivors 99.0% to 20, 84.1% to 65, 43.8% to 85, 2.1% to 100", () => {
    const t = cdcTable("total");
    // The abstract: life expectancy at birth 79.0 (total), 76.5 (males), 81.4 (females); ex recomputed from qx (UDD).
    expect(completeExpectation(t, 0).toFixed(1)).toBe("79.0");
    expect(completeExpectation(cdcTable("male"), 0).toFixed(1)).toBe("76.5");
    expect(completeExpectation(cdcTable("female"), 0).toFixed(1)).toBe("81.4");
    expect(completeExpectation(t, 65).toFixed(1)).toBe("19.7");
    expect(completeExpectation(t, 85).toFixed(1)).toBe("6.7");
    expect(completeExpectation(t, 100).toFixed(1)).toBe("2.2");
    // The extension reproduces the published e100 (to the closing residue).
    for (const sex of ["total", "male", "female"] as const) expect(Math.abs(completeExpectation(cdcTable(sex), 100) - US_LIFE_2024[sex].e100)).toBeLessThan(1e-5);
    expect((Math.round(Math.round(t.lx[20]) / 100) / 10).toFixed(1)).toBe("99.0");
    expect((Math.round(Math.round(t.lx[65]) / 100) / 10).toFixed(1)).toBe("84.1");
    expect((Math.round(Math.round(t.lx[85]) / 100) / 10).toFixed(1)).toBe("43.8");
    expect((Math.round(Math.round(t.lx[100]) / 100) / 10).toFixed(1)).toBe("2.1");
  });

  test("UDD between whole ages, 0 at the closing age, NaN below the start", () => {
    const t = cdcTable("female");
    expect(lAt(t, 40.25)).toBeCloseTo(t.lx[40] * 0.75 + t.lx[41] * 0.25, 9);
    expect(lAt(t, 131)).toBe(0);
    expect(lAt(t, 200)).toBe(0);
    expect(lAt(t, -1)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #17 factors: the Illustrative Life Table (published) and the CDC table (oracle)
// ---------------------------------------------------------------------------------------------------------------

describe("Illustrative Life Table (Bowers et al., Actuarial Mathematics, App. 2A; SOA Exam MLC tables) via a pasted qx column", () => {
  const t = userTable(ORACLE.ilt.qxText, "qx") as LifeTable;
  const factors = (x: number, i: number, n: number) => {
    const c = commutation(t, i);
    const k = x - t.startAge;
    return { ad: c.N[k] / c.D[k], A: c.M[k] / c.D[k], E: (c.D[k + n] ?? 0) / c.D[k] };
  };
  test.each<[string | number, unknown]>(ORACLE.ilt.rows.map((r: { x: number }) => [r.x, r] as [number, unknown]))("age %i reproduces the printed äx, 1000Ax, 1000 ²Ax, 1000 ₅Eₓ, ₁₀Eₓ, ₂₀Eₓ", (_x, r) => {
    const row = r as { x: number; published: number[]; ad: number; A: number; A2: number; E5: number; E10: number; E20: number };
    expect(isRefusal(t)).toBe(false);
    const f = factors(row.x, 0.06, 5);
    const f2 = factors(row.x, 1.06 ** 2 - 1, 5);
    const e10 = factors(row.x, 0.06, 10).E;
    const e20 = factors(row.x, 0.06, 20).E;
    const [ad, A, A2, E5, E10, E20] = row.published;
    expect(f.ad.toFixed(4)).toBe(ad.toFixed(4));
    expect((1000 * f.A).toFixed(2)).toBe(A.toFixed(2));
    expect((1000 * f2.A).toFixed(2)).toBe(A2.toFixed(2));
    expect((1000 * f.E).toFixed(2)).toBe(E5.toFixed(2));
    expect((1000 * e10).toFixed(2)).toBe(E10.toFixed(2));
    expect((1000 * e20).toFixed(2)).toBe(E20.toFixed(2));
    // And the oracle's unrounded values.
    expect(f.ad).toBeCloseTo(row.ad, 9);
    expect(f.A).toBeCloseTo(row.A, 10);
    expect(f2.A).toBeCloseTo(row.A2, 10);
  });

  test("the calculator prints ä65 = 9.8969 and 1000 A65 = 439.80 from the pasted table", () => {
    const o = out(run(calc("act-annuity"), { table: "user-qx", usertable: ORACLE.ilt.qxText, age: "65", rate: "6", term: "20", defer: "0", payment: "0" }));
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("äₓ = 9.8969");
    expect(o.text).toMatch(/Aₓ = 0\.43979\d \(whole/);
    expect(o.text).toContain("ₙEₓ = 0.097600");
  });
});

describe("CDC factors against the oracle", () => {
  const cases = ORACLE.cdc.filter((c: { ad?: number }) => c.ad !== undefined);
  test.each<[string | number, unknown]>(cases.map((c: { sex: string; x: number; i: number }) => [`${c.sex} x=${c.x} i=${c.i}`, c] as [string, unknown]))("%s", (_l, cc) => {
    const c = cc as Record<string, number> & { sex: "total" | "male" | "female" };
    const t = cdcTable(c.sex);
    const cm = commutation(t, c.i);
    const k = c.x;
    const at = (a: number[], j: number) => (j < a.length ? a[j] : 0);
    const D = cm.D[k];
    const got: Record<string, number> = {
      ad: cm.N[k] / D,
      a: at(cm.N, k + 1) / D,
      A: cm.M[k] / D,
      adn: (cm.N[k] - at(cm.N, k + c.n)) / D,
      an: (at(cm.N, k + 1) - at(cm.N, k + c.n + 1)) / D,
      A1n: (cm.M[k] - at(cm.M, k + c.n)) / D,
      nE: at(cm.D, k + c.n) / D,
      mad: at(cm.N, k + c.m) / D,
      madn: (at(cm.N, k + c.m) - at(cm.N, k + c.m + c.n)) / D,
    };
    for (const key of Object.keys(got)) expect(Math.abs(got[key] - c[key])).toBeLessThan(1e-10 * Math.max(1, Math.abs(c[key])));
    // Identity Ax = 1 − d äx.
    expect(Math.abs(got.A - (1 - (c.i / (1 + c.i)) * got.ad))).toBeLessThan(1e-12);
  });
  test("complete expectation (UDD) against the oracle", () => {
    for (const c of ORACLE.cdc.filter((c: { ex?: number }) => c.ex !== undefined)) expect(completeExpectation(cdcTable(c.sex), c.x)).toBeCloseTo(c.ex, 10);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #8 lost earnings against the oracle
// ---------------------------------------------------------------------------------------------------------------

function lpeInput(c: Record<string, unknown>): LpeInput {
  const d = (s: string): number => {
    const [y, m, dd] = s.split("-").map(Number);
    return civilDay(y, m, dd);
  };
  return {
    dob: d(c.dob as string),
    injury: d(c.injury as string),
    trial: d(c.trial as string),
    table: cdcTable(c.sex as "total" | "male" | "female"),
    base: c.base as number,
    residual: c.residual as number,
    growth: (c.growth as number) / 100,
    method: c.method as "lpe" | "wle",
    workEndAge: c.workend as number,
    wle: c.wle as number,
    pe: (c.pe as number[][]).map(([a, p, e]) => ({ fromAge: a, part: p / 100, emp: e / 100 })),
    fringe: (c.fringe as number) / 100,
    tax: (c.tax as number) / 100,
    consumption: (c.consumption as number) / 100,
    hhHours: c.hhhours as number,
    hhValue: c.hhvalue as number,
    hhGrowth: (c.hhgrowth as number) / 100,
    hhEndAge: c.hhend as number,
    survivalFrom: c.survival as "trial" | "injury",
    discountMode: c.dmode as "growth" | "ndr",
    discount: (c.discount as number) / 100,
    ndr: (c.ndr as number) / 100,
    midYear: c.mid === "mid",
    pjiRate: (c.pji as number) / 100,
    pjiMethod: c.pjimethod as "simple" | "annual",
  };
}

describe("lost earnings (LPE / WLE) against the oracle", () => {
  test.each<[string | number, unknown]>(ORACLE.lpe.map((c: { name: string }) => [c.name, c] as [string, unknown]))("%s: every row to the cent (±1), totals", (_n, cc) => {
    const c = cc as { inputs: Record<string, unknown>; rows: Record<string, number | boolean>[]; past: number; interest: number; future: number; futurePv: number; total: number };
    const r = lostEarningsLpe(lpeInput(c.inputs));
    if ("error" in r) throw new Error(r.error);
    expect(r.rows.length).toBe(c.rows.length);
    let worst = 0;
    r.rows.forEach((row, i) => {
      const o = c.rows[i];
      expect(row.past).toBe(o.past);
      for (const [mine, theirs] of [
        [row.capacityCents, o.capacity],
        [row.earnCents, o.earn],
        [row.hhCents, o.hh],
        [row.totalCents, o.total],
        [row.interestCents, o.interest],
        [row.valueCents, o.value],
      ] as [number, number][]) worst = Math.max(worst, Math.abs(mine - theirs));
    });
    expect(worst).toBeLessThanOrEqual(1);
    const n = r.rows.length;
    expect(Math.abs(r.pastCents - c.past)).toBeLessThanOrEqual(n);
    expect(Math.abs(r.interestCents - c.interest)).toBeLessThanOrEqual(n);
    expect(Math.abs(r.futurePvCents - c.futurePv)).toBeLessThanOrEqual(n);
    expect(Math.abs(r.totalCents - c.total)).toBeLessThanOrEqual(2 * n);
  });

  test("hand check: one past year, no growth, no probabilities beyond survival: interest is simple and exact", () => {
    // Injury 2020-01-01, trial 2021-01-01 (366 days = 1.002 years), WLE 1 year, $36,525 a year, nothing else.
    const r = lostEarningsLpe({
      ...lpeInput({ ...ORACLE.lpe[0].inputs, dob: "1980-01-01", injury: "2020-01-01", trial: "2021-01-01", method: "wle", wle: 1, residual: 0, base: 36525, growth: 0, fringe: 0, tax: 0, hhhours: 0, pji: 10 }),
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.rows.length).toBe(1);
    // All past: $36,525.00, accrual at the middle day (2020-07-02 = injury + round(0.5 × 365.25) = +183), 183 days of 10% simple to 2021-01-01.
    expect(r.pastCents).toBe(3652500);
    expect(r.interestCents).toBe(Math.round((3652500 * 0.1 * 183) / 365));
    expect(r.futurePvCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #17 retirement schedule and Monte Carlo against the oracle
// ---------------------------------------------------------------------------------------------------------------

describe("retirement schedule against the oracle", () => {
  test.each<[string | number, unknown]>(ORACLE.retire.map((c: { args: number[] }) => [c.args.join(", "), c] as [string, unknown]))("%s", (_l, cc) => {
    const c = cc as { args: number[]; rows: { age: number; start: number; flow: number; end: number; real: number }[]; atRetireReal: number | null; runsOut: number | null };
    const [age, retireAge, endAge, balance, contribution, withdrawal, ret, infl] = c.args;
    const r = retirementSchedule({ age, retireAge, endAge, balance, contribution, withdrawal, ret, infl });
    expect(r.rows.length).toBe(c.rows.length);
    r.rows.forEach((row, i) => {
      for (const k of ["start", "flow", "end", "real"] as const) expect(Math.abs(row[k] - c.rows[i][k])).toBeLessThan(1e-7 * Math.max(1, Math.abs(c.rows[i][k])));
    });
    expect(r.runsOutAge).toBe(c.runsOut);
    if (c.atRetireReal !== null) expect(r.atRetireReal).toBeCloseTo(c.atRetireReal, 6);
  });
});

const SWR_FP_100K = "100.231470000000 82086001.2848564 425307895.522539 1491420766.83453";
const SWR_FP_60K = "1205.80833333333 29585560.6858002 128039684.532176 4738445135.09169";

describe("safe-withdrawal Monte Carlo against the oracle (same PCG32 stream, exact)", () => {
  test.each<[string | number, unknown]>(ORACLE.swr.map((c: { args: number[] }) => [c.args.join(", "), c] as [string, unknown]))("%s", (_l, cc) => {
    const c = cc as { args: number[]; alive: string | null; ruinBy: number[]; p10: number[]; p50: number[]; p90: number[]; whileAlive: number | null };
    const [balance, withdrawal, years, mean, sd, paths, seed] = c.args;
    let alive: number[] | null = null;
    if (c.alive === "total65") {
      const t = cdcTable("total");
      alive = Array.from({ length: years }, (_v, k) => lAt(t, 65 + k) / lAt(t, 65));
    }
    const r = swrMonteCarlo({ balance, withdrawal, years, mean, sd, paths, seed, alive });
    expect(r.ruinBy).toEqual(c.ruinBy);
    for (let k = 0; k < years; k++) {
      for (const [a, b] of [[r.p10[k], c.p10[k]], [r.p50[k], c.p50[k]], [r.p90[k], c.p90[k]]]) expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));
    }
    if (c.whileAlive !== null) expect(r.ruinWhileAlive).toBeCloseTo(c.whileAlive, 12);
  });

  test("at the work budget (90,000 paths × 40 years = 3,600,000) it finishes in time", () => {
    const t0 = Date.now();
    const o = out(run(calc("act-swr-mc"), { paths: "90000", years: "40" }));
    const ms = Date.now() - t0;
    expect(o.ok).not.toBe(false);
    expect(ms).toBeLessThan(3000);
  });

  test("F2 review speed-up: the bucketed percentiles are bit-identical to quantilesOf (ties, zeros, outliers, tiny n)", () => {
    const rng = new Pcg32(5, 54);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const arrays: Float64Array[] = [
      Float64Array.from([3]),
      Float64Array.from([2, 1]),
      Float64Array.from([5, 5, 5, 5]),
      Float64Array.from([0, 0, 0, 7, 0, 0, 1e12, 0, 0, 0, 3]),
    ];
    for (const n of [10, 11, 999, 1000, 4097, 20000]) {
      arrays.push(Float64Array.from({ length: n }, () => (u() < 0.3 ? 0 : Math.exp(3 * (u() - 0.5)) * 1e6)));
      arrays.push(Float64Array.from({ length: n }, () => Math.round(u() * 20)));
      const a = Float64Array.from({ length: n }, () => u());
      a[0] = 1e15;
      arrays.push(a);
    }
    for (const a of arrays) {
      const got = percentiles109050(a, quantileScratch(a.length));
      expect(got).toEqual(quantilesOf(a, [0.1, 0.5, 0.9]));
    }
  });

  test("F2 review speed-up: same seed, same numbers (the v2.203.0-pre fingerprint at 100,000 × 36 and 60,000 × 60)", () => {
    // Fingerprints of the full result recorded from the quickselect version before the speed-up.
    const fp = (r: ReturnType<typeof swrMonteCarlo>): string => [r.ruinBy, r.p10, r.p50, r.p90].map((xs) => xs.reduce((s, v, i) => s + v * (i + 1), 0).toPrecision(15)).join(" ");
    const a = swrMonteCarlo({ balance: 1e6, withdrawal: 4e4, years: 36, mean: 0.04, sd: 0.12, paths: 100000, seed: 1, alive: null });
    expect(fp(a)).toBe(SWR_FP_100K);
    const b = swrMonteCarlo({ balance: 1e6, withdrawal: 6e4, years: 60, mean: 0.05, sd: 0.15, paths: 60000, seed: 20261027, alive: null });
    expect(fp(b)).toBe(SWR_FP_60K);
  });

  test("at each cap shape the compute is fast (median of 3)", () => {
    for (const [paths, years] of [["100000", "36"], ["60000", "60"], ["90000", "40"]]) {
      const ts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        out(run(calc("act-swr-mc"), { paths, years, table: "none" }));
        ts.push(Date.now() - t0);
      }
      ts.sort((x, y) => x - y);
      // About 190 ms on the dev PC; the test allows 1,000 ms so a busy machine does not flake it.
      expect(ts[1]).toBeLessThan(1000);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Registry contract (the finSpreadContract checks, run locally) and printed defaults
// ---------------------------------------------------------------------------------------------------------------

describe("registry", () => {
  const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
  test("ids unique against every id in the pane (FIN_CALCS and STAT_CALCS) and lib registries", () => {
    const paneIds = new Set([...PANE.matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)].map((m) => m[1]));
    const libDir = path.join(__dirname, "..");
    for (const f of fs.readdirSync(libDir).filter((f) => /Calcs\.ts$/.test(f) && f !== "forensicCalcs.ts")) {
      for (const m of fs.readFileSync(path.join(libDir, f), "utf8").matchAll(/^ {4}id: "([a-z0-9-]+)",/gm)) paneIds.add(m[1]);
    }
    for (const c of FORENSIC_CALCS) expect(paneIds.has(c.id)).toBe(false);
    expect(new Set(FORENSIC_CALCS.map((c) => c.id)).size).toBe(FORENSIC_CALCS.length);
  });

  test.each(FORENSIC_CALCS.map((c) => [c.id, c] as [string, unknown]))("%s: defaults insertable, tables ≤ 6 columns, cells insertable, name does not repeat the group", (_id, c) => {
    const cc = c as FinCalcDef;
    expect(cc.name.toLowerCase().startsWith(cc.group.toLowerCase())).toBe(false);
    const o = out(run(cc));
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).toContain("Conventions:");
    const tables = o.tables ?? (o.table ? [o.table] : []);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
    }
    expect(o.svg).toBeTruthy();
    expect(o.text).not.toMatch(/\d-\d|[0-9]e[+-]?\d|\^/); // no hyphen-minus between digits, no e-notation, no caret
  });

  test("no Math.random in the new modules; the registry entry form", () => {
    for (const f of ["forensicCalcs.ts", "forensicReports.ts", "forensicEarnings.ts", "lifeTable.ts", "retirement.ts", "usLifeTable2024.ts"]) {
      expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
    }
    const src = fs.readFileSync(path.join(__dirname, "..", "forensicCalcs.ts"), "utf8");
    expect([...src.matchAll(/compute: \(r\) => \{\n\s+\/\/ .+\n\s+return \w+\(r\);/g)].length).toBe(FORENSIC_CALCS.length);
  });

  test("printed default values (TEST-SCRIPT)", () => {
    const lpe = out(run(calc("dmg-lost-earnings-lpe"))).text;
    expect(lpe).toContain("Total at the trial date: $885,891.18 = past losses $162,056.00 + prejudgment interest $13,338.74 + present value of future losses $710,496.44");
    const ann = out(run(calc("act-annuity"))).text;
    expect(ann).toContain("äₓ = 13.4542 (whole life annuity-due); aₓ = 12.4542 (annuity-immediate, äₓ − 1); Aₓ = 0.482532 (whole life insurance)");
    const ret = out(run(calc("act-retire"))).text;
    expect(ret).toContain("Balance at retirement (age 67): 1,926,824.69 (1,119,224.38 in today's money)");
    const mc = out(run(calc("act-swr-mc"))).text;
    // fix-fin R2 #9: to 0.1 point with the simulation standard error (was "23.445%"; TEST-SCRIPT needs the same update).
    expect(mc).toContain("Probability of ruin within 30 years: 23.4%, simulation standard error about 0.30 percentage points (20,000 paths, seed 20261027)");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Hostile inputs: every refusal names its field
// ---------------------------------------------------------------------------------------------------------------

describe("hostile inputs", () => {
  const refusal = (id: string, over: Record<string, string>): string => {
    const o = out(run(calc(id), over));
    expect(o.ok).toBe(false);
    expect(o.text).not.toContain("NaN");
    expect(o.text).not.toContain("undefined");
    return o.text;
  };
  test.each([
    ["base", "", "Pre-injury annual earnings"],
    ["base", "abc", "Pre-injury annual earnings"],
    ["base", "1e400", "Pre-injury annual earnings"],
    ["base", "−5", "Pre-injury annual earnings"],
    ["growth", "−100", "Earnings growth"],
    ["tax", "100", "Effective tax rate"],
    ["hhhours", "200", "Household services (hours a week)"],
    ["discount", "", "Discount rate"],
    ["pji", "5.12345", "Prejudgment interest rate"],
    ["workend", "40", "Earnings end age"],
    ["dob", "1979-02-30", "Date of birth"],
    ["injury", "yesterday", "Date of injury"],
    ["trial", "2020-01-01", "trial date"],
    ["residual", "90,000", "residual earning capacity"],
    ["pe", "40 0.88 0.96", "enter percentages"],
    ["pe", "40 0.88 96", "participation 0.88 reads as less than 1%"],
    ["base", "$68,000", "Pre-injury annual earnings"],
    ["pe", "50 88 96", "after the age at injury"],
    ["pe", "40 88 96\n35 80 95", "list the rows by rising age"],
    ["pe", "40 188 96", "participation must be"],
  ])("lost earnings %s = %j", (key, value, needle) => {
    expect(refusal("dmg-lost-earnings-lpe", { [key]: value }).toLowerCase()).toContain(needle.toLowerCase());
  });
  test("thousands and true minus read through the product's reader", () => {
    const a = out(run(calc("dmg-lost-earnings-lpe"), { base: "68000", residual: "24000" })).text;
    const b = out(run(calc("dmg-lost-earnings-lpe"), { base: "68,000.00", residual: "$24,000" })).text;
    expect(b === a || b.includes("Residual earning capacity")).toBe(true);
    const neg = out(run(calc("act-retire"), { inflation: "−1" }));
    expect(neg.ok).not.toBe(false);
    expect(neg.text).toContain("−1%");
  });
  test("worklife expectancy method and the net discount rate run; the WLE table is yours", () => {
    const o = out(run(calc("dmg-lost-earnings-lpe"), { method: "wle", wle: "15.5", dmode: "ndr" }));
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("worklife expectancy method");
    expect(o.text).toContain("net discount rate 1.5%");
    expect(o.text).toContain("Skoog–Ciecka–Krueger");
    expect(refusal("dmg-lost-earnings-lpe", { method: "wle", wle: "0" })).toContain("Worklife expectancy");
  });
  test("pasted life tables: malformed rows refused by name", () => {
    expect(refusal("act-annuity", { table: "user-qx", usertable: "" })).toContain("Your life table");
    expect(refusal("act-annuity", { table: "user-qx", usertable: "60 0.01\n62 0.02" })).toContain("does not follow");
    expect(refusal("act-annuity", { table: "user-qx", usertable: "60 0.01\n61 12" })).toContain("per 1,000");
    expect(refusal("act-annuity", { table: "user-lx", usertable: "60 1000\n61 1200" })).toContain("cannot increase");
    expect(refusal("act-annuity", { table: "user-lx", usertable: "60 1000\n61 900\n62 0", age: "65" })).toContain("Age x");
    const ok = out(run(calc("act-annuity"), { table: "user-lx", usertable: "60\t1000\n61\t900\n62\t700", age: "60", term: "2", defer: "1" }));
    expect(ok.ok).not.toBe(false);
    expect(ok.text).toContain("closed with lx = 0 at age 63");
    // ä60 = 1 + 0.9v + 0.7v² at 4%.
    expect(ok.text).toContain(`äₓ = ${(1 + 0.9 / 1.04 + 0.7 / 1.04 ** 2).toFixed(4)}`);
  });
  test.each([
    ["age", "131", "Age x"],
    ["age", "64.5", "Age x"],
    ["rate", "−5", "Interest rate"],
    ["rate", "30", "Interest rate"],
    ["term", "0", "Term n"],
    ["defer", "−1", "Deferral m"],
    ["payment", "abc", "Annual payment"],
  ])("annuity %s = %j", (key, value, needle) => {
    expect(refusal("act-annuity", { [key]: value })).toContain(needle);
  });
  test.each([
    ["retire", "40", "Retirement age"],
    ["end", "45", "Plan to age"],
    ["return", "−100", "Nominal return"],
    ["balance", "1e400", "Savings today"],
    ["age", "45.5", "Current age"],
  ])("retirement %s = %j", (key, value, needle) => {
    expect(refusal("act-retire", { [key]: value })).toContain(needle);
  });
  test("retirement: depletion is reported and the balance stays at 0", () => {
    const o = out(run(calc("act-retire"), { withdraw: "150,000" }));
    expect(o.text).toMatch(/The money runs out at age \d+/);
    const rows = o.tables![0].rows;
    expect(rows.some((r) => r[0].includes("depleted"))).toBe(true);
    expect(rows[rows.length - 1][4]).toBe("0.00");
  });
  test.each([

    ["paths", "500", "Paths"],
    ["paths", "1e400", "Paths"],
    ["years", "61", "Years"],
    ["seed", "-1", "Seed"],
    ["seed", "1.5", "Seed"],
    ["seed", "99999999999999999999", "Seed"],
    ["sd", "−1", "Standard deviation"],
    ["withdraw", "0", "Withdrawal"],
    ["age", "131", "Age at the start"],
  ])("Monte Carlo %s = %j", (key, value, needle) => {
    expect(refusal("act-swr-mc", { [key]: value })).toContain(needle);
  });
  test("Monte Carlo: past the work budget is refused by name", () => {
    expect(refusal("act-swr-mc", { paths: "100000", years: "50" })).toContain("work budget");
  });
  test("Monte Carlo with no life table; the same seed gives the same answer", () => {
    const a = out(run(calc("act-swr-mc"), { table: "none", paths: "2000" }));
    const b = out(run(calc("act-swr-mc"), { table: "none", paths: "2000" }));
    expect(a.ok).not.toBe(false);
    expect(a.text).toBe(b.text);
    expect(a.text).not.toContain("while alive");
    expect(a.tables![0].rows[0].length).toBe(5);
  });
  test("sigText: no e-notation", () => {
    expect(sigText(1.234567e-7)).toBe("1.23457 × 10⁻⁷");
    expect(sigText(84133.3)).toBe("84,133.3");
    expect(sigText(0)).toBe("0");
    expect(sigText(0.00123456)).toBe("0.00123456");
  });
  test("adversarial: every loss before the trial (all past), a user table that starts after the injury, the recursion äₓ = 1 + v pₓ äₓ₊₁", () => {
    const allPast = out(run(calc("dmg-lost-earnings-lpe"), { trial: "2026-11-02", workend: "45", hhhours: "0" }));
    expect(allPast.ok).not.toBe(false);
    expect(allPast.text).toContain("present value of future losses $0.00");
    const late = refusal("dmg-lost-earnings-lpe", { table: "user-qx", usertable: "50 0.01\n51 0.02\n52 1" });
    expect(late).toContain("no lives at the age at injury");
    const t = cdcTable("male");
    const c = commutation(t, 0.05);
    for (const x of [0, 30, 64, 99, 100, 120]) {
      const ad = c.N[x] / c.D[x];
      const ad1 = c.N[x + 1] / c.D[x + 1];
      expect(ad).toBeCloseTo(1 + (1 / 1.05) * (t.lx[x + 1] / t.lx[x]) * ad1, 10);
    }
    const old = out(run(calc("act-annuity"), { age: "130", term: "5", defer: "2" }));
    expect(old.ok).not.toBe(false);
    expect(old.text).toContain("äₓ = 1.0000");
  });
  test("adversarial: the worklife expectancy method leaves the probability cells blank (not applied)", () => {
    const o = out(run(calc("dmg-lost-earnings-lpe"), { method: "wle", wle: "10" }));
    const t1 = o.tables![0].rows;
    expect(t1[1][3]).toBe("");
    expect(t1[1][4]).toBe("");
  });
  test("chooseTable falls back to the total table", () => {
    const t = chooseTable("weird", "");
    expect(isRefusal(t)).toBe(false);
  });
});
