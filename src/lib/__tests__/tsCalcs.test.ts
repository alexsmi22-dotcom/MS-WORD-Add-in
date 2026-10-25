/**
 * The Release E3a calculators end to end (lib/tsCalcs.ts): the shipped default against statsmodels' own numbers
 * (fixture from scripts/ts-diag-oracle.py), the display contract on every ok output, the hostile inputs the brief
 * lists, and 100,000-row timings.
 */
import * as fs from "fs";
import * as path from "path";
import {
  tsAcfCalc,
  tsUnitRootCalc,
  tsHpCalc,
  TS_DEFAULT,
  TS_ACF_DEFAULTS,
  TS_UNITROOT_DEFAULTS,
  TS_HP_DEFAULTS,
  TS_CALCULATORS,
} from "../tsCalcs";
import { fmtFixed, fmtP } from "../regTable";
import { insertableResultText } from "../insertGate";
import { tableCellsInsertable } from "../damagesInterest";
import type { StatOutput } from "../analyzeBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ts-diag-oracle.json"), "utf8"));
const NB = String.fromCharCode(0xa0);

const reader =
  (defaults: Record<string, string>, over: Record<string, string> = {}) =>
  (k: string): string =>
    over[k] ?? defaults[k] ?? "";

/** Every display-contract rule the brief pins, over text, cells and notes (as econCalcs.test.ts). */
function contractViolations(out: StatOutput): string[] {
  const all = [out.text, ...(out.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])];
  const bad: string[] = [];
  for (const s of all) {
    if (/\d-\d|(^|[\s(\[=])-\d/.test(s)) bad.push(`hyphen minus: ${s}`);
    if (/\d[eE][-+]?\d/.test(s)) bad.push(`e-notation: ${s}`);
    if (/NaN|Infinity|undefined/.test(s)) bad.push(`broken: ${s}`);
    if (s.includes("—")) bad.push(`em dash: ${s}`);
    if (/R\^?2\b|\^/.test(s)) bad.push(`caret: ${s}`);
    if (/p [=<] 0\.000\b|0\.000\*/.test(s)) bad.push(`zero p: ${s}`);
    // A math subscript written with an underscore (x_t, S_{t}); code names such as acorr_ljungbox are fine.
    if (/_\{|(^|[^a-z])[a-zτσ]_[a-z0-9](?![a-z])/i.test(s)) bad.push(`underscore subscript: ${s}`);
  }
  if (!insertableResultText(out.text)) bad.push("text fails the insert gate");
  for (const t of out.tables ?? []) if (!tableCellsInsertable(t.rows)) bad.push(`table ${t.label} fails the gate`);
  if (out.svg !== undefined && /NaN|Infinity|undefined/.test(out.svg)) bad.push("svg carries a broken number");
  return bad;
}

function expectOk(out: StatOutput): void {
  if (out.ok === false) throw new Error(`refused: ${out.text}`);
  expect(contractViolations(out)).toEqual([]);
  expect(out.svg).toMatch(/^<svg/);
}

const series = (vals: number[], header = "Value"): string => [header, ...vals.map((v) => String(v))].join("\n");
const quarterly = (vals: number[], header = "y"): string =>
  [`Quarter ${header}`, ...vals.map((v, i) => `${2000 + Math.floor(i / 4)}-Q${(i % 4) + 1} ${v}`)].join("\n");

test("the shipped default is the table the oracle computed on", () => {
  expect(TS_DEFAULT).toBe(FX.defaultTable);
});

test("calculator list: ids, titles and field keys", () => {
  expect(TS_CALCULATORS.map((c) => c.id)).toEqual(["ts-acf", "ts-unitroot", "ts-hp"]);
  expect(TS_CALCULATORS.map((c) => c.fields.map((f) => f.key))).toEqual([
    ["data", "series", "lags", "modelDf"],
    ["data", "series", "regression", "adfMode", "adfLag", "kpssMode", "kpssLags"],
    ["data", "series", "lambdaRule", "lambda"],
  ]);
  for (const c of TS_CALCULATORS) for (const f of c.fields) if (f.kind === "select") expect(f.options?.some((o) => o.value === f.default)).toBe(true);
});

describe("ts-acf on the default (Spread)", () => {
  const out = tsAcfCalc(reader(TS_ACF_DEFAULTS));
  const fx = FX.acf[0];
  test("ok, contract clean, figure with both panels", () => {
    expectOk(out);
    expect(out.svg).toContain("ACF of Spread");
    expect(out.svg).toContain("PACF of Spread");
  });
  test("every table cell equals statsmodels' value at the printed decimals", () => {
    const rows = (out.tables ?? [])[0].rows;
    expect(rows[0]).toEqual(["Lag", "ACF", "95% band (±)", "PACF", "Ljung–Box Q", "df", "p"]);
    expect(rows.length - 1).toBe(fx.K);
    for (let k = 1; k <= fx.K; k++) {
      expect(rows[k]).toEqual([String(k), fmtFixed(fx.acf[k], 3), fmtFixed(fx.band[k], 3), fmtFixed(fx.pacf[k], 3), fmtFixed(fx.q[k - 1], 3), String(k), fmtP(fx.p[k - 1])]);
    }
  });
  test("conventions printed", () => {
    expect(out.text).toContain("Correlogram of Spread: lags 1 to 20");
    expect(out.text).toContain("120 quarterly observations, 1995 Q1 to 2024 Q4.");
    expect(out.text).toContain('"ywadjusted"');
    expect(out.text).toContain("min(⌊10·log₁₀ n⌋, n/2 − 1) = 20");
    expect(out.text).toContain("Bartlett");
    expect(out.text).toContain(`p ${"<"}${NB}0.001`);
  });
  test("model df: p is n/a up to the model df, and the cell passes the insert gate", () => {
    const o = tsAcfCalc(reader(TS_ACF_DEFAULTS, { lags: "6", modelDf: "2" }));
    expectOk(o);
    const rows = (o.tables ?? [])[0].rows;
    expect(rows[1][5]).toBe("-1".replace("-", "−"));
    expect(rows[1][6]).toBe("n/a");
    expect(rows[2][6]).toBe("n/a");
    expect(rows[3][5]).toBe("1");
    expect(o.text).toContain("χ² on L − 2 degrees of freedom");
  });
});

describe("ts-unitroot on the default (Output, constant)", () => {
  const out = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS));
  const adf = FX.adf.find((c: { name: string }) => c.name === "default Output, constant, AIC");
  const kp = FX.kpss.find((c: { name: string }) => c.name === "default Output, constant, auto");
  test("ok and contract clean", () => expectOk(out));
  test("ADF and KPSS rows equal statsmodels at the printed decimals", () => {
    const rows = (out.tables ?? [])[0].rows;
    expect(rows[1]).toEqual([
      "ADF (constant)",
      "Unit root",
      fmtFixed(adf.stat, 3),
      fmtP(adf.p),
      String(adf.usedLag),
      String(adf.nobs),
      fmtFixed(adf.crit[0], 3),
      fmtFixed(adf.crit[1], 3),
      fmtFixed(adf.crit[2], 3),
    ]);
    expect(rows[2].slice(0, 5)).toEqual(["KPSS (constant)", "Stationary", fmtFixed(kp.stat, 3), `<${NB}0.01`, String(kp.lags)]);
  });
  test("the reading: both tests point to a unit root", () => {
    expect(out.text).toContain("ADF does not reject a unit root; KPSS rejects stationarity. Unit root: both tests agree");
    const read = (out.tables ?? [])[1].rows;
    expect(read.filter((r) => r[3] === "this result")).toHaveLength(1);
    expect(read.find((r) => r[3] === "this result")?.[0]).toBe("Does not reject");
  });
  test("Spread with a constant: stationary, KPSS p > 0.10", () => {
    const o = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { series: "Spread" }));
    expectOk(o);
    const a = FX.adf.find((c: { name: string }) => c.name === "default Spread, constant, AIC");
    expect(o.text).toContain(`τ = ${fmtFixed(a.stat, 3)}`);
    expect(o.text).toContain(`p >${NB}0.10`);
    expect(o.text).toContain("Stationary: both tests agree");
  });
  test("constant + trend and none, fixed lags", () => {
    const ct = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { regression: "ct" }));
    expectOk(ct);
    const a = FX.adf.find((c: { name: string }) => c.name === "default Output, constant + trend, AIC");
    const k = FX.kpss.find((c: { name: string }) => c.name === "default Output, constant + trend, auto");
    expect(ct.text).toContain(`τ = ${fmtFixed(a.stat, 3)}`);
    expect(ct.text).toContain(`η = ${fmtFixed(k.stat, 3)}, p = ${fmtP(k.p)}`);
    const none = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { series: "Spread", regression: "n", kpssMode: "fixed", kpssLags: "4" }));
    expectOk(none);
    const an = FX.adf.find((c: { name: string }) => c.name === "default Spread, none, AIC");
    expect(none.text).toContain(`τ = ${fmtFixed(an.stat, 3)}`);
    expect(none.text).toContain("KPSS has no form without a constant");
    const k4 = FX.kpss.find((c: { name: string }) => c.name === "default Spread, constant, 4 lags");
    expect(none.text).toContain(`η = ${fmtFixed(k4.stat, 3)}`);
    const fixed = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { adfMode: "fixed", adfLag: "3" }));
    expectOk(fixed);
    expect(fixed.text).toContain("lag 3, fixed");
  });
});

