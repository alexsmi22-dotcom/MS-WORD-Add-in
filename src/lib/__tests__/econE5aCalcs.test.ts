/**
 * Release E5a: ineq-gini, conc-hhi, io-leontief, fin-currency.
 * Pinned to scripts/econ-e5a-oracle.py (fixtures/econ-e5a-oracle.json: exact fractions, sympy inverses, mpmath logs)
 * and scripts/iso4217-oracle.py (fixtures/iso4217-list-one.json, read from SIX's list-one.xml), then the display
 * contract, the hostile inputs and the size bounds.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ineqGiniCalc,
  concHhiCalc,
  ioLeontiefCalc,
  finCurrencyCalc,
  INEQ_GINI_DEFAULTS,
  INEQ_GINI_FIELDS,
  CONC_HHI_DEFAULTS,
  CONC_HHI_FIELDS,
  IO_LEONTIEF_DEFAULTS,
  IO_LEONTIEF_FIELDS,
  FIN_CURRENCY_DEFAULTS,
  FIN_CURRENCY_FIELDS,
  INEQ_MAX_ROWS,
  HHI_MAX_FIRMS,
  FX_MAX_RATES,
  FX_MAX_AMOUNTS,
  type FinOutput,
} from "../econE5aCalcs";
import { inequality, exactOf } from "../inequality";
import { leontiefInverse, IO_MAX_N } from "../leontief";
import { ISO4217, ISO4217_DATE, roundUnits, sigText } from "../currency";
import type { StatOutput } from "../analyzeBlocks";
import type { Rat } from "../cas";

const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-e5a-oracle.json"), "utf8"));
const ISO = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "iso4217-list-one.json"), "utf8"));

const reader = (defaults: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => (k in over ? over[k] : defaults[k] ?? "");
const ineqRun = (over: Record<string, string>): StatOutput => ineqGiniCalc(reader(INEQ_GINI_DEFAULTS, over));
const hhiRun = (over: Record<string, string>): StatOutput => concHhiCalc(reader(CONC_HHI_DEFAULTS, over));
const ioRun = (over: Record<string, string>): StatOutput => ioLeontiefCalc(reader(IO_LEONTIEF_DEFAULTS, over));
const fxRun = (over: Record<string, string>): FinOutput => finCurrencyCalc(reader(FIN_CURRENCY_DEFAULTS, over));

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));
const num = (s: string): number => Number(s.replace(/,/g, "").replace(/−/g, "-"));

/** The display contract on an ok result. */
function contract(out: { text: string; ok?: boolean; tables?: { rows: string[][]; align?: string[] }[]; svg?: string }): void {
  expect(out.ok).not.toBe(false);
  const cells = (out.tables ?? []).flatMap((t) => t.rows.flat());
  const all = [out.text, ...cells].join("\n");
  expect(all).not.toMatch(/NaN|Infinity|undefined|null/);
  expect(all).not.toMatch(/\d[eE][+-]?\d/);
  expect(all).not.toMatch(/(^|[\s(=;:])-\d/m);
  expect(all).not.toContain("—");
  // No combining diacritic (a hat over x or theta renders detached in Word): U+0300 to U+036F.
  const combining = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`);
  expect(all).not.toMatch(combining);
  // eslint-disable-next-line no-control-regex
  expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  for (const t of out.tables ?? []) {
    expect(t.align).toBeDefined();
    const w = t.rows[0].length;
    expect(t.align!.length).toBe(w);
    for (const r of t.rows) {
      expect(r.length).toBe(w);
      for (const c of r) expect(c.trim()).not.toBe("");
    }
  }
  if (out.svg) {
    expect(out.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(out.svg.startsWith("<svg")).toBe(true);
  }
}

// =================================================================================================================
describe("ISO 4217 table against SIX list one", () => {
  test("same date, same 178 codes, same numeric codes, minor units, names and fund flags", () => {
    expect(ISO.published).toBe(ISO4217_DATE);
    expect(ISO.count).toBe(178);
    expect(ISO4217.size).toBe(ISO.count);
    for (const [code, rec] of Object.entries(ISO.codes) as [string, { numeric: string; minor: string; name: string; fund: boolean }][]) {
      const mine = ISO4217.get(code);
      expect(mine).toBeDefined();
      expect(mine!.numeric).toBe(rec.numeric);
      expect(mine!.minor === null ? "N.A." : String(mine!.minor)).toBe(rec.minor);
      expect(mine!.name).toBe(rec.name);
      expect(mine!.fund).toBe(rec.fund);
    }
  });
  test("the minor units the brief names (never a default 2)", () => {
    for (const c of ["KRW", "VND", "CLP", "ISK", "JPY"]) expect(ISO4217.get(c)!.minor).toBe(0);
    for (const c of ["BHD", "KWD", "JOD", "OMR", "TND", "IQD", "LYD"]) expect(ISO4217.get(c)!.minor).toBe(3);
    expect(ISO4217.get("CLF")!.minor).toBe(4);
    expect(ISO4217.get("XAU")!.minor).toBeNull();
    expect(ISO4217.has("BTC")).toBe(false);
    expect(ISO4217.has("HRK")).toBe(false);
  });
});

// =================================================================================================================
describe("ineq-gini against the oracle", () => {
  for (const c of ORACLE.ineq) {
    test(c.name, () => {
      const x = c.x.map(Number);
      const w = c.w.map(Number);
      const r = inequality({ x, w, grouped: c.grouped }, c.eps, { x: x.map((v: number) => exactOf(v)!), w: w.map((v: number) => exactOf(v)!) });
      const e = c.expect;
      expect(`${r.giniExact!.n}/${r.giniExact!.d}`).toBe(e.gini);
      expect(rel(r.gini, e.gini_float)).toBeLessThan(1e-12);
      expect(rel(r.mean, e.mean)).toBeLessThan(1e-12);
      if (e.theilT === undefined) expect(r.theilT).toBeUndefined();
      else expect(Math.abs(r.theilT! - e.theilT)).toBeLessThan(1e-12);
      if (e.theilL === undefined) expect(r.theilL).toBeUndefined();
      else expect(Math.abs(r.theilL! - e.theilL)).toBeLessThan(1e-12);
      for (const a of r.atkinson) {
        const want = e.atkinson[String(a.eps)];
        if (want === undefined) expect(a.value).toBeUndefined();
        else expect(Math.abs(a.value! - want)).toBeLessThan(1e-12);
      }
      expect(r.p10).toBe(e.p10);
      expect(r.p90).toBe(e.p90);
      expect(Math.abs(r.bottom40 - e.bottom40)).toBeLessThan(1e-12);
      expect(Math.abs(r.top10 - e.top10)).toBeLessThan(1e-12);
      // Through the calculator from table text.
      const table = c.grouped ? ["Income\tCount", ...x.map((v: number, i: number) => `${c.x[i]}\t${c.w[i]}`)].join("\n") : ["Income", ...c.x].join("\n");
      const userEps = c.eps.length > 3 ? String(c.eps[3]) : "";
      const out = ineqRun({ data: table, layout: c.grouped ? "grouped" : "individual", correction: "nn1", eps: userEps });
      contract(out);
      const rows = out.tables![0].rows;
      const cell = (label: string): string | undefined => rows.find((rr) => rr[0] === label)?.[1];
      expect(num(cell("Gini G")!)).toBeCloseTo(e.gini_float, 4);
      if (e.palma !== undefined) expect(num(cell("Palma ratio")!)).toBeCloseTo(e.palma, 3);
      else expect(cell("Palma ratio")).toBeUndefined();
      if (e.p90p10 !== undefined) expect(num(cell("P90/P10")!)).toBeCloseTo(e.p90p10, 3);
      else expect(cell("P90/P10")).toBeUndefined();
      if (!c.grouped) expect(num(cell("Gini, small-sample")!)).toBeCloseTo(e.gini_nn1, 4);
      const dec = out.tables![1].rows.slice(1).map((rr) => num(rr[1]) / 100);
      dec.forEach((v, k) => expect(v).toBeCloseTo(e.lorenz_deciles[k], 4));
      if (c.grouped) expect(out.text).toContain("LOWER BOUND");
    });
  }

  test("the worked default prints the exact Gini and the definitions", () => {
    const out = ineqRun({});
    contract(out);
    expect(out.text).toContain("Gini G = 0.3913 (exactly 23041/58880)");
    expect(out.text).toContain("Hyndman & Fan (1996) definition 1");
    expect(out.svg).toContain("Line of equality");
    expect(out.svg).toContain("G = 0.3913");
  });

  test("individual data: the Gini is twice the area between the diagonal and the Lorenz polyline", () => {
    const x = [3, 7, 7, 12, 40, 41.5, 90];
    const r = inequality({ x, w: x.map(() => 1), grouped: false }, [0.5]);
    let area = 0;
    for (let k = 1; k < r.lorenz.length; k++) area += ((r.lorenz[k].p - r.lorenz[k - 1].p) * (r.lorenz[k].L + r.lorenz[k - 1].L)) / 2;
    expect(Math.abs(1 - 2 * area - r.gini)).toBeLessThan(1e-14);
  });

  test("zeros: Gini, Theil T, A(0.5) reported; Theil L and A(1), A(2) left out by name", () => {
    const out = ineqRun({ data: "0\n0\n5\n10\n20\n65", eps: "" });
    contract(out);
    expect(out.text).toContain("Theil L is left out: it needs every income positive (2 zero incomes)");
    expect(out.text).toContain("Atkinson for ε = 1 is left out");
    expect(out.text).toContain("Atkinson for ε = 2 is left out");
    expect(out.text).toContain("P90/P10 is left out: P10 is zero");
  });

  test("negative incomes: only Gini, and it is said", () => {
    const out = ineqRun({ data: "−50\n100\n200\n300\n450" });
    contract(out);
    expect(out.text).toContain("Gini G = 0.4800");
    expect(out.text).toContain("Theil T is left out: a negative income has no logarithm");
    expect(out.text).toContain("1 income is negative");
  });

  test("all equal incomes: every measure 0; a single income", () => {
    const out = ineqRun({ data: "500\n500\n500\n500", correction: "nn1" });
    contract(out);
    expect(out.text).toContain("Gini G = 0.0000");
    const one = ineqRun({ data: "500" });
    contract(one);
    expect(one.text).toContain("every inequality measure is 0");
    expect(ineqRun({ data: "500", correction: "nn1" }).ok).toBe(false);
  });

  test("tiny and huge scales give the same scale-free measures", () => {
    const base = ineqRun({ data: "1\n2\n3\n10" });
    const tiny = ineqRun({ data: "1e-9\n2e-9\n3e-9\n1e-8" });
    const huge = ineqRun({ data: "1e14\n2e14\n3e14\n1e15" });
    for (const o of [base, tiny, huge]) contract(o);
    const g = (o: StatOutput): string => o.tables![0].rows.find((r) => r[0] === "Gini G")![1];
    expect(g(tiny)).toBe(g(base));
    expect(g(huge)).toBe(g(base));
  });

  test("grouped: missing cells dropped, zero counts dropped, NA said; decimal commas", () => {
    const out = ineqRun({ data: "Mean;Households\n1000,5;10\n2000;NA\n4000;0\n8000;5", layout: "grouped" });
    contract(out);
    expect(out.text).toContain("1 row with a missing cell was left out");
    expect(out.text).toContain("1 group with a zero count was left out");
    expect(out.text).toContain("decimal commas");
  });

  test("hostile inputs refuse by name", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ data: "" }, /Paste incomes/],
      [{ data: "abc\ndef" }, /no column of numbers|not a finite number/],
      [{ data: "Income\n100\nabc\n300" }, /Row 2: “abc” is not a finite number/],
      [{ data: "1e400\n5" }, /not a finite number|beyond the largest income/],
      [{ data: "2e15\n5" }, /beyond the largest income/],
      [{ data: "0\n0\n0" }, /mean income is zero/],
      [{ data: "−5\n1\n2" }, /mean income is negative/],
      [{ data: "100\n200", eps: "−1" }, /above 0 and at most 20/],
      [{ data: "100\n200", eps: "abc" }, /Atkinson ε: “abc” is not a finite number/],
      [{ data: "100\n200", eps: "25" }, /at most 20/],
      [{ data: "100\n200", layout: "grouped" }, /two columns of numbers/],
      [{ data: "Mean\tCount\n100\t−3\n200\t4", layout: "grouped" }, /negative/],
      [{ data: "100\n200", layout: "weird" }, /Unknown layout/],
      [{ data: "100\n200", correction: "x" }, /Unknown correction/],
      [{ data: "NA\nNA" }, /No incomes were read|no column of numbers/],
    ];
    for (const [over, re] of bad) {
      const out = ineqRun(over);
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(re);
    }
  });

  test("largest input: 200,000 rows (bounded at more than 3× the measured time), one more is refused", () => {
    const xs: string[] = ["Income"];
    let s = 7;
    for (let i = 0; i < INEQ_MAX_ROWS; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      xs.push(String(1000 + (s % 900000)));
    }
    const t0 = Date.now();
    const out = ineqRun({ data: xs.join("\n") });
    const ms = Date.now() - t0;
    contract(out);
    expect(ms).toBeLessThan(6000);
    expect(ineqRun({ data: xs.join("\n") + "\n5" }).ok).toBe(false);
  }, 30000);
});

// =================================================================================================================
describe("conc-hhi against the oracle", () => {
  for (const c of ORACLE.hhi) {
    test(c.name, () => {
      const out = hhiRun({ data: c.table, units: c.units, merging: c.merging, show2010: "yes" });
      contract(out);
      const conc = out.tables!.find((t) => t.label === "Concentration")!.rows;
      const range = (lo: string, hi: string): string => (lo === hi ? lo : `${lo} to ${hi}`);
      expect(conc.find((r) => r[0] === "HHI")!.slice(1)).toEqual([range(c.hhi, c.hhi_hi), range(c.post, c.post_hi)]);
      expect(conc.find((r) => r[0] === "ΔHHI")![2]).toBe(c.delta);
      const g = out.tables!.find((t) => t.label.startsWith("2023 Merger Guidelines"))!.rows;
      const met = (label: string): string => g.find((r) => r[0] === label)![3];
      const tri = (t: string): string => (t === "yes" ? "Yes" : t === "no" ? "No" : "Depends on how the fringe splits");
      expect(met("Post-merger HHI")).toBe(tri(c.highly));
      expect(met("Change in HHI")).toBe(c.sig ? "Yes" : "No");
      expect(met("Presumption: HHI")).toBe(tri(c.pres_hhi));
      expect(met("Presumption: share")).toBe(c.pres_share ? "Yes" : "No");
      expect(g.find((r) => r[0] === "Merged firm's share")![2]).toBe(`${c.merged_share}%`);
      expect(out.text).toContain("not a legal conclusion");
      expect(out.text).toContain("issued December 18, 2023");
      expect(out.text).not.toMatch(/moderately/i);
      expect(out.tables!.some((t) => t.label.includes("2010") && t.label.includes("superseded"))).toBe(true);
    });
  }

  test("the default: presumption by HHI, share 28% below 30%", () => {
    const out = hhiRun({});
    contract(out);
    expect(out.text).toContain("Merger of Cedar + Elm: merged share 28%, ΔHHI = 360, post-merger HHI = 2,312");
    expect(out.text).toContain("the structural presumption threshold is met (post-merger HHI above 1,800 with ΔHHI above 100)");
    expect(out.svg).toContain("Pre-merger");
  });

  test("fringe: the range is printed and the straddling HHI is not classified", () => {
    const out = hhiRun({ data: "North\t30\nSouth\t20\nEast\t10\nWest\t10", merging: "East\nWest" });
    contract(out);
    expect(out.text).toContain("the remaining 30% is treated as an unnamed fringe");
    expect(out.text).toContain("cannot be classified without that split");
  });

  test("no merger: the market band only; one firm is a monopoly at 10,000", () => {
    const out = hhiRun({ merging: "" });
    contract(out);
    expect(out.text).toContain("a highly concentrated market (HHI above 1,800)");
    const mono = hhiRun({ data: "Solo\t100", merging: "" });
    contract(mono);
    expect(mono.text).toContain("HHI = 10,000");
  });

  test("rounding allowance: 99.6% used as typed, said", () => {
    const out = hhiRun({ data: "A\t50\nB\t49.6", merging: "" });
    contract(out);
    expect(out.text).toContain("within 0.5 point of 100%");
  });

  test("hostile inputs refuse by name", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ data: "" }, /Paste the firms/],
      [{ data: "A\t60\nB\t50" }, /more than 100%/],
      [{ data: "A\t50\nB\tabc" }, /“abc” is not a finite number/],
      [{ data: "A\t−5\nB\t50" }, /cannot be negative/],
      [{ data: "A\t1e400\nB\t50" }, /not a finite number/],
      [{ data: "A\t50\nA\t50" }, /listed twice/],
      [{ merging: "Cedar\nNobody" }, /“Nobody” is not in the table/],
      [{ merging: "Cedar" }, /at least two/],
      [{ merging: "Cedar\ncedar" }, /named twice/],
      [{ data: "A\t0\nB\t0", units: "sales" }, /add to zero/],
      [{ data: "A\t50%\nB\t50%", units: "fraction" }, /% signs/],
      [{ units: "bogus" }, /Unknown units/],
      [{ data: "A 1 2\nB 3 4" }, /two numbers at the end of the row/],
      [{ data: "A\t1\t2\nB\t3\t4" }, /more than two cells/],
      [{ data: "Alder 0.28\nBirch 0.72" }, /looks like fractions/],
      [{ data: "A 1e400\nB 50" }, /not a finite number/],
    ];
    for (const [over, re] of bad) {
      const out = hhiRun(over);
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(re);
    }
  });

  test(`largest input: ${HHI_MAX_FIRMS} firms as sales, one more refused`, () => {
    const rows = Array.from({ length: HHI_MAX_FIRMS }, (_, i) => `F${i}\t${(i % 97) + 1}.25`);
    const t0 = Date.now();
    const out = hhiRun({ data: rows.join("\n"), units: "sales", merging: "F1\nF2\nF3" });
    expect(Date.now() - t0).toBeLessThan(6000);
    contract(out);
    expect(hhiRun({ data: [...rows, "Extra\t1"].join("\n"), units: "sales", merging: "" }).ok).toBe(false);
  }, 30000);
});

// =================================================================================================================
describe("io-leontief against the oracle", () => {
  const ratText = (r: Rat): string => (r.d === 1n ? String(r.n) : `${r.n}/${r.d}`);
  for (const c of ORACLE.io) {
    test(c.name, () => {
      const over: Record<string, string> = { matrix: c.matrix, fd: "", emp: "", xout: "", mode: "A" };
      if (c.name === "default 3 sectors") Object.assign(over, { fd: "100, 200, 300", emp: "0.8, 0.5, 1.2" });
      if (c.name.startsWith("productive")) over.fd = "10, 10";
      if (c.name === "transactions table") Object.assign(over, { mode: "Z", xout: "200, 250, 180", emp: "2, 0, 1.5" });
      if (c.name.startsWith("awkward")) over.fd = Array(9).fill("1").join(", ");
      const out = ioRun(over);
      contract(out);
      const L = out.tables![0].rows.slice(1).map((r) => r.slice(1).map(num));
      L.forEach((r, i) => r.forEach((v, j) => expect(Math.abs(v - c.Lf[i][j])).toBeLessThan(0.00005 + 1e-12)));
      const mult = out.tables!.find((t) => t.label === "Multipliers and linkages")!;
      const head = mult.rows[0];
      const col = (name: string): number[] => mult.rows.slice(1).map((r) => num(r[head.indexOf(name)]));
      col("Output multiplier").forEach((v, j) => expect(v).toBeCloseTo(c.output_mult[j], 4));
      col("Backward linkage").forEach((v, j) => expect(v).toBeCloseTo(c.bl[j], 4));
      const flCol = head.find((h) => h.startsWith("Forward linkage"))!;
      col(flCol).forEach((v, j) => expect(v).toBeCloseTo(c.fl_ghosh ? c.fl_ghosh[j] : c.fl_rasmussen[j], 4));
      if (c.emp_effect) {
        col("Employment effect").forEach((v, j) => expect(v).toBeCloseTo(c.emp_effect[j], 4));
        mult.rows.slice(1).forEach((r, j) => {
          const cell = r[head.indexOf("Type I employment multiplier")];
          if (c.emp_type1[j] === null) expect(cell).toContain("not defined");
          else expect(num(cell)).toBeCloseTo(c.emp_type1[j], 4);
        });
      }
      const xs = c.x ?? c.x_from_f;
      if (xs) {
        const ot = out.tables!.find((t) => t.label === "Output for the final demand")!.rows.slice(1);
        ot.forEach((r, i) => expect(num(r[2])).toBeCloseTo(xs[i], 2));
      }
      if (c.n <= 8) {
        // The exact inverse equals sympy's, fraction by fraction.
        const A = c.name === "transactions table" ? null : c.matrix;
        if (A) {
          const lines = A.split("\n").slice(1).map((l: string) => l.split("\t").slice(1).map(Number));
          const ex = lines.map((r: number[]) => r.map((v) => exactOf(v)!));
          const inv = leontiefInverse(lines, ex, "A", Date.now() + 6000);
          expect(inv.ok).toBe(true);
          if (inv.ok) expect(inv.Lexact!.map((r) => r.map(ratText))).toEqual(c.L);
        }
        expect(out.text).toContain("exact fractions");
      } else expect(out.text).toContain("condition number κ₁(I − A)");
      const m = /ρ\(A\) = ([\d.]+)/.exec(out.text);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(c.rho, 4);
    });
  }

  test("the default: key sectors named, exact fraction table, linkage figure", () => {
    const out = ioRun({});
    contract(out);
    expect(out.tables!.some((t) => t.label === "Leontief inverse, exact fractions")).toBe(true);
    expect(out.svg).toContain("Backward linkage (Rasmussen index, 1 = average)");
    expect(out.text).toContain("forward linkage = the same normalisation of the row sums of L (Rasmussen)");
    expect(out.tables!.find((t) => t.label === "Multipliers and linkages")!.rows[0]).toContain("Forward linkage (Rasmussen)");
  });

  test("A = [[0, 1.5], [0.1, 0]] is productive (a column sum above 1) and accepted", () => {
    const out = ioRun({ matrix: "\tP\tQ\nP\t0\t1.5\nQ\t0.1\t0", fd: "", emp: "" });
    contract(out);
    expect(out.tables![1].rows.slice(1)).toEqual([["P", "20/17", "30/17"], ["Q", "2/17", "20/17"]]);
  });

  test("non-productive, singular, negative, x = 0 are refused by name", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ matrix: "\tA\tB\nA\t0.5\t0.6\nB\t0.7\t0.5", fd: "", emp: "" }, /not productive: \(I − A\)⁻¹ has a negative entry/],
      [{ matrix: "\tA\tB\nA\t0.5\t0.5\nB\t0.5\t0.5", fd: "", emp: "" }, /I − A is singular/],
      [{ matrix: "\tA\tB\nA\t0.5\t−0.1\nB\t0.1\t0.2", fd: "", emp: "" }, /negative entry, “−0.1”/],
      [{ matrix: "\tA\tB\nA\t1\t0\nB\t0\t0.2", fd: "", emp: "" }, /singular/],
      [{ mode: "Z", matrix: "\tA\tB\nA\t1\t2\nB\t3\t4", xout: "10, 0", fd: "", emp: "" }, /Total output of “B” is zero/],
      [{ mode: "Z", matrix: "\tA\tB\nA\t1\t2\nB\t3\t4", xout: "", fd: "", emp: "" }, /needs total output x/],
      [{ matrix: "" }, /Paste the n × n table/],
      [{ matrix: "\tA\tB\nA\t0.1\nB\t0.1\t0.2" }, /empty or missing/],
      [{ matrix: "\tA\tB\tC\nA\t0.1\t0.2\t0.1\nB\t0.1\t0.2\t0.1" }, /must be square/],
      [{ matrix: "\tA\tB\nB\t0.1\t0.2\nA\t0.1\t0.2" }, /same sectors in the same order/],
      [{ matrix: "\tA\tB\nA\tabc\t0.2\nB\t0.1\t0.2" }, /“abc”.*not a finite number/],
      [{ matrix: "\tA\tB\nA\t1e400\t0.2\nB\t0.1\t0.2" }, /not a finite number/],
      [{ fd: "1, 2" }, /Final demand f has 2 values; the table has 3 sectors/],
      [{ fd: "1, abc, 3" }, /Final demand f:/],
      [{ emp: "−1, 2, 3" }, /cannot be negative/],
      [{ mode: "Q" }, /Unknown table type/],
    ];
    for (const [over, re] of bad) {
      const out = ioRun(over);
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(re);
    }
  });

  test("a reducible productive A (zeros below the diagonal) passes the float sign test", () => {
    const n = 12;
    const rows = ["\t" + Array.from({ length: n }, (_, j) => `S${j + 1}`).join("\t")];
    for (let i = 0; i < n; i++) rows.push(`S${i + 1}\t` + Array.from({ length: n }, (_, j) => (j >= i ? "0.07" : "0")).join("\t"));
    const out = ioRun({ matrix: rows.join("\n"), fd: "", emp: "" });
    contract(out);
  });

  test(`largest input: n = ${IO_MAX_N} (float path), n = ${IO_MAX_N + 1} refused`, () => {
    const mk = (n: number): string => {
      const rows = ["\t" + Array.from({ length: n }, (_, j) => `S${j + 1}`).join("\t")];
      for (let i = 0; i < n; i++) rows.push(`S${i + 1}\t` + Array.from({ length: n }, (_, j) => (((i * 7 + j * 3) % 10) / (n * 12)).toFixed(6)).join("\t"));
      return rows.join("\n");
    };
    const t0 = Date.now();
    const out = ioRun({ matrix: mk(IO_MAX_N), fd: Array(IO_MAX_N).fill("1").join(", "), emp: Array(IO_MAX_N).fill("0.5").join(", ") });
    expect(Date.now() - t0).toBeLessThan(6000);
    contract(out);
    const big = ioRun({ matrix: mk(IO_MAX_N + 1), fd: "", emp: "" });
    expect(big.ok).toBe(false);
    expect(big.text).toContain(`at most ${IO_MAX_N}`);
  }, 30000);
});

// =================================================================================================================
describe("fin-currency against the oracle", () => {
  for (const c of ORACLE.fx) {
    test(c.name, () => {
      const out = fxRun({ base: c.base, rates: c.rates, amounts: c.amounts, target: c.target, asof: "2026-10-01" });
      contract(out);
      const conv = out.tables!.find((t) => t.label.startsWith("Conversions"))!.rows.slice(1).map((r) => r[2]);
      expect(conv).toEqual(c.converted);
      expect(out.text).toContain("as of 2026-10-01");
      expect(out.text).toContain(`the list dated ${ISO4217_DATE}`);
    });
  }

  test("the default: cross rates, the matrix and the rates printed back", () => {
    const out = fxRun({});
    contract(out);
    expect(out.text).toContain("rates as typed, no date given");
    expect(out.text).toContain("980.50 GBP = 1,149.12 EUR (1 GBP = 1.17197 EUR)");
    const rates = out.tables!.find((t) => t.label.startsWith("Rates as read"))!.rows;
    expect(rates[2][0]).toBe("1 USD = 0.92 EUR");
    expect(out.tables!.some((t) => t.label === "Cross-rate matrix")).toBe(true);
  });

  test("half away from zero at the minor unit, exactly", () => {
    expect(roundUnits({ n: 5n, d: 2n }, 0)).toBe(3n);
    expect(roundUnits({ n: -5n, d: 2n }, 0)).toBe(-3n);
    expect(roundUnits({ n: 1005n, d: 1000n }, 2)).toBe(101n);
    expect(sigText({ n: 1n, d: 1478n })).toBe("0.00067659"); // 0.000676590|0 → trailing zero dropped
    expect(sigText({ n: 1n, d: 1477n })).toBe("0.000677048");
    expect(sigText({ n: 123456789n, d: 1n })).toBe("123,457,000");
    expect(sigText({ n: 999999n, d: 1n })).toBe("999,999");
    expect(sigText({ n: 9999995n, d: 1n })).toBe("10,000,000");
    expect(sigText({ n: 100n, d: 92n })).toBe("1.08696");
  });

  test("N.A. minor unit: shown to 6 decimals and said", () => {
    const out = fxRun({ rates: "XAU 0.000417", amounts: "1000 USD", target: "XAU" });
    contract(out);
    expect(out.text).toContain("ISO 4217 gives no minor unit for XAU (N.A.)");
    expect(out.text).toContain("1,000.00 USD = 0.417000 XAU");
  });

  test("hostile inputs refuse by name", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ target: "BTC" }, /BTC is not in ISO 4217 .*the list dated 2026-09-17/],
      [{ base: "" }, /type an ISO 4217 code/],
      [{ base: "US" }, /not a three-letter/],
      [{ target: "XXX" }, /no currency is involved/],
      [{ target: "XTS", rates: "XTS 1" }, /reserved for testing/],
      [{ amounts: "100 CHF" }, /no rate for CHF/],
      [{ target: "CHF" }, /no rate for the target currency CHF/],
      [{ rates: "EUR 0" }, /must be positive/],
      [{ rates: "EUR −0.9" }, /must be positive/],
      [{ rates: "EUR abc" }, /“abc” is not a finite number/],
      [{ rates: "EUR 1e400" }, /not a finite number/],
      [{ rates: "EUR 0.9\nEUR 0.91" }, /two rate lines/],
      [{ rates: "USD 1.1\nEUR 0.9" }, /base currency, so its rate is 1/],
      [{ rates: "" }, /Type the rates/],
      [{ amounts: "lots EUR" }, /“lots” is not a finite number/],
      [{ amounts: "1e400 EUR" }, /not a finite number/],
      [{ amounts: "2e15 EUR" }, /beyond the largest amount/],
      [{ amounts: "100" }, /write the amount then the code/],
      [{ amounts: "100 HRK" }, /HRK is not in ISO 4217/],
    ];
    for (const [over, re] of bad) {
      const out = fxRun(over);
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(re);
    }
  });

  test("decimal commas, lower-case codes, code-first amounts, a header line", () => {
    const out = fxRun({ rates: "Currency Rate\neur 0,92", amounts: "EUR 1.234,50", target: "usd" });
    contract(out);
    expect(out.text).toContain("1,234.50 EUR = 1,341.85 USD");
    expect(out.text).toContain("decimal commas");
  });

  test(`largest input: ${FX_MAX_RATES} rates × ${FX_MAX_AMOUNTS} amounts; one more of each refused`, () => {
    const codes = [...ISO4217.keys()].filter((c) => !["USD", "XXX", "XTS"].includes(c)).slice(0, FX_MAX_RATES);
    const rates = codes.map((c, i) => `${c} ${(0.5 + i * 0.37).toFixed(4)}`).join("\n");
    const amounts = Array.from({ length: FX_MAX_AMOUNTS }, (_, i) => `${(i * 13.37 + 1).toFixed(2)} ${codes[i % codes.length]}`).join("\n");
    const t0 = Date.now();
    const out = fxRun({ rates, amounts, target: codes[0] });
    expect(Date.now() - t0).toBeLessThan(6000);
    contract(out);
    const extraCode = [...ISO4217.keys()].filter((c) => !["USD", "XXX", "XTS"].includes(c))[FX_MAX_RATES];
    expect(fxRun({ rates: `${rates}\n${extraCode} 2`, amounts: "", target: codes[0] }).ok).toBe(false);
    expect(fxRun({ rates, amounts: `${amounts}\n1 ${codes[0]}`, target: codes[0] }).ok).toBe(false);
  }, 30000);
});

describe("review round: readers, scales, bounds", () => {
  test("ineq: a one-column paste with decimal commas is read whole (G = 8/27, not 4/9)", () => {
    for (const data of ["0,5\n1,5\n2,5", "Income\n0,5\n1,5\n2,5", "Household income\n0,5\n1,5\n2,5"]) {
      const out = ineqRun({ data });
      contract(out);
      expect(out.text).toContain("Gini G = 0.2963 (exactly 8/27)");
      expect(out.text).toContain("decimal commas");
    }
    // Thousands commas stay thousands: 1,500, 2,500, 3,000 → G = 6000/(2·9·2333.33…) = 1/7.
    expect(ineqRun({ data: "1,500\n2,500\n3,000" }).text).toContain("Gini G = 0.1429 (exactly 1/7)");
  });

  test("ineq: a tiny user ε prints without e-notation", () => {
    const out = ineqRun({ eps: "0.0000001" });
    contract(out);
    expect(out.text).toContain("A(1×10⁻⁷)");
  });

  test("hhi: space-separated rows split at the last space (decimal commas, names with spaces)", () => {
    const a = hhiRun({ data: "Alder 28,5\nBirch 71,5", merging: "" });
    contract(a);
    expect(a.text).toContain("HHI = 5,924.5");
    const b = hhiRun({ data: "Firm Share\nAcme Corp 28\nBeta Holdings Ltd 72", merging: "Acme Corp\nBeta Holdings Ltd" });
    contract(b);
    expect(b.text).toContain("Merger of Acme Corp + Beta Holdings Ltd: merged share 100%, ΔHHI = 4,032");
    const csv = hhiRun({ data: "Firm, Share\nAlder, 60\nBirch, 40", merging: "" });
    contract(csv);
    expect(csv.text).toContain("HHI = 5,200");
  });

  test("hhi: huge sales and tiny shares give exact shares", () => {
    const huge = hhiRun({ data: "A\t3e14\nB\t1e14", units: "sales", merging: "A\nB" });
    contract(huge);
    expect(huge.text).toContain("HHI = 6,250");
    expect(huge.text).toContain("ΔHHI = 3,750");
    const tiny = hhiRun({ data: "A\t0.0000003\nB\t0.0000001", units: "sales", merging: "" });
    contract(tiny);
    expect(tiny.text).toContain("HHI = 6,250");
  });

  test("io: numeric sector codes are refused with a hint; extreme scales", () => {
    const codes = ioRun({ matrix: "\t11\t21\n11\t0.1\t0.2\n21\t0.3\t0.1", fd: "", emp: "" });
    expect(codes.ok).toBe(false);
    expect(codes.text).toContain("names sectors with numbers (“11”)");
    // A header-less labelled table is still read.
    const bare = ioRun({ matrix: "A 0.1 0.2\nB 0.3 0.1", fd: "", emp: "" });
    contract(bare);
    // 15-digit entries near 10⁻²⁹⁵: too long for the exact path, answered in floating point in milliseconds.
    const big = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => `${(1.23456789012345 + i * 0.1 + j * 0.01).toFixed(14)}e-${290 + ((i + j) % 9)}`));
    const m = "\t" + big.map((_, j) => "S" + j).join("\t") + "\n" + big.map((r, i) => "S" + i + "\t" + r.join("\t")).join("\n");
    const t0 = Date.now();
    const tiny = ioRun({ matrix: m, fd: "", emp: "" });
    expect(Date.now() - t0).toBeLessThan(6000);
    contract(tiny);
    expect(tiny.text).toContain("more than 40 digits as a fraction");
    // Flows of 10¹¹ against outputs of 10¹³ (transactions table, two exact inverses).
    const zb = big.map((r) => r.map((v) => v.replace(/e-\d+$/, "e11")));
    const mz = "\t" + big.map((_, j) => "S" + j).join("\t") + "\n" + zb.map((r, i) => "S" + i + "\t" + r.join("\t")).join("\n");
    const huge = ioRun({ mode: "Z", matrix: mz, xout: Array(8).fill("98765432109876.5").join(", "), fd: "", emp: "" });
    contract(huge);
    expect(huge.text).toContain("exact fractions");
  });

  test("fx: rate and converted-amount bounds refuse by name; tiny rates work", () => {
    const r1 = fxRun({ rates: "EUR 1e300" });
    expect(r1.ok).toBe(false);
    expect(r1.text).toContain("outside the range accepted (10⁻⁹ to 10⁹");
    const r2 = fxRun({ rates: "EUR 1e-12" });
    expect(r2.ok).toBe(false);
    const r3 = fxRun({ rates: "IRR 900000000", amounts: "9e14 USD", target: "IRR" });
    expect(r3.ok).toBe(false);
    expect(r3.text).toContain("beyond the largest converted amount");
    const ok = fxRun({ rates: "XAU 0.000000002\nEUR 0.92", amounts: "0.000001 EUR", target: "EUR" });
    contract(ok);
    const huge = fxRun({ rates: "VND 999999999", amounts: "999999999 USD", target: "VND" });
    contract(huge);
    // 999,999,999 shown to 6 significant digits.
    expect(huge.text).toContain("1 USD = 1,000,000,000 VND");
    expect(huge.text).toContain("999,999,999.00 USD = 999,999,998,000,000,001 VND");
  });
});

describe("field declarations", () => {
  test("every field has a default, every select default is an option", () => {
    const sets: [typeof INEQ_GINI_FIELDS, Record<string, string>][] = [
      [INEQ_GINI_FIELDS, INEQ_GINI_DEFAULTS],
      [CONC_HHI_FIELDS, CONC_HHI_DEFAULTS],
      [IO_LEONTIEF_FIELDS, IO_LEONTIEF_DEFAULTS],
      [FIN_CURRENCY_FIELDS, FIN_CURRENCY_DEFAULTS],
    ];
    for (const [fields, defs] of sets) {
      for (const f of fields) {
        expect(f.key in defs).toBe(true);
        if (f.kind === "select") expect(f.options!.some((o) => o.value === defs[f.key])).toBe(true);
      }
    }
  });
});
