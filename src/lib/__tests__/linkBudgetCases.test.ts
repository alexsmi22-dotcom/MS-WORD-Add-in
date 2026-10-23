// Release E3-c: link budget and noise cascade. The FIXED CASE TABLE from the brief (oracle ~/jurislab-relE/oracle_e3.py)
// is pinned twice: on the engine (linkBudget.ts) and through the pane's own registry (LINK_BUDGET_CALCS compute →
// named outputs), because an engine-only pass proves nothing about whether the pane reaches it. Later fix rounds keep
// every row (cumulative gate).
//
// Further reference values, Python venv C:\Users\AlexanderSmith\jurislab-oracle-venv (scipy):
//   from scipy.special import erfc; from scipy.optimize import brentq; import math
//   c = 299792458; k = 1.380649e-23; db = lambda x: 10**(x/10)
//   erfc(1.0) = 0.15729920705028516; erfc(2.4) = 0.0006885138966450789; erfc(3.5) = 7.430983723414129e-07
//   erfc(6.0) = 2.1519736712498913e-17; erfc(10.0) = 2.0884875837625446e-45
//   20*math.log10(4*math.pi*50/(c/5.8e9))                                   -> 81.69574317986249
//   1000*10**((20+12-20*math.log10(4*math.pi*1000/(c/2.4e9))+90)/20)          -> 12514.099311259319   (range at −90 dBm)
//   10*math.log10(k*290/1e-3)                                               -> -173.97518719422808
//   F = db(3)+(db(1)-1)/db(-3)+(db(7)-1)/(db(-3)*db(20)); 10*log10(F), 290*(F-1) -> 4.136239065229756, 461.66080442436856
//   kTB(1 MHz) + NF(brief chain) + 10                                       -> -102.35747082328247 (sensitivity, 10 dB SNR)
//   0.5*erfc(1.0) (BPSK at 0 dB)                                            -> 0.07864960352514258
//   brentq(lambda d: 0.5*erfc(math.sqrt(10**(d/10))) - t, -5, 20, xtol=1e-14): t=1e-5 -> 9.587858346847607,
//                                                                            t=1e-9 -> 12.549549799787652
//   0.5*math.exp(-10) (DBPSK at 10 dB)                                       -> 2.2699964881242427e-05
//   10*math.log10(-math.log(2e-6)) (DBPSK required for 1e-6)                -> 11.180120598361942
//   mpsk_approx(M, d) = 2*Q(sqrt(2*k*g)*sin(pi/M))/k, Q(x) = 0.5*erfc(x/sqrt(2)):
//     8-PSK at 12 dB -> 6.337878823300311e-05; 16-PSK at 16 dB -> 0.00012460002527155565;
//     8-PSK required for 1e-6 (brentq) -> 13.949556574663333
//
// M-PSK approximation, checked against a Gray-coded Monte Carlo simulation (numpy, seed 1, 2×10⁶ symbols per point):
//   def mpsk_sim(M, ebn0_db, nsym):
//       k = int(log2(M)); n0 = 1/(k*10**(ebn0_db/10)); sym = rng.integers(0, M, nsym)
//       r = exp(1j*2*pi*sym/M) + sqrt(n0/2)*(randn + 1j*randn)
//       det = mod(round(angle(r)/(2*pi/M)), M); gray = i ^ (i >> 1); count differing Gray bits / (nsym*k)
//   8-PSK  4, 8, 10, 12 dB: approx/sim = 0.9963, 1.0041, 0.9914, 1.0141  (Pb 4.6×10⁻² … 6.3×10⁻⁵)
//   16-PSK 4, 8, 10, 12, 14 dB: 0.9663, 0.9999, 1.0009, 0.9993, 1.0056  (Pb 9.9×10⁻² … 1.4×10⁻³)
//   DBPSK 2, 6, 8 dB: sim 1.0250e-01, 9.3910e-03, 9.2500e-04 vs ½exp(−γ) 1.0248e-01, 9.3328e-03, 9.0940e-04