describe("ts-hp on the default (Output, quarterly)", () => {
  const out = tsHpCalc(reader(TS_HP_DEFAULTS));
  const fx = FX.hp[0];
  test("ok, λ = 1,600 stated with its source", () => {
    expectOk(out);
    expect(out.text).toContain("λ = 1,600 (Hodrick & Prescott 1997, quarterly)");
  });
  test("trend and cycle cells equal statsmodels' hpfilter at the printed decimals", () => {
    const rows = (out.tables ?? [])[0].rows;
    expect(rows.length - 1).toBe(fx.x.length);
    for (let i = 0; i < fx.x.length; i++) {
      expect(rows[i + 1][2]).toBe(fmtFixed(fx.trend[i], 3));
      expect(rows[i + 1][3]).toBe(fmtFixed(fx.cycle[i], 3));
    }
  });
  test("annual and monthly: common vs Ravn–Uhlig, and custom", () => {
    const annual = [`Year y`, ...FX.hp[1].x.map((v: number, i: number) => `${1980 + i} ${v}`)].join("\n");
    const ru = tsHpCalc(reader(TS_HP_DEFAULTS, { data: annual, series: "", lambdaRule: "ru" }));
    expectOk(ru);
    expect(ru.text).toContain("λ = 6.25 (Ravn & Uhlig 2002, annual");
    const rows = (ru.tables ?? [])[0].rows;
    FX.hp[1].trend.forEach((t: number, i: number) => expect(rows[i + 1][2]).toBe(fmtFixed(t, 3)));
    const std = tsHpCalc(reader(TS_HP_DEFAULTS, { data: annual, series: "", lambdaRule: "standard" }));
    expect(std.text).toContain("λ = 100 ");
    const monthly = [`Month y`, ...FX.hp[3].x.map((v: number, i: number) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")} ${v}`)].join("\n");
    const m = tsHpCalc(reader(TS_HP_DEFAULTS, { data: monthly, series: "", lambdaRule: "ru" }));
    expectOk(m);
    expect(m.text).toContain("λ = 129,600");
    const custom = tsHpCalc(reader(TS_HP_DEFAULTS, { lambdaRule: "custom", lambda: "14,400" }));
    expectOk(custom);
    expect(custom.text).toContain("λ = 14,400 (as entered)");
  });
});

describe("hostile inputs", () => {
  const calcs: [string, (r: (k: string) => string) => StatOutput, Record<string, string>][] = [
    ["ts-acf", tsAcfCalc, TS_ACF_DEFAULTS],
    ["ts-unitroot", tsUnitRootCalc, TS_UNITROOT_DEFAULTS],
    ["ts-hp", tsHpCalc, TS_HP_DEFAULTS],
  ];
  for (const [id, calc, defs] of calcs) {
    test(`${id}: too few rows, constant, gap, empty, missing column`, () => {
      expect(calc(reader(defs, { data: series([1, 2, 3]), series: "" })).ok).toBe(false);
      const c = calc(reader(defs, { data: quarterly(Array(40).fill(7)), series: "", lambdaRule: "standard" }));
      if (id === "ts-hp") {
        // A constant series has a constant trend and a zero cycle: a correct answer, not a refusal.
        expectOk(c);
      } else {
        expect(c.ok).toBe(false);
        expect(c.text).toMatch(/constant/);
      }
      const gap = ["Quarter y", ...Array.from({ length: 30 }, (_, i) => `${2000 + Math.floor((i + (i > 10 ? 1 : 0)) / 4)}-Q${((i + (i > 10 ? 1 : 0)) % 4) + 1} ${Math.sin(i) + i * 0.1}`)].join("\n");
      const g = calc(reader(defs, { data: gap, series: "" }));
      expect(g.ok).toBe(false);
      expect(g.text).toContain("gap");
      expect(calc(reader(defs, { data: "" })).ok).toBe(false);
      expect(calc(reader(defs, { series: "Nope" })).ok).toBe(false);
    });
    test(`${id}: 10⁻¹² and 10¹² scales give the same statistics as the unscaled series`, () => {
      const base = FX.adf.find((c: { name: string }) => c.name === "random walk n 250, constant + trend, fixed lag 3").x.slice(0, 120) as number[];
      const outs = [1, 1e-12, 1e12].map((s) =>
        calc(reader(defs, { data: quarterly(base.map((v) => v * s)), series: "", lambdaRule: "standard", adfMode: "fixed", adfLag: "2" })),
      );
      for (const o of outs) expectOk(o);
      if (id !== "ts-hp") {
        const cells = outs.map((o) => (o.tables ?? [])[0].rows.map((r) => r.slice(2, 5).join("|")).join("\n"));
        expect(cells[1]).toBe(cells[0]);
        expect(cells[2]).toBe(cells[0]);
      } else {
        expect(outs[1].text).toMatch(/×10⁻¹/);
        expect(outs[2].text).toMatch(/×10¹/);
      }
    });
  }
  test("parameter rubbish is refused by name", () => {
    for (const v of ["abc", "−1", "1e400", "2.5", "0"]) {
      const o = tsAcfCalc(reader(TS_ACF_DEFAULTS, { lags: v }));
      expect(o.ok).toBe(false);
      expect(o.text).toContain("Lags");
    }
    expect(tsAcfCalc(reader(TS_ACF_DEFAULTS, { lags: "61" })).text).toContain("n/2 = 60");
    for (const v of ["abc", "−1", "1e400", "2.5", "21"]) expect(tsAcfCalc(reader(TS_ACF_DEFAULTS, { modelDf: v })).ok).toBe(false);
    expect(tsAcfCalc(reader(TS_ACF_DEFAULTS, { modelDf: "" })).ok).not.toBe(false);
    for (const v of ["abc", "−1", "1e400", "2.5", "59"]) {
      const o = tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { adfLag: v }));
      expect(o.ok).toBe(false);
      expect(o.text).toContain("ADF lag");
    }
    expect(tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { adfLag: "58" })).ok).not.toBe(false);
    for (const v of ["abc", "−1", "1e400", "", "120"]) expect(tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { kpssMode: "fixed", kpssLags: v })).ok).toBe(false);
    expect(tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { regression: "ctt" })).ok).toBe(false);
    for (const v of ["abc", "−1", "1e400", "", "0", "1e10"]) {
      const o = tsHpCalc(reader(TS_HP_DEFAULTS, { lambdaRule: "custom", lambda: v }));
      expect(o.ok).toBe(false);
      expect(o.text).toContain("λ");
    }
    expect(tsHpCalc(reader(TS_HP_DEFAULTS, { lambdaRule: "bogus" })).ok).toBe(false);
  });
  test("HP λ by frequency needs periods: undated and daily data are told to choose a custom λ", () => {
    const undated = tsHpCalc(reader(TS_HP_DEFAULTS, { data: series([1, 3, 2, 5, 4, 6, 8, 7]), series: "" }));
    expect(undated.ok).toBe(false);
    expect(undated.text).toContain("Custom λ");
    const daily = ["Date y", ...Array.from({ length: 12 }, (_, i) => `2024-01-${String(i + 2).padStart(2, "0")} ${i % 3}`)].join("\n");
    expect(tsHpCalc(reader(TS_HP_DEFAULTS, { data: daily, series: "" })).text).toContain("days");
    expectOk(tsHpCalc(reader(TS_HP_DEFAULTS, { data: daily, series: "", lambdaRule: "custom", lambda: "50" })));
  });
  test("values that would overflow a square still compute (the engines rescale)", () => {
    const base = FX.acf[1].x as number[];
    const big = tsAcfCalc(reader(TS_ACF_DEFAULTS, { data: series(base.map((v) => v * 1e200)), series: "", lags: "5" }));
    const one = tsAcfCalc(reader(TS_ACF_DEFAULTS, { data: series(base), series: "", lags: "5" }));
    expectOk(big);
    expect((big.tables ?? [])[0].rows).toEqual((one.tables ?? [])[0].rows);
  });
});

