/**
 * "Fully inclusive" (2026-10-28) for the Statistics library calculators: causal (causal-rdd, causal-synth,
 * causal-pscore), GMM (econ-gmm, panel-dyn-gmm), limited dependent (econ-count, econ-tobit, econ-heckman,
 * econ-ordered, econ-mlogit), micro/macro (ten), time series (ts-garch, ts-var, ts-var-irf, ts-engle-granger,
 * ts-johansen) and the three pane-inline time-series tools (ts-acf, ts-unitroot, ts-hp; TS_CALCULATORS).
 *
 * Every one: its defaults carry a plain-language reading that keeps lib/calcReading.ts's rules; each wording branch
 * is reached by an input set (fullStatLibCases.ts) and says what that branch must say; every number in a reading is
 * printed in the result's text or tables; the reading changes with the input. The four new figures (econ-tobit,
 * econ-heckman, econ-mlogit coefficient plots; macro-money-multiplier deposit expansion) draw on the defaults, plot
 * the engine's own numbers, pass the figure layout and label audits, and survive hostile inputs.
 */
import * as plot from "../plot";
import type { StatOutput } from "../analyzeBlocks";
import { readingProblems } from "../calcReading";
import { CAUSAL_STAT_CALCS } from "../causalStatCalcs";
import { GMM_STAT_CALCS } from "../gmmStatCalcs";
import { LIMDEP_STAT_CALCS } from "../limdepStatCalcs";
import { MICROMACRO_STAT_CALCS } from "../micromacroStatCalcs";
import { TS2_STAT_CALCS } from "../ts2StatCalcs";
import { TS_CALCULATORS } from "../tsCalcs";
import { coefForestSvg, depositExpansionSvg, FOREST_MAX_PANELS, FOREST_MAX_TERMS } from "../statLibFigures";
import { fitReading, unsigned } from "../statLibReading";
import { CASES } from "./fullStatLibCases";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditSvg } = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (name: string, svg: string) => { found: string[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditLabels } = require("../../../scripts/figure-label-audit.js") as { auditLabels: (svg: string) => Record<string, string[]> };

interface Calc {
  id: string;
  fields: { key: string; default: string }[];
  compute: (r: (k: string) => string) => StatOutput;
}
const ALL: Calc[] = [...CAUSAL_STAT_CALCS, ...GMM_STAT_CALCS, ...LIMDEP_STAT_CALCS, ...MICROMACRO_STAT_CALCS, ...TS2_STAT_CALCS, ...TS_CALCULATORS] as Calc[];
const OWNED = [
  "causal-pscore", "causal-rdd", "causal-synth", "econ-gmm", "panel-dyn-gmm", "econ-count", "econ-heckman", "econ-mlogit", "econ-ordered", "econ-tobit",
  "macro-fiscal-multipliers", "macro-growth-accounting", "macro-money-multiplier", "macro-mundell-fleming", "macro-phillips", "micro-auction", "micro-consumer",
  "micro-cost", "micro-demand", "micro-price-disc", "ts-engle-granger", "ts-garch", "ts-johansen", "ts-var", "ts-var-irf", "ts-acf", "ts-hp", "ts-unitroot",
];

function calc(id: string): Calc {
  const c = ALL.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
}
function run(id: string, over: Record<string, string> = {}): StatOutput {
  const c = calc(id);
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
}

/** Every printed thing a reading's numbers may come from: the text and every table cell and label. */
function hay(o: StatOutput): string {
  return [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n").replace(/ /g, " ");
}
/**
 * The numbers of a reading, as printed (grouping commas, decimals, m×10ⁿ), without a leading sign (a reading may say
 * "lowers … by 2.1793" where the table prints −2.1793). Bare one-digit integers are skipped: they are counts and
 * ordinals ("1 other link", "lag 1") that the substring test cannot tell from any digit in the text.
 */
function numbersOf(reading: string): string[] {
  const out: string[] = [];
  for (const m of reading.replace(/ /g, " ").matchAll(/\d[\d,]*(?:\.\d+)?(?:×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?/g)) {
    const s = m[0].replace(/,$/, "");
    if (/^\d$/.test(s)) continue;
    out.push(s);
  }
  return out;
}

describe("every owned calculator is covered", () => {
  test("the 28 ids exist (25 spread registries + the 3 pane-inline TS tools)", () => {
    for (const id of OWNED) expect(ALL.map((c) => c.id)).toContain(id);
    expect(OWNED.length).toBe(28);
  });
  test("every owned calculator has at least one branch case beyond the defaults or a default case", () => {
    for (const id of OWNED) expect(CASES.some((c) => c.id === id)).toBe(true);
  });
});

describe.each(OWNED)("%s defaults", (id) => {
  const o = run(id);
  test("compute to a result with a reading that keeps the rules", () => {
    expect(o.ok).not.toBe(false);
    expect(readingProblems(o.reading)).toEqual([]);
  });
  test("every number in the reading is printed in the text or tables", () => {
    const h = hay(o);
    for (const n of numbersOf(o.reading ?? "")) expect([id, n, h.includes(n)]).toEqual([id, n, true]);
  });
  test("draw a figure", () => {
    expect(o.svg ?? "").toMatch(/^<svg[\s>]/);
  });
});

describe.each(CASES.map((c) => [`${c.id}: ${c.label}`, c] as const))("%s", (_l, cs) => {
  const o = run(cs.id, cs.over);
  test("computes, and its reading keeps the rules and takes this branch", () => {
    expect(o.ok).not.toBe(false);
    expect(readingProblems(o.reading)).toEqual([]);
    // P_BELOW is "<" + no-break space + "0.001"; the patterns are written with a plain space.
    expect((o.reading ?? "").replace(/ /g, " ")).toMatch(cs.expect);
  });
  test("every number in its reading is printed in the text or tables", () => {
    const h = hay(o);
    for (const n of numbersOf(o.reading ?? "")) expect([n, h.includes(n)]).toEqual([n, true]);
  });
});

test("the reading changes with the input (every owned calculator with two or more cases)", () => {
  for (const id of OWNED) {
    const rs = new Set(CASES.filter((c) => c.id === id).map((c) => run(c.id, c.over).reading));
    if (CASES.filter((c) => c.id === id).length > 1) expect([id, rs.size > 1]).toEqual([id, true]);
  }
});

test("a refusal carries no reading", () => {
  expect(run("econ-tobit", { lower: "", upper: "" }).reading).toBeUndefined();
  expect(run("macro-money-multiplier", { rr: "80", er: "30" }).reading).toBeUndefined();
  expect(run("ts-var", { data: "Year A B\n2001 1 2" }).reading).toBeUndefined();
});

// ---------------------------------------------------------------------------------------------------- figures

const NEW_FIGS = ["econ-tobit", "econ-heckman", "econ-mlogit", "macro-money-multiplier"];

describe.each(NEW_FIGS)("%s figure", (id) => {
  test("drawn on the defaults and clean under the layout and label audits", () => {
    const svg = run(id).svg!;
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(auditSvg(id, svg).found).toEqual([]);
    const lab = auditLabels(svg);
    for (const k of Object.keys(lab)) expect([k, lab[k]]).toEqual([k, []]);
  });
});

/** The series a calculator handed to buildPlotSvg (every call, in order). */
function captured(id: string, over: Record<string, string> = {}): { series: plot.Series[]; options: plot.PlotOptions }[] {
  const spy = jest.spyOn(plot, "buildPlotSvg");
  try {
    run(id, over);
    return spy.mock.calls.map((c) => ({ series: c[0], options: c[1] ?? {} }));
  } finally {
    spy.mockRestore();
  }
}
/** The dots with bars in a coefficient panel. */
const barred = (s: plot.Series[]): plot.Point[] => s.find((x) => x.type === "scatter")!.points;

test("econ-tobit plots the coefficient table's estimates and 95% intervals (constant and σ left out)", () => {
  const o = run("econ-tobit");
  const rows = o.tables![0].rows; // Term | Coefficient | SE | z | p | 95% CI
  const calls = captured("econ-tobit");
  const pts = barred(calls[calls.length - 1].series);
  const terms = rows.slice(1).filter((r) => r[0] !== "Constant" && r[0] !== "/sigma");
  expect(pts.length).toBe(terms.length);
  for (const [j, r] of terms.entries()) {
    expect(pts[j].y.toFixed(4).replace("-", "−")).toBe(r[1]);
    const [lo, hi] = r[5].split(" to ");
    expect((pts[j].y - pts[j].err!).toFixed(4).replace("-", "−")).toBe(lo);
    expect((pts[j].y + pts[j].err!).toFixed(4).replace("-", "−")).toBe(hi);
  }
});

test("econ-heckman plots both equations, λ included in the outcome panel", () => {
  const o = run("econ-heckman");
  const calls = captured("econ-heckman").filter((c) => c.options.errorBars === "ci95");
  expect(calls.length).toBe(2);
  const out = barred(calls[0].series);
  const outRows = o.tables![0].rows.slice(1).filter((r) => r[0] !== "Constant");
  expect(out.map((p) => p.y.toFixed(4))).toEqual(outRows.map((r) => r[1].replace("−", "-")));
  const sel = barred(calls[1].series);
  const selRows = o.tables![1].rows.slice(1).filter((r) => r[0] !== "Constant");
  expect(sel.map((p) => p.y.toFixed(4))).toEqual(selRows.map((r) => r[1].replace("−", "-")));
  expect(calls[0].options.title).toMatch(/Outcome equation: lwage/);
});

test("econ-mlogit draws one panel per outcome against the base, with the coefficient table's numbers", () => {
  const o = run("econ-mlogit");
  const calls = captured("econ-mlogit").filter((c) => c.options.errorBars === "ci95");
  expect(calls.map((c) => c.options.title)).toEqual(["mode = 2 against 1: log odds", "mode = 3 against 1: log odds"]);
  const rows = o.tables![0].rows.slice(1).filter((r) => !r[0].endsWith("Constant"));
  const ys = calls.flatMap((c) => barred(c.series).map((p) => p.y.toFixed(4)));
  expect(ys).toEqual(rows.map((r) => r[1].replace("−", "-")));
});

test("macro-money-multiplier: rounds rise from ΔB to m·ΔB (the deposit table's own recursion)", () => {
  const calls = captured("macro-money-multiplier");
  const s = calls[calls.length - 1].series;
  const limit = s.find((x) => x.label?.startsWith("m·ΔB"))!;
  expect(limit.label).toBe("m·ΔB = 400");
  expect(limit.points[0].y).toBeCloseTo(400, 9);
  const pts = s.find((x) => x.label === "Money created so far")!.points;
  expect(pts[0].y).toBeCloseTo(100, 9); // round 1: the injection itself (deposits 83.3333 + currency 16.6667)
  expect(pts[1].y).toBeCloseTo(100 + 75, 9); // round 2 adds the new loans of round 1 (75)
  expect(Math.abs(400 - pts[pts.length - 1].y)).toBeLessThanOrEqual(4);
  for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThan(pts[i - 1].y);
});

test("macro-money-multiplier with no ΔB draws the expansion of the whole base", () => {
  const calls = captured("macro-money-multiplier", { dB: "" });
  const s = calls[calls.length - 1].series;
  expect(s.find((x) => x.label?.startsWith("m·B"))!.label).toBe("m·B = 4,000");
  expect(calls[calls.length - 1].options.title).toBe("Deposit expansion out of B = 1,000");
});

describe("hostile inputs to the new figures", () => {
  test("money multiplier: a contraction, 100% reserves, a huge currency drain, a tiny base", () => {
    const sets: Record<string, string>[] = [{ dB: "−250" }, { rr: "100" }, { cr: "9000" }, { rr: "0", cr: "1" }, { base: "0.001", dB: "" }, { base: "100000000000000", dB: "" }];
    for (const over of sets) {
      const o = run("macro-money-multiplier", over);
      expect(o.ok).not.toBe(false);
      expect(readingProblems(o.reading)).toEqual([]);
      expect(o.svg ?? "").toMatch(/^<svg[\s>]/);
      expect(auditSvg(JSON.stringify(over), o.svg!).found).toEqual([]);
    }
  });
  test("coefficient plot: nothing drawable, one term, all equal, huge, negative, too many terms and panels", () => {
    expect(coefForestSvg([])).toBeUndefined();
    expect(coefForestSvg([{ title: "t", terms: [] }])).toBeUndefined();
    expect(coefForestSvg([{ title: "t", terms: [{ name: "x", coef: NaN, lo: NaN, hi: NaN }] }])).toBeUndefined();
    const one = coefForestSvg([{ title: "One term", terms: [{ name: "x", coef: 0.5, lo: 0.1, hi: 0.9 }] }])!;
    expect(auditSvg("one", one).found).toEqual([]);
    const flat = coefForestSvg([{ title: "All equal", terms: [1, 2, 3].map((j) => ({ name: `x${j}`, coef: 0, lo: 0, hi: 0 })) }])!;
    expect(flat).toMatch(/^<svg/);
    const huge = coefForestSvg([{ title: "Huge", terms: [{ name: "a", coef: 3e12, lo: 2e12, hi: 4e12 }, { name: "b", coef: -5e11, lo: -9e11, hi: -1e11 }] }])!;
    expect(huge).toMatch(/^<svg/);
    expect(huge).not.toMatch(/\de[+-]?\d/);
    const many = coefForestSvg([{ title: "Many", terms: Array.from({ length: 25 }, (_, j) => ({ name: `a_rather_long_predictor_name_${j}`, coef: j - 12, lo: j - 13, hi: j - 11 })) }])!;
    expect(many).toContain(`${25 - FOREST_MAX_TERMS} more terms in the table, not drawn.`);
    expect(auditSvg("many", many).found).toEqual([]);
    const panels = coefForestSvg(Array.from({ length: FOREST_MAX_PANELS + 2 }, (_, k) => ({ title: `Equation ${k + 1}`, terms: [{ name: "x", coef: k, lo: k - 1, hi: k + 1 }] })))!;
    expect(panels).toContain("2 more equations in the table, not drawn.");
    expect(panels).not.toContain(`Equation ${FOREST_MAX_PANELS + 1}`);
  });
  test("deposit expansion: nothing finite draws nothing", () => {
    expect(depositExpansionSvg({ cumulative: [], limit: 1, limitLabel: "m", title: "t", injectionLabel: "x" })).toBeUndefined();
    expect(depositExpansionSvg({ cumulative: [1], limit: NaN, limitLabel: "m", title: "t", injectionLabel: "x" })).toBeUndefined();
  });
  test("the limited-dependent figures on one predictor and on a constant-only model", () => {
    const one = run("econ-tobit", { spec: "hours ~ educ" });
    expect(one.svg).toMatch(/^<svg/);
    const none = run("econ-tobit", { spec: "hours ~" });
    if (none.ok !== false) {
      expect(readingProblems(none.reading)).toEqual([]);
      expect(none.svg).toBeUndefined();
    }
    const ml = run("econ-mlogit", { spec: "mode ~ income" });
    expect(ml.svg).toMatch(/^<svg/);
  });
});

// ---------------------------------------------------------------------------------------------------- long names

/**
 * Every column of the default table renamed with a long suffix (and every other text field that names a column
 * rewritten to match): the reading must still keep the rules, the 320-character limit included, through
 * fitReading's name-free fallbacks. Date and entity columns keep their names (the readers recognise them by name).
 */
function withLongNames(c: Calc): Record<string, string> | null {
  const data = c.fields.find((f) => f.key === "data");
  if (!data) return null;
  const lines = data.default.split("\n");
  const sep = lines[0].includes("\t") ? "\t" : /\s+/;
  const head = lines[0].split(sep);
  const LONG = "_with_a_very_long_descriptive_suffix_from_a_database_export";
  const keep = /^(Year|Quarter|year|firm|Date|Period|Month)$/;
  const names = head.filter((h) => h && !keep.test(h));
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rename = (s: string): string => {
    let out = s;
    // Longest first, so "Region A" is not caught inside "Region AB".
    for (const nm of [...names].sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(`(?<![\\w.])${esc(nm)}(?![\\w])`, "g"), `${nm.replace(/\s/g, "_")}${LONG}`);
    return out;
  };
  const over: Record<string, string> = { data: [head.map((h) => (keep.test(h) || !h ? h : `${h.replace(/\s/g, "_")}${LONG}`)).join(typeof sep === "string" ? sep : " "), ...lines.slice(1)].join("\n") };
  for (const f of c.fields) if (f.key !== "data" && (f as { kind?: string }).kind !== "select" && f.default) over[f.key] = rename(f.default);
  return over;
}

test("long user column names fall back to a shorter reading that still keeps the rules", () => {
  const checked: string[] = [];
  for (const id of OWNED) {
    const over = withLongNames(calc(id));
    if (!over) continue;
    const o = run(id, over);
    if (o.ok === false) continue;
    checked.push(id);
    expect([id, readingProblems(o.reading)]).toEqual([id, []]);
  }
  // The registries whose readings name columns must all have been exercised (none refused the renamed table).
  for (const id of ["econ-count", "econ-tobit", "econ-heckman", "econ-ordered", "econ-mlogit", "econ-gmm", "causal-synth", "causal-pscore", "causal-rdd", "ts-garch", "ts-var", "ts-var-irf", "ts-engle-granger", "ts-johansen", "ts-acf", "ts-unitroot", "ts-hp"]) {
    expect([id, checked.includes(id)]).toEqual([id, true]);
  }
});

test("helpers: fitReading keeps the first that fits, else the barest; unsigned drops one leading sign", () => {
  expect(fitReading("x".repeat(400) + ".", "Short.")).toBe("Short.");
  expect(fitReading("A.", "B.")).toBe("A.");
  expect(fitReading(undefined, "", "C.")).toBe("C.");
  expect(fitReading()).toBeUndefined();
  expect(unsigned("−2.18")).toBe("2.18");
  expect(unsigned("2.18")).toBe("2.18");
});