import {
  berAt,
  berLinear,
  cn0FromEbn0,
  ebn0FromCn0,
  erfc,
  fspl,
  kTBdBm,
  KT0_DBM_HZ,
  linkBudget,
  noiseCascade,
  requiredEbN0,
  sensitivity,
  MAX_STAGES,
  type LinkInput,
} from "../linkBudget";
import { LINK_BUDGET_CALCS, readBer } from "../linkBudgetCalcs";
import { berWaterfallSvg, cascadeNfSvg, linkRangeSvg } from "../linkBudgetCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = LINK_BUDGET_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key} in: ${o.text}`);
  return v.value;
};

const BASE: LinkInput = { ptDbm: 20, gtDbi: 6, grDbi: 6, fHz: 2.4e9, dM: 1000, txLossDb: 0, rxLossDb: 0, otherLossDb: 0, sensDbm: null };

// ---------------------------------------------------------------------------------------------------------------
// The fixed case table (brief E3-c)
// ---------------------------------------------------------------------------------------------------------------

describe("E3-c fixed case table: engine", () => {
  test.each([
    ["2.4 GHz, 1 km → FSPL 100.052 dB", () => (fspl(2.4e9, 1000) as { db: number }).db, 100.052, 1e-3],
    ["Pt 20 dBm, Gt 6 dBi, Gr 6 dBi → Pr −68.052 dBm", () => (linkBudget(BASE) as { prDbm: number }).prDbm, -68.052, 1e-3],
    ["kTB at 290 K, 1 MHz → −113.975 dBm", () => kTBdBm(290, 1e6), -113.975, 1e-3],
    ["stages (20, 1.5), (10, 6), (3, 10) → NF 1.61772 dB", () => (noiseCascade([{ gainDb: 20, nfDb: 1.5 }, { gainDb: 10, nfDb: 6 }, { gainDb: 3, nfDb: 10 }]) as { nfDb: number }).nfDb, 1.61772, 1e-5],
    ["same stages → Te 130.891 K", () => (noiseCascade([{ gainDb: 20, nfDb: 1.5 }, { gainDb: 10, nfDb: 6 }, { gainDb: 3, nfDb: 10 }]) as { teK: number }).teK, 130.891, 1e-3],
    ["BPSK at Eb/N0 9.6 dB → BER 9.73618×10⁻⁶", () => (berAt("bpsk", 9.6) as { ber: number }).ber, 9.73618e-6, 1e-11],
  ])("%s", (_name, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
});

describe("E3-c fixed case table: through LINK_BUDGET_CALCS (the pane's objects)", () => {
  test.each([
    ["FSPL 100.052 dB", () => out(run("rf-link-budget", { sens: "" }), "fspl"), 100.052, 1e-3],
    ["Pr −68.052 dBm", () => out(run("rf-link-budget", { sens: "" }), "pr"), -68.052, 1e-3],
    ["kTB −113.975 dBm", () => out(run("noise-figure-cascade"), "ktb"), -113.975, 1e-3],
    ["cascade NF 1.61772 dB", () => out(run("noise-figure-cascade"), "nf"), 1.61772, 1e-5],
    ["cascade Te 130.891 K", () => out(run("noise-figure-cascade"), "te"), 130.891, 1e-3],
    ["BPSK 9.6 dB → 9.73618×10⁻⁶", () => out(run("ber-ebn0"), "ber"), 9.73618e-6, 1e-11],
  ])("%s", (_name, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
  test("the defaults are the case rows (frequency 2.4 GHz, 1 km, 20 dBm, 6 dBi, 6 dBi; the brief's chain; BPSK 9.6 dB)", () => {
    expect(run("rf-link-budget").ok).not.toBe(false);
    expect(run("noise-figure-cascade").text).toMatch(/1\.61772 dB/);
    expect(run("ber-ebn0").text).toMatch(/9\.73618×10⁻⁶/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Further oracle rows
// ---------------------------------------------------------------------------------------------------------------

describe("oracle rows (scipy)", () => {
  test.each([
    [1.0, 0.15729920705028516],
    [2.4, 0.0006885138966450789],
    [3.5, 7.430983723414129e-7],
    [6.0, 2.1519736712498913e-17],
    [10.0, 2.0884875837625446e-45],
  ])("erfc(%p) to 1e-12 relative (1 − erf below 2.5, where erfc ≥ 4×10⁻⁴; the continued fraction in the tail)", (x, want) => {
    expect(rel(erfc(x), want)).toBeLessThan(1e-12);
  });
  test("FSPL 5.8 GHz 50 m, the margin and the free-space range at −90 dBm", () => {
    expect(rel((fspl(5.8e9, 50) as { db: number }).db, 81.69574317986249)).toBeLessThan(1e-12);
    const r = linkBudget({ ...BASE, sensDbm: -90 });
    if (!r.ok) throw new Error(r.error);
    expect(r.marginDb as number).toBeCloseTo(21.947991943884503, 10);
    expect(rel(r.maxRangeM as number, 12514.099311259319)).toBeLessThan(1e-10);
    expect(rel(out(run("rf-link-budget"), "range"), 12514.099311259319)).toBeLessThan(1e-10);
  });
  test("kT₀ = −173.975 dBm/Hz and the sensitivity of the brief's chain at 10 dB SNR", () => {
    expect(KT0_DBM_HZ).toBeCloseTo(-173.97518719422808, 10);
    expect(out(run("noise-figure-cascade"), "sens")).toBeCloseTo(-102.35747082328247, 9);
  });
  test("a lossy first stage (cable −3/3, LNA 20/1, mixer −7/7): NF 4.13624 dB, Te 461.661 K", () => {
    const c = noiseCascade([{ gainDb: -3, nfDb: 3 }, { gainDb: 20, nfDb: 1 }, { gainDb: -7, nfDb: 7 }]);
    if (!c.ok) throw new Error(c.error);
    expect(c.nfDb).toBeCloseTo(4.136239065229756, 10);
    expect(c.teK).toBeCloseTo(461.66080442436856, 8);
  });
  test.each([
    ["bpsk", 0, 0.07864960352514258],
    ["qpsk", 9.6, 9.736176018578607e-6],
    ["dbpsk", 10, 2.2699964881242427e-5],
    ["8psk", 12, 6.337878823300311e-5],
    ["16psk", 16, 0.00012460002527155565],
  ] as const)("%s BER at %p dB", (mod, e, want) => {
    expect(rel((berAt(mod, e) as { ber: number }).ber, want)).toBeLessThan(1e-12);
  });
  test.each([
    ["bpsk", 1e-5, 9.587858346847607],
    ["bpsk", 1e-9, 12.549549799787652],
    ["dbpsk", 1e-6, 11.180120598361942],
    ["8psk", 1e-6, 13.949556574663333],
  ] as const)("%s required Eb/N₀ for %p", (mod, t, want) => {
    const q = requiredEbN0(mod, t);
    if (!q.ok) throw new Error(q.error);
    expect(Math.abs(q.ebn0Db - want)).toBeLessThan(1e-9);
    expect(q.iterations).toBeLessThanOrEqual(200);
  });
  test("C/N₀ ↔ Eb/N₀ ↔ data rate: 70 dB-Hz at 1 Mbit/s is 10 dB, and back", () => {
    expect(ebn0FromCn0(70, 1e6)).toBeCloseTo(10, 12);
    expect(cn0FromEbn0(10, 1e6)).toBeCloseTo(70, 12);
    const o = run("ber-ebn0", { mode: "cn0", cn0: "70 dB-Hz", rate: "1 Mbps" });
    expect(out(o, "ebn0")).toBeCloseTo(10, 12);
    expect(out(o, "ber")).toBeCloseTo(0.5 * erfc(Math.sqrt(10)), 18);
  });
  test("the required-Eb/N₀ mode reports the C/N₀ it needs at the rate", () => {
    const o = run("ber-ebn0", { mode: "target", target: "1e-5", rate: "64 kbps" });
    expect(out(o, "ebn0")).toBeCloseTo(9.587858346847607, 9);
    expect(out(o, "cn0")).toBeCloseTo(9.587858346847607 + 10 * Math.log10(64000), 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Units, refusals, adversarial input
// ---------------------------------------------------------------------------------------------------------------

describe("units through the unit layer; decibels by their own field unit", () => {
  test("5.8 GHz and 164.042 ft convert; 0.1 W is 20 dBm; 10 dBW is 40 dBm", () => {
    const a = run("rf-link-budget", { f: "5800 MHz", d: "164.042 ft", pt: "0.1 W", sens: "" });
    expect(out(a, "fspl")).toBeCloseTo(81.6957, 3);
    expect(out(a, "eirp")).toBeCloseTo(26, 10);
    expect(a.text).toMatch(/0\.1 W = 20\.00 dBm/);
    expect(out(run("rf-link-budget", { pt: "10 dBW" }), "eirp")).toBeCloseTo(46, 10);
    expect(out(run("rf-link-budget", { pt: "100 mW" }), "eirp")).toBeCloseTo(26, 10);
  });
  test("bandwidth and data rate convert (1000 kHz, 1 Mbit/s)", () => {
    expect(out(run("noise-figure-cascade", { bw: "1000 kHz" }), "ktb")).toBeCloseTo(-113.975187, 5);
    expect(out(run("ber-ebn0", { rate: "1000 kbps" }), "cn0")).toBeCloseTo(69.6, 10);
  });
  test("readBer reads 1e-6, 10^-6, 1×10⁻⁶ and 0.000001 alike", () => {
    for (const s of ["1e-6", "10^-6", "1×10⁻⁶", "0.000001", "10⁻⁶"]) expect(readBer(s)).toBeCloseTo(1e-6, 20);
    expect(readBer("abc")).toBeNaN();
  });
});

describe("named refusals", () => {
  test.each([
    ["rf-link-budget", { d: "5 kg" }, /not compatible with m/],
    ["rf-link-budget", { f: "2.4 GHz", d: "5 cm" }, /less than two wavelengths/],
    ["rf-link-budget", { f: "0" }, /frequency must be greater than zero/],
    ["rf-link-budget", { d: "-1 km" }, /distance must be greater than zero/],
    ["rf-link-budget", { gt: "6 dBd" }, /half-wave dipole.*dBi/],
    ["rf-link-budget", { pt: "20 dB" }, /"dB" is not accepted here/],
    ["rf-link-budget", { pt: "-5 W" }, /greater than zero/],
    ["rf-link-budget", { ltx: "-2" }, /must be zero or more/],
    ["rf-link-budget", { gr: "" }, /required/],
    ["rf-link-budget", { pt: "1e400" }, /not a finite number/],
    ["rf-link-budget", { gt: "500" }, /beyond ±400 dB/],
    ["rf-link-budget", { d: "1e400 m" }, /finite/],
    ["noise-figure-cascade", { stages: "20 -1" }, /below 0 dB.*not physical/],
    ["noise-figure-cascade", { stages: "20 abc" }, /mixes words and numbers/],
    ["noise-figure-cascade", { stages: "20 1.5 7" }, /exactly 2 numbers/],
    ["noise-figure-cascade", { stages: "" }, /nothing to read/],
    ["noise-figure-cascade", { stages: Array.from({ length: MAX_STAGES + 1 }, () => "10 2").join("\n") }, /./],
    ["noise-figure-cascade", { bw: "1 m" }, /not compatible with Hz/],
    ["noise-figure-cascade", { bw: "0 Hz" }, /bandwidth must be greater than zero/],
    ["noise-figure-cascade", { bw: "100 THz" }, /10 THz/],
    ["ber-ebn0", { mod: "8psk", ebn0: "0" }, /above 10⁻¹.*not checked/],
    ["ber-ebn0", { mode: "target", target: "0.6" }, /must be below/],
    ["ber-ebn0", { mode: "target", mod: "16psk", target: "0.2" }, /checked only for Pb ≤ 10⁻¹/],
    ["ber-ebn0", { mode: "target", target: "1e-20" }, /at least 10⁻¹⁵/],
    ["ber-ebn0", { mode: "target", target: "0" }, /greater than zero/],
    ["ber-ebn0", { mode: "target", target: "lots" }, /not a number/],
    ["ber-ebn0", { ebn0: "NaN" }, /does not start with a number/],
    ["ber-ebn0", { ebn0: "45" }, /from −10 dB to 40 dB/],
    ["ber-ebn0", { ebn0: "9.6 dBm" }, /not accepted here/],
    ["ber-ebn0", { mode: "cn0", rate: "" }, /needed to go from C\/N₀/],
    ["ber-ebn0", { rate: "5 kg" }, /not compatible|not a unit/],
    ["ber-ebn0", { mod: "64qam" }, /Choose a modulation/],
  ] as const)("%s %j", (id, over, re) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
  });
  test("more than 50 stages is refused by the row cap", () => {
    const o = run("noise-figure-cascade", { stages: Array.from({ length: MAX_STAGES + 1 }, () => "10 2").join("\n") });
    expect(o.ok).toBe(false);
  });
  test("engine refusals are sentences", () => {
    expect(noiseCascade([])).toEqual({ ok: false, error: expect.stringMatching(/at least one stage/) });
    expect(sensitivity(1, NaN, 0)).toEqual({ ok: false, error: expect.stringMatching(/finite/) });
    expect(fspl(Infinity, 1)).toEqual({ ok: false, error: expect.stringMatching(/finite/) });
    expect(berAt("bpsk", Infinity)).toEqual({ ok: false, error: expect.stringMatching(/finite/) });
  });
  test("a link that does not close says so (negative margin), and still reports the free-space range", () => {
    const o = run("rf-link-budget", { d: "100 km", sens: "-80" });
    expect(o.ok).not.toBe(false);
    expect(out(o, "margin")).toBeLessThan(0);
    expect(o.text).toMatch(/does not close/);
  });
  test("huge and tiny magnitudes stay finite and typeset: 300 GHz over 40 000 km; 1 MHz over 300 m", () => {
    for (const over of [{ f: "300 GHz", d: "40000 km" }, { f: "1 MHz", d: "700 m" }]) {
      const o = run("rf-link-budget", over);
      expect(o.ok).not.toBe(false);
      expect(o.outputs!.every((x) => Number.isFinite(x.value))).toBe(true);
    }
  });
  test("BER far below double precision's reach is stated, never NaN", () => {
    const o = run("ber-ebn0", { ebn0: "30" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/below 10⁻³⁰⁰|far below/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Display contract, formulas, tables and figures
// ---------------------------------------------------------------------------------------------------------------

const OK_RUNS: Array<[string, Record<string, string>]> = [
  ["rf-link-budget", {}],
  ["rf-link-budget", { sens: "", ltx: "1.5", lrx: "2", lother: "3" }],
  ["rf-link-budget", { d: "100 km", sens: "-80" }],
  ["noise-figure-cascade", {}],
  ["noise-figure-cascade", { stages: "-0.5 0.5\n18 0.9\n-3 3\n-6 6\n25 4\n10 8\n-8 8\n30 12\n12 10\n-2 2\n20 15\n15 18\n40 20\n6 25", snr: "" }],
  ["noise-figure-cascade", { stages: "0 0" }],
  ["ber-ebn0", {}],
  ["ber-ebn0", { mod: "dbpsk", mode: "cn0", cn0: "68", rate: "64 kbps" }],
  ["ber-ebn0", { mod: "8psk", mode: "target", target: "1e-6" }],
  ["ber-ebn0", { mod: "16psk", ebn0: "16" }],
  ["ber-ebn0", { mod: "qpsk", ebn0: "30" }],
  ["ber-ebn0", { mode: "target", target: "1e-15" }],
];

describe("display contract on every ok result", () => {
  test.each(OK_RUNS)("%s %j", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    const t = o.text;
    expect(t).not.toMatch(/NaN|Infinity|undefined|\u2014/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/\^/);
    expect(t).not.toMatch(/(^|[\s(=:,])-\d/m);
    expect(o.outputs!.length).toBeGreaterThan(0);
    for (const x of o.outputs!) expect(Number.isFinite(x.value)).toBe(true);
    const blocks = o.blocks ?? [];
    expect(blocks.some((b) => b.kind === "plot")).toBe(true);
    for (const b of blocks) {
      if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
      if (b.kind === "plot") {
        expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(b.svg).toMatch(/Arial|sans-serif/);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
      if (b.kind === "table") {
        expect(b.rows[0].length).toBeGreaterThan(1);
        for (const row of b.rows) for (const cell of row) expect(cell).not.toMatch(/NaN|\d[eE][+-]?\d|(^|\s)-\d/);
      }
    }
  });
  test("the link budget and the cascade insert a real table with units in the header", () => {
    const lb = run("rf-link-budget").blocks!.find((b) => b.kind === "table");
    expect(lb && lb.kind === "table" && lb.rows[0]).toEqual(["Line item", "Value (dB)", "Unit"]);
    const nc = run("noise-figure-cascade").blocks!.find((b) => b.kind === "table");
    expect(nc && nc.kind === "table" && nc.rows.length).toBe(4);
  });
  test("every calculator declares unitContract converts and reads its fields through parseMeasured", () => {
    for (const c of LINK_BUDGET_CALCS) expect(c.unitContract).toBe("converts");
    expect(LINK_BUDGET_CALCS.map((c) => c.id)).toEqual(["rf-link-budget", "noise-figure-cascade", "ber-ebn0"]);
  });
});

describe("figure builders at their edges", () => {
  test("range chart without a sensitivity, BER chart with no point, cascade with one stage", () => {
    for (const svg of [
      linkRangeSvg(BASE, -68.05, null),
      berWaterfallSvg("dbpsk", null, null),
      berWaterfallSvg("8psk", { ebn0Db: 12, ber: berLinear("8psk", Math.pow(10, 1.2)) }, 1e-4),
      cascadeNfSvg([{ n: 1, gainDb: 10, nfDb: 2, teK: 170, cumGainDb: 10, cumNfDb: 2, term: 1.58 }]),
    ]) {
      expect(svg).toMatch(/^<svg/);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
  test("a BER point below 10⁻¹⁵ is named in a note under the axis, not drawn off it", () => {
    const svg = berWaterfallSvg("dbpsk", { ebn0Db: 19.9, ber: 7.6e-44 }, null);
    expect(svg).toMatch(/lies below the axis/);
  });
});

describe("work is bounded", () => {
  test("the required-Eb/N₀ search takes at most 200 halvings at either end of the range", () => {
    for (const t of [1e-15, 0.3]) {
      const q = requiredEbN0("bpsk", t);
      if (!q.ok) throw new Error(q.error);
      expect(q.iterations).toBeLessThanOrEqual(200);
    }
  });
  test("50 stages compute and draw", () => {
    const o = run("noise-figure-cascade", { stages: Array.from({ length: MAX_STAGES }, (_, i) => `${10 - (i % 3) * 7} ${1 + (i % 5)}`).join("\n") });
    expect(o.ok).not.toBe(false);
  });
});