describe("100,000 rows", () => {
  const n = 100000;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  let lev = 0;
  const lines = ["y"];
  for (let i = 0; i < n; i++) {
    lev += rnd();
    lines.push(lev.toFixed(4));
  }
  const data = lines.join("\n");
  const timed = (f: () => StatOutput): { out: StatOutput; ms: number } => {
    const t0 = Date.now();
    const out = f();
    return { out, ms: Date.now() - t0 };
  };
  // Measured on the build machine (single jest worker, parsing included): ts-acf 0.23–0.57 s, ts-unitroot 1.0–1.6 s
  // (one Householder QR of the 99,931 × 70 common-sample design, then the refit), ts-hp 0.20–0.28 s.
  // Bounds are ≥ 3× that, since QC runs jest with 4 workers.
  test("ts-acf", () => {
    const r = timed(() => tsAcfCalc(reader(TS_ACF_DEFAULTS, { data, series: "" })));
    expectOk(r.out);
    expect(r.out.text).toContain("lags 1 to 50");
    expect(r.ms).toBeLessThan(3000);
  });
  test("ts-unitroot", () => {
    const r = timed(() => tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { data, series: "" })));
    expectOk(r.out);
    expect(r.out.text).toContain("from 0 to 68");
    expect(r.ms).toBeLessThan(6000);
  }, 20000);
  test("ts-unitroot: a hand-entered lag of 1,000 is refused by its work, before any design is built", () => {
    for (const adfMode of ["aic", "fixed"]) {
      const r = timed(() => tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS, { data, series: "", adfMode, adfLag: "1000" })));
      expect(r.out.ok).toBe(false);
      expect(r.out.text).toMatch(/more work than the pane allows; use a lag of at most \d+/);
      expect(r.ms).toBeLessThan(3000);
    }
  }, 20000);
  test("ts-hp", () => {
    const r = timed(() => tsHpCalc(reader(TS_HP_DEFAULTS, { data, series: "", lambdaRule: "custom", lambda: "1600" })));
    expectOk(r.out);
    expect(r.out.tables ?? []).toHaveLength(0);
    expect(r.out.text).toContain("The figure shows every 50th row.");
    expect(r.ms).toBeLessThan(3000);
  });
});
