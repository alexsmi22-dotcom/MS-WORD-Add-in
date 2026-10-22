// Titration, acid–base equilibria and cyclic voltammetry: the engines (titration.ts, the CV half of electrochem.ts)
// and the five calculator objects the pane registers (titrationCalcs.ts), driven exactly as the pane drives them.
//
// EXTERNAL ORACLE. Values marked "scipy" come from an independent implementation of the same charge balance in
// Python, solved with scipy.optimize.brentq (xtol 1e-14) — written from the textbook fraction polynomial, not from
// the TypeScript:
//
//   def fracs(h, pkas):          # fractions of H_kA, k = 0..n protons
//       n = len(pkas); Ka = [10**-p for p in pkas]
//       terms = [h**k * prod(Ka[:n-k]) for k in range(n+1)]; s = sum(terms)
//       return [t/s for t in terms]
//   def solve(C, pkas, m, Cb, Ca, kw=1e-14):
//       F = lambda ph: (h:=10**-ph) - kw/h + Cb - Ca + (C*(sum(k*f for k,f in enumerate(fracs(h,pkas))) - m) if pkas else 0)
//       return brentq(F, -4, 18, xtol=1e-14, rtol=1e-15)
//   titration of an acid: solve(C0*V0/Vt, pkas, n, Ct*V/Vt, 0); of a base: solve(C0*V0/Vt, pkas, 0, 0, Ct*V/Vt)
//
// The CV peak oracle is the same convolution algorithm in numpy (shifted Grünwald–Letnikov, 4000 steps), which gave
// π^½χ_max = 0.44629 at E − E½ = −28.4 mV (0.2 mV grid), against the literature 0.4463 and −28.5 mV (Nicholson–Shain).
// Randles–Ševčík: 0.4463·F·√(F/RT) at 298.15 K = 268 648.445 (numpy), the "2.69×10⁵" of the textbooks.

import {
  fractions,
  solvePH,
  bufferCapacity,
  titrate,
  titrationPH,
  titrationSlope,
  equivalenceVolumes,
  measuredEndpoints,
  speciesLabel,
  pKbToPKa,
  type TitrationSpec,
} from "../titration";
import { randlesSevcik, rsConstant, diffusionFromSlope, randlesSevcikAnalysis, simulateReversibleCv, reversiblePeaks, FARADAY, R_GAS_EC } from "../electrochem";
import { TITRATION_CALCS, CHEM_ENG_GROUP, r2Text, readTable } from "../titrationCalcs";

const spec = (kind: TitrationSpec["kind"], pKa: number[], C0 = 0.1, V0 = 25, Ct = 0.1): TitrationSpec => ({ kind, pKa, C0, V0, Ct, Kw: 1e-14 });
const ph = (t: TitrationSpec, V: number): number => titrationPH(t, V) as number;

describe("titration engine against scipy brentq", () => {
  test("strong acid 0.1 M vs strong base: pH 1, 1.477, 7.00 at equivalence, 11.959", () => {
    const t = spec("strong-acid", []);
    expect(ph(t, 0)).toBeCloseTo(1.0, 9);
    expect(ph(t, 12.5)).toBeCloseTo(1.4771212547, 9);
    expect(ph(t, 25)).toBeCloseTo(7.0, 9);
    expect(ph(t, 30)).toBeCloseTo(11.9586073149, 9);
  });
  test("acetic acid pKa 4.76, 0.1 M: start 2.8829, half-equivalence 4.7605 (not exactly pKa), equivalence 8.7295", () => {
    const t = spec("weak-acid", [4.76]);
    expect(ph(t, 0)).toBeCloseTo(2.8828625361, 9);
    expect(ph(t, 12.5)).toBeCloseTo(4.760452344, 9);
    expect(ph(t, 25)).toBeCloseTo(8.7295371776, 9);
    expect(ph(t, 30)).toBeCloseTo(11.9586074523, 9);
  });
  test("acetic acid at 1 mM: half-equivalence pH 4.8012, 0.04 above pKa (the shortcut fails when dilute)", () => {
    const t = spec("weak-acid", [4.76], 0.001, 25, 0.001);
    expect(ph(t, 12.5)).toBeCloseTo(4.8012127126, 9);
  });
  test("phosphoric acid pKa 2.15, 7.20, 12.35: the three-step curve", () => {
    const t = spec("weak-acid", [2.15, 7.2, 12.35]);
    const want: Array<[number, number]> = [
      [0, 1.632606649],
      [12.5, 2.2859685002],
      [25, 4.7039153189],
      [37.5, 7.1999982455],
      [50, 9.6629528462],
      [62.5, 11.8619652412],
      [75, 12.1754717982],
      [80, 12.2545452551],
    ];
    for (const [V, p] of want) expect(ph(t, V)).toBeCloseTo(p, 8);
    expect(equivalenceVolumes(t)).toEqual([25, 50, 75]);
  });
  test("ammonia (pKa of NH₄⁺ 9.25) titrated with HCl", () => {
    const t = spec("weak-base", [9.25]);
    expect(ph(t, 0)).toBeCloseTo(11.1221043177, 9);
    expect(ph(t, 12.5)).toBeCloseTo(9.2495371301, 9);
    expect(ph(t, 25)).toBeCloseTo(5.2754607983, 9);
    expect(ph(t, 30)).toBeCloseTo(2.0413925508, 9);
  });
  test("solutions: acetate buffer 0.1/0.1 4.76015, sodium acetate 8.8800, acetic acid 2.8829", () => {
    expect(solvePH({ weak: { pKa: [4.76], C: 0.2, m: 1 }, Ca: 0, Cb: 0.1, Kw: 1e-14 })).toBeCloseTo(4.760150886, 9);
    expect(solvePH({ weak: { pKa: [4.76], C: 0.1, m: 1 }, Ca: 0, Cb: 0.1, Kw: 1e-14 })).toBeCloseTo(8.8800212646, 9);
    expect(solvePH({ weak: { pKa: [4.76], C: 0.1, m: 1 }, Ca: 0, Cb: 0, Kw: 1e-14 })).toBeCloseTo(2.8828625361, 9);
    expect(solvePH({ weak: null, Ca: 0, Cb: 0, Kw: 1e-14 })).toBeCloseTo(7, 10);
  });
  test("buffer capacity: analytic β matches scipy's numeric dCb/dpH (0.115169 M per pH)", () => {
    expect(bufferCapacity({ weak: { pKa: [4.76], C: 0.2, m: 1 }, Ca: 0, Cb: 0.1, Kw: 1e-14 }, 4.76)).toBeCloseTo(0.11516927031753, 10);
  });
  test("phosphoric fractions at pH 7.20 (scipy)", () => {
    const f = fractions([2.15, 7.2, 12.35], 7.2);
    [3.539701e-6, 0.49999600204, 0.49999600204, 4.456219e-6].forEach((x, k) => expect(f[k]).toBeCloseTo(x, 10));
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
  });
  test("exact dpH/dV equals a central difference of the exact pH (acid and base)", () => {
    for (const t of [spec("weak-acid", [4.76]), spec("weak-base", [9.25]), spec("weak-acid", [2.15, 7.2, 12.35]), spec("strong-acid", [])]) {
      for (const V of [3, 20, 31]) {
        const h = 1e-4;
        const num = (ph(t, V + h) - ph(t, V - h)) / (2 * h);
        expect(titrationSlope(t, V, ph(t, V))).toBeCloseTo(num, 5);
      }
    }
  });
  test("titrate: breaks, inflections and half-equivalence points", () => {
    const r = titrate(spec("weak-acid", [2.15, 7.2, 12.35]));
    if (typeof r === "string") throw new Error(r);
    expect(r.breaks.map((b) => b.Veq)).toEqual([25, 50, 75]);
    expect(r.breaks[0].inflection).not.toBeNull();
    expect(r.breaks[1].inflection).not.toBeNull();
    // pKa₃ 12.35 is too close to pKw for a break: said, not drawn.
    expect(r.breaks[2].inflection).toBeNull();
    expect(r.halves.map((h) => h.pKa)).toEqual([2.15, 7.2, 12.35]);
    expect(r.halves[2].pH).toBeCloseTo(11.8619652412, 8);
    const s = titrate(spec("strong-acid", []));
    if (typeof s === "string") throw new Error(s);
    expect(s.breaks[0].inflection!.V).toBeCloseTo(25, 5);
    // The curve carries the exact peak (≈ 4343 pH/mL), not a grid-sampled fraction of it.
    expect(Math.max(...s.curve.map((p) => p.slope))).toBeGreaterThan(4000);
    const b = titrate(spec("weak-base", [9.25]));
    if (typeof b === "string") throw new Error(b);
    expect(b.breaks[0].inflection!.slope).toBeLessThan(0);
    expect(b.halves[0].pKa).toBe(9.25);
  });
  test("a diprotic base takes its most basic site first (half-equivalence 1 ≈ the larger pKa)", () => {
    const r = titrate(spec("weak-base", [6.85, 9.93]));
    if (typeof r === "string") throw new Error(r);
    expect(r.halves.map((h) => h.pKa)).toEqual([9.93, 6.85]);
    expect(Math.abs(r.halves[0].pH - 9.93)).toBeLessThan(0.1);
  });
  test("pKb to pKa: pKw − pKb, ascending", () => {
    expect(pKbToPKa([4.75], 14)).toEqual([9.25]);
    expect(pKbToPKa([4.07, 7.15], 14).map((x) => +x.toFixed(2))).toEqual([6.85, 9.93]);
  });
  test("species labels", () => {
    expect([3, 2, 1, 0].map((k) => speciesLabel(k, 3, false))).toEqual(["H₃A", "H₂A⁻", "HA²⁻", "A³⁻"]);
    expect([0, 1, 2].map((k) => speciesLabel(k, 2, true))).toEqual(["B", "BH⁺", "BH₂²⁺"]);
    expect(speciesLabel(1, 1, false)).toBe("HA");
  });
});

describe("titration engine: adversarial", () => {
  test("refusals instead of numbers", () => {
    expect(typeof titrate(spec("weak-acid", [4.76], 0))).toBe("string");
    expect(typeof titrate(spec("weak-acid", [4.76], NaN))).toBe("string");
    expect(typeof titrate(spec("weak-acid", [4.76], 0.1, Infinity))).toBe("string");
    expect(typeof titrate(spec("weak-acid", [7.2, 2.15]))).toBe("string");
    expect(typeof titrate(spec("weak-acid", [1, 2, 3, 4, 5]))).toBe("string");
    expect(typeof titrate(spec("weak-acid", [20]))).toBe("string");
    expect(typeof titrate(spec("weak-acid", []))).toBe("string");
    expect(typeof titrate(spec("strong-acid", [], 25))).toBe("string");
    expect(typeof titrationPH(spec("strong-acid", []), -1)).toBe("string");
    expect(typeof titrate(spec("strong-acid", []), 1e9)).toBe("string");
  });
  test("extreme but legal magnitudes stay finite and inside the bracket", () => {
    for (const [C0, Ct] of [[1e-9, 1e-9], [20, 20], [1e-7, 10], [15, 1e-6]]) {
      const r = titrate(spec("weak-acid", [-1.5, 15.5], C0, 1, Ct));
      if (typeof r === "string") throw new Error(r);
      for (const p of r.curve) {
        expect(Number.isFinite(p.pH)).toBe(true);
        expect(Number.isFinite(p.slope)).toBe(true);
        expect(p.pH).toBeGreaterThan(-4);
        expect(p.pH).toBeLessThan(18);
      }
    }
    // A trace of strong acid in water: pH just under 7, not 9 (the naive −log C answer).
    expect(solvePH({ weak: null, Ca: 1e-9, Cb: 0, Kw: 1e-14 })).toBeCloseTo(6.99782, 4);
  });
  test("pH rises monotonically along an acid titration", () => {
    const r = titrate(spec("weak-acid", [2.15, 7.2, 12.35]));
    if (typeof r === "string") throw new Error(r);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i].pH).toBeGreaterThanOrEqual(r.curve[i - 1].pH - 1e-9);
  });
  test("measured endpoints: derivative maximum and second-derivative zero", () => {
    const data: Array<[number, number]> = [];
    const t = spec("weak-acid", [4.76]);
    for (let V = 0; V <= 40; V += 1) data.push([V, ph(t, V)]);
    const e = measuredEndpoints(data);
    if (typeof e === "string") throw new Error(e);
    expect(e[0].Vfirst).toBeCloseTo(24.5, 6); // the steepest 1 mL interval is 24–25 or 25–26
    expect(e[0].Vsecond!).toBeGreaterThan(24.5);
    expect(e[0].Vsecond!).toBeLessThan(25.5);
    expect(typeof measuredEndpoints(data.slice(0, 3))).toBe("string");
    expect(typeof measuredEndpoints([[0, 3], [1, 3], [1, 4], [2, 5], [3, 6]])).toBe("string");
    expect(typeof measuredEndpoints([[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]])).toBe("string");
  });
});

describe("cyclic voltammetry", () => {
  test("Randles–Ševčík: constant 2.6865×10⁵ at 25 °C and ip = 16.558 µA for the default cell (numpy)", () => {
    expect(rsConstant(25)).toBeCloseTo(268648.4453190526, 3);
    expect(randlesSevcik(1, 0.0707, 1e-6, 7.6e-6, 0.1, 25)).toBeCloseTo(1.655810154221879e-5, 15);
    // n^{3/2} scaling and the inverse
    expect(randlesSevcik(2, 1, 1e-6, 1e-5, 0.1, 25) / randlesSevcik(1, 1, 1e-6, 1e-5, 0.1, 25)).toBeCloseTo(2 ** 1.5, 12);
    const b = randlesSevcik(1, 0.0707, 1e-6, 7.6e-6, 1, 25);
    expect(diffusionFromSlope(b, 1, 0.0707, 1e-6, 25)).toBeCloseTo(7.6e-6, 15);
    expect(FARADAY).toBe(96485.33212);
    expect(R_GAS_EC).toBe(8.314462618);
  });
  test("reversible peak positions: ΔEp 56.986 mV, |Ep − E½| 28.493 mV at 25 °C, n = 1", () => {
    const p = reversiblePeaks(1, 25);
    expect(p.deltaEp * 1000).toBeCloseTo(56.98614049147307, 9);
    expect(p.epOffset * 1000).toBeCloseTo(28.493070245736536, 9);
  });
  test("simulated voltammogram reproduces Nicholson–Shain: peak 0.4463 (±0.1 %) at E½ − 28.5 mV, ΔEp ≈ 57 mV", () => {
    for (const steps of [1000, 2000]) {
      const s = simulateReversibleCv({ n: 1, E0: 0, Estart: 0.4, Eswitch: -0.4, v: 0.1, D: 7.6e-6, A: 0.0707, C: 1e-6, tC: 25, steps });
      if (typeof s === "string") throw new Error(s);
      const ip = randlesSevcik(1, 0.0707, 1e-6, 7.6e-6, 0.1, 25);
      expect(Math.abs(s.forward.i / -ip - 1)).toBeLessThan(1e-3);
      expect(Math.abs(s.forward.E * 1000 + 28.5)).toBeLessThan(0.9);
      expect(Math.abs((s.reverse.E - s.forward.E) * 1000 - 57.2)).toBeLessThan(1.2);
      expect(s.reverse.i).toBeGreaterThan(0);
    }
  });
  test("oxidation-first and n = 2: anodic peak positive at E½ + 14.2 mV, peak ∝ n^{3/2}", () => {
    const s = simulateReversibleCv({ n: 2, E0: 0.2, Estart: -0.2, Eswitch: 0.6, v: 0.05, D: 1e-5, A: 0.1, C: 2e-6, tC: 25 });
    if (typeof s === "string") throw new Error(s);
    expect(s.forward.i).toBeGreaterThan(0);
    expect(s.forward.i / randlesSevcik(2, 0.1, 2e-6, 1e-5, 0.05, 25)).toBeCloseTo(1, 3);
    expect((s.forward.E - 0.2) * 1000).toBeCloseTo(14.25, 0);
  });
  test("simulation refusals", () => {
    const base = { n: 1, E0: 0, Estart: 0.4, Eswitch: -0.4, v: 0.1, D: 1e-5, A: 0.07, C: 1e-6, tC: 25 };
    expect(typeof simulateReversibleCv({ ...base, Estart: 0.05 })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, Eswitch: -0.05 })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, n: 1.5 })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, v: 0 })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, D: NaN })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, Eswitch: 0.4 })).toBe("string");
    expect(typeof simulateReversibleCv({ ...base, Eswitch: -10 })).toBe("string");
    // An absurd step count is capped, not obeyed.
    const s = simulateReversibleCv({ ...base, steps: 1e9 });
    if (typeof s === "string") throw new Error(s);
    expect(s.E.length).toBe(4001);
  });
  test("Randles–Ševčík analysis backs out D; flags adsorption and a large intercept", () => {
    const D = 7.6e-6;
    const rates = [0.01, 0.025, 0.05, 0.1, 0.2, 0.4];
    const exact = rates.map((v) => [v, randlesSevcik(1, 0.0707, 1e-6, D, v, 25)] as [number, number]);
    const r = randlesSevcikAnalysis(exact, 1, 0.0707, 1e-6, 25);
    if (typeof r === "string") throw new Error(r);
    expect(r.D).toBeCloseTo(D, 15);
    expect(r.intercept).toBeCloseTo(0, 15);
    expect(r.logSlope).toBeCloseTo(0.5, 12);
    expect(r.flags).toEqual([]);
    const ads = randlesSevcikAnalysis(rates.map((v) => [v, 1e-4 * v] as [number, number]), 1, 0.0707, 1e-6, 25);
    if (typeof ads === "string") throw new Error(ads);
    expect(ads.logSlope).toBeCloseTo(1, 12);
    expect(ads.flags.join(" ")).toMatch(/adsorption/);
    const off = randlesSevcikAnalysis(exact.map(([v, i]) => [v, i + 5e-6] as [number, number]), 1, 0.0707, 1e-6, 25);
    if (typeof off === "string") throw new Error(off);
    expect(off.flags.join(" ")).toMatch(/intercept/);
    expect(typeof randlesSevcikAnalysis(exact.slice(0, 2), 1, 0.0707, 1e-6, 25)).toBe("string");
    expect(typeof randlesSevcikAnalysis([[0.1, 1e-6], [0.1, 2e-6], [0.1, 3e-6]], 1, 0.0707, 1e-6, 25)).toBe("string");
    expect(typeof randlesSevcikAnalysis([[0.1, 1e-6], [0.2, -2e-6], [0.3, 3e-6]], 1, 0.0707, 1e-6, 25)).toBe("string");
    expect(typeof randlesSevcikAnalysis([[0.1, 1e-6], [-0.2, 2e-6], [0.3, 3e-6]], 1, 0.0707, 1e-6, 25)).toBe("string");
  });
});

// ------------------------------------------------------------------ the calculators

const byId = (id: string) => TITRATION_CALCS.find((c) => c.id === id)!;
const run = (id: string, over: Record<string, string> = {}) => {
  const c = byId(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};

/** The display contract, as the pane's insert gate and the house rules read it. */
function contractViolations(text: string): string[] {
  const bad: string[] = [];
  if (/—/.test(text)) bad.push("em dash");
  if (/\^/.test(text)) bad.push("caret");
  if (/\d[eE][+-]?\d/.test(text)) bad.push("e-notation");
  if (/NaN|Infinity|undefined|not finite/.test(text)) bad.push("non-finite");
  if (/(^|[\s(=:,])-\d/m.test(text)) bad.push("hyphen-minus");
  return bad;
}

describe("TITRATION_CALCS (the pane objects)", () => {
  test("five calculators, one new group, unique ids, the EngCalc shape", () => {
    expect(TITRATION_CALCS.map((c) => c.id)).toEqual(["chem-titration", "chem-speciation", "chem-solution-ph", "chem-cv-peak", "chem-cv-randles"]);
    for (const c of TITRATION_CALCS) {
      expect(c.group).toBe(CHEM_ENG_GROUP);
      expect(c.name.length).toBeGreaterThan(5);
      expect(c.hint.length).toBeGreaterThan(40);
      expect(c.fields.length).toBeGreaterThan(0);
      for (const f of c.fields) {
        expect(["block", "text", "select"]).toContain(f.kind);
        if (f.kind === "select") expect(f.options!.map((o) => o.value)).toContain(f.default);
      }
      expect(contractViolations(c.hint)).toEqual([]);
    }
    expect(CHEM_ENG_GROUP).toBe("Chemistry & electrochemistry");
  });

  test.each(TITRATION_CALCS.map((c) => c.id))("%s at its defaults computes, draws and keeps the display contract", (id) => {
    const o = run(id);
    expect(o.ok).not.toBe(false);
    expect(contractViolations(o.text)).toEqual([]);
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThanOrEqual(1);
    for (const p of plots) {
      if (p.kind !== "plot") continue;
      expect(p.svg.startsWith("<svg")).toBe(true);
      expect(p.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(p.w).toBeGreaterThan(100);
      expect(p.h).toBeGreaterThan(100);
      expect(contractViolations(p.caption)).toEqual([]);
    }
  });

  test("every declared field key is read by its compute", () => {
    for (const c of TITRATION_CALCS) {
      const read = new Set<string>();
      const vals = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      c.compute((k) => {
        read.add(k);
        return vals[k] ?? "";
      });
      for (const f of c.fields) expect([c.id, f.key, read.has(f.key)]).toEqual([c.id, f.key, true]);
    }
  });

  test("titration: numbers in the text match the engine; phosphoric acid reports the missing third break", () => {
    const o = run("chem-titration");
    expect(o.text).toMatch(/pH at the start: 2\.88\./);
    expect(o.text).toMatch(/Half-equivalence, 12\.5 mL: pH 4\.76/);
    expect(o.text).toMatch(/Equivalence point, 25 mL: pH 8\.73/);
    expect(o.text).toMatch(/At 20 mL of titrant: pH 5\.36\./);
    const p = run("chem-titration", { pk: "2.15, 7.20, 12.35" });
    expect(p.text).toMatch(/Equivalence volumes: 25 mL, 50 mL, 75 mL\./);
    expect(p.text).toMatch(/Equivalence point 3, 75 mL: pH 12\.18; no clear break/);
    const s = run("chem-titration", { kind: "strong-acid", vat: "" });
    expect(s.text).toMatch(/Equivalence point, 25 mL: pH 7\.00/);
    expect(s.text).toMatch(/Half-equivalence, 12\.5 mL: pH 1\.48\./); // scipy 1.4771212547
  });

  test("titration: units convert and are reported; wrong units and typos are refused", () => {
    const o = run("chem-titration", { c0: "100 mM", v0: "0.025 L", ct: "100 mmol/L" });
    expect(o.text).toMatch(/pH at the start: 2\.88\./);
    expect(o.text).toMatch(/Units read: .*100 mM = 0\.1 M/);
    expect(run("chem-titration", { v0: "25 M" }).ok).toBe(false);
    expect(run("chem-titration", { c0: "0.1 mm" }).ok).toBe(false);
    expect(run("chem-titration", { c0: "" }).ok).toBe(false);
    expect(run("chem-titration", { c0: "abc" }).ok).toBe(false);
    expect(run("chem-titration", { pk: "7.2, 2.15" }).ok).toBe(false);
    expect(run("chem-titration", { pk: "4.76, x" }).ok).toBe(false);
    expect(run("chem-titration", { pk: "1, 2, 3, 4, 5" }).ok).toBe(false);
    expect(run("chem-titration", { pkw: "7" }).ok).toBe(false);
    expect(run("chem-titration", { pktype: "pkb" }).ok).toBe(false);
    expect(run("chem-titration", { kind: "bogus" }).ok).toBe(false);
    expect(run("chem-titration", { vmax: "1 mL" }).ok).toBe(false);
    for (const bad of ["1e400 M", "-0.1 M", "Infinity"]) expect(run("chem-titration", { c0: bad }).ok).toBe(false);
  });

  test("titration: a weak base from pKb, and a true minus in a negative-pKa line", () => {
    const o = run("chem-titration", { kind: "weak-base", pktype: "pkb", pk: "4.75", vat: "" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/pKa 9\.25 of the conjugate acid/);
    expect(o.text).toMatch(/Equivalence point, 25 mL: pH 5\.28/);
    const n = run("chem-speciation", { pk: "-1.5, 4" });
    expect(n.text).toMatch(/−1\.50/);
    expect(contractViolations(n.text)).toEqual([]);
  });

  test("titration with measured data: endpoints located; a bad row refused by name", () => {
    const rows = Array.from({ length: 41 }, (_, V) => `${V}\t${ph(spec("weak-acid", [4.76]), V).toFixed(3)}`).join("\n");
    const o = run("chem-titration", { data: "mL\tpH\n" + rows });
    expect(o.text).toMatch(/Measured endpoint: 24\.5 mL from the first-derivative maximum/);
    expect(run("chem-titration", { data: "0 3\n1 x" }).ok).toBe(false);
    expect(run("chem-titration", { data: "3 0\n4 25\n5 26" }).ok).toBe(false);
    expect(run("chem-titration", { data: "0 3\n0 4\n1 5\n2 6\n3 7" }).text).toMatch(/must increase/);
  });

  test("speciation: fractions at the pH, the dominant form, and a base system", () => {
    const o = run("chem-speciation");
    expect(o.text).toMatch(/H₂A⁻ 38\.7 %, HA²⁻ 61\.3 %/);
    expect(o.text).toMatch(/Dominant form: HA²⁻\./);
    const b = run("chem-speciation", { sys: "base", pk: "9.25", ph: "9.25" });
    expect(b.text).toMatch(/BH⁺ 50 %, B 50 %/);
    expect(run("chem-speciation", { ph: "abc" }).ok).toBe(false);
    expect(run("chem-speciation", { pk: "" }).ok).toBe(false);
    expect(run("chem-speciation", { pk: "30" }).ok).toBe(false);
    expect(run("chem-speciation", { ph: "" }).ok).not.toBe(false);
  });

  test("solution pH: buffer, salt, base salt, strong only; Henderson–Hasselbalch compared", () => {
    const o = run("chem-solution-ph");
    expect(o.text).toMatch(/^pH = 4\.76 /);
    expect(o.text).toMatch(/Henderson–Hasselbalch gives pH 4\.76/);
    expect(o.text).toMatch(/β = 115 mM per pH unit/);
    expect(run("chem-solution-ph", { cfree: "0" }).text).toMatch(/^pH = 8\.88 /);
    expect(run("chem-solution-ph", { sys: "base", pk: "9.25", cfree: "0", csalt: "0.1 M" }).text).toMatch(/^pH = 5\.12 /); // scipy 5.124978
    expect(run("chem-solution-ph", { sys: "none", csa: "1e-9" }).text).toMatch(/^pH = 7\.00 /);
    expect(run("chem-solution-ph", { sys: "none", csb: "10 mM" }).text).toMatch(/^pH = 12\.00 /);
    // Dilute buffer: HH is visibly off, and says so.
    const d = run("chem-solution-ph", { pk: "2.5", cfree: "1 mM", csalt: "1 mM" });
    expect(d.text).toMatch(/the shortcut ignores/);
    expect(run("chem-solution-ph", { csa: "-1" }).ok).toBe(false);
    expect(run("chem-solution-ph", { cfree: "5 mL" }).ok).toBe(false);
  });

  test("CV peak tool: ip list, constant, simulation; refusals", () => {
    const o = run("chem-cv-peak");
    expect(o.text).toMatch(/v = 100 mV\/s: ip = 16\.56 µA/);
    expect(o.text).toMatch(/2\.686×10⁵/);
    expect(o.text).toMatch(/ΔEp = 2\.218·RT\/nF = 57 mV/);
    expect(o.text).toMatch(/Ep,c = 0\.2215 V and Ep,a = 0\.2785 V/);
    expect(o.text).toMatch(/Units read: Concentration: 1 mM = 0\.001 M/);
    const noSim = run("chem-cv-peak", { ehalf: "" });
    expect(noSim.text).toMatch(/Give E½ to simulate/);
    expect(run("chem-cv-peak", { vunit: "V/s", rates: "0.1" }).text).toMatch(/v = 100 mV\/s: ip = 16\.56 µA/);
    expect(run("chem-cv-peak", { area: "7.07 mm²" }).text).toMatch(/ip = 16\.56 µA/);
    expect(run("chem-cv-peak", { d: "7.6e-10 m²/s" }).text).toMatch(/ip = 16\.56 µA/);
    expect(run("chem-cv-peak", { n: "0" }).ok).toBe(false);
    expect(run("chem-cv-peak", { n: "1.5" }).ok).toBe(false);
    expect(run("chem-cv-peak", { rates: "" }).ok).toBe(false);
    expect(run("chem-cv-peak", { rates: "100, -5" }).ok).toBe(false);
    expect(run("chem-cv-peak", { d: "7.6e-6 cm" }).ok).toBe(false);
    expect(run("chem-cv-peak", { c: "1 mL" }).ok).toBe(false);
    expect(run("chem-cv-peak", { ehalf: "abc" }).ok).toBe(false);
    expect(run("chem-cv-peak", { t: "-300" }).ok).toBe(false);
    // Tiny currents are written in nA, not as ×10⁻⁹ A.
    expect(run("chem-cv-peak", { c: "1 µM" }).text).toMatch(/ip = 16\.56 nA/);
  });

  test("Randles–Ševčík analysis tool: D back out, quasi-reversible ΔEp flagged, refusals", () => {
    const o = run("chem-cv-randles");
    expect(o.text).toMatch(/Diffusion coefficient D = 7\.6\d×10⁻⁶ cm²\/s/);
    expect(o.text).toMatch(/consistent with a reversible, diffusion-controlled wave/);
    const q = run("chem-cv-randles", { data: "10 5.30 70\n25 8.25 78\n50 11.68 88\n100 16.62 99\n200 23.35 115\n400 33.20 140" });
    expect(q.text).toMatch(/quasi-reversible/);
    expect(run("chem-cv-randles", { data: "10 5\n20 6" }).ok).toBe(false);
    expect(run("chem-cv-randles", { data: "10 5\n20 x\n30 7" }).ok).toBe(false);
    expect(run("chem-cv-randles", { data: "" }).ok).toBe(false);
    expect(run("chem-cv-randles", { area: "0" }).ok).toBe(false);
    const hdr = run("chem-cv-randles", { data: "v\tip\n0.01\t5.30\n0.025\t8.25\n0.05\t11.68", vunit: "V/s" });
    expect(hdr.ok).not.toBe(false);
    expect(r2Text(0.99999)).toBe("R² > 0.9999");
    expect(r2Text(1)).toBe("R² = 1.0000");
  });

  test("hostile inputs never produce an insertable non-finite text", () => {
    const junk = ["", " ", "NaN", "Infinity", "-Infinity", "1e308", "1e-320", "−", "0x10", "1,5", "∞", "1/0"];
    for (const c of TITRATION_CALCS) {
      for (const f of c.fields) {
        if (f.kind === "select") continue;
        for (const j of junk) {
          const o = run(c.id, { [f.key]: j });
          if (o.ok !== false) expect([c.id, f.key, j, contractViolations(o.text)]).toEqual([c.id, f.key, j, []]);
        }
      }
    }
  });

  // ---- review fixes (integration): decimal commas, CV concentration units, wording ----

  test("decimal commas in pasted data are read as decimals, never split (CV data, space and tab forms)", () => {
    const dot = run("chem-cv-randles", { data: "10 5.30\n25 8.25\n50 11.68\n100 16.62" });
    const comma = run("chem-cv-randles", { data: "10 5,30\n25 8,25\n50 11,68\n100 16,62" });
    const tab = run("chem-cv-randles", { data: "10\t5,30\t58\n25\t8,25\t58\n50\t11,68\t59\n100\t16,62\t59" });
    const D = (t: string) => /D = ([\d.]+×10⁻⁶) cm²/.exec(t)?.[1];
    expect(D(dot.text)).toBeDefined();
    expect(D(comma.text)).toBe(D(dot.text));
    expect(D(tab.text)).toBe(D(dot.text));
    expect(comma.text).toMatch(/Commas in the .* were read as decimal points/);
    expect(tab.text).toMatch(/ΔEp: mean 58\.5 mV/);
    // Commas as the separator still work, with a consistent column count…
    expect(D(run("chem-cv-randles", { data: "10,5.30\n25,8.25\n50,11.68\n100,16.62" }).text)).toBe(D(dot.text));
    expect(D(run("chem-cv-randles", { data: "10, 5.30\n25, 8.25\n50, 11.68\n100, 16.62" }).text)).toBe(D(dot.text));
    // …and with dot decimals in the block every comma is a separator: "10,5,30" is v, ip, ΔEp (round-2 review).
    expect(run("chem-cv-randles", { data: "10,5,30\n25,8.25\n50,11.68" }).text).toMatch(/ΔEp was given on only some lines/);
    // A comma that could be thousands or decimal, with nothing to decide it, is refused by name.
    expect(run("chem-cv-randles", { data: "10 1,250\n25 2,000\n50 3,000" }).ok).toBe(false);
  });

  test("decimal commas in measured titration data: the endpoint matches the dot form", () => {
    const t = spec("weak-acid", [4.76]);
    const rows = Array.from({ length: 41 }, (_, V) => [V, ph(t, V).toFixed(2)] as const);
    const dot = run("chem-titration", { data: rows.map(([V, p]) => `${V} ${p}`).join("\n") });
    const comma = run("chem-titration", { data: rows.map(([V, p]) => `${V} ${p.replace(".", ",")}`).join("\n") });
    const tab = run("chem-titration", { data: rows.map(([V, p]) => `${V}\t${p.replace(".", ",")}`).join("\n") });
    const ep = (s: string) => /Measured endpoint: ([\d.]+) mL/.exec(s)?.[1];
    expect(ep(dot.text)).toBe("24.5");
    expect(ep(comma.text)).toBe("24.5");
    expect(ep(tab.text)).toBe("24.5");
  });

  test("decimal-comma pKa lists read correctly; an ambiguous one is refused clearly", () => {
    expect(run("chem-speciation", { pk: "2,15 7,20 12,35" }).text).toMatch(/pKa 2\.15, 7\.20, 12\.35/);
    expect(run("chem-speciation", { pk: "2,15; 7,20" }).text).toMatch(/pKa 2\.15, 7\.20/);
    expect(run("chem-speciation", { pk: "2.15, 7.20" }).text).toMatch(/pKa 2\.15, 7\.20/);
    const amb = run("chem-titration", { pk: "4,76" });
    expect(amb.ok).toBe(false);
    expect(amb.text).toMatch(/could be one number with a decimal comma \(4\.76\) or two values/);
    expect(run("chem-speciation", { pk: "7,2,15" }).text).toMatch(/Commas without spaces were read as separators/);
    expect(run("chem-cv-peak", { rates: "25 50 100,5" }).text).toMatch(/v = 100\.5 mV\/s/);
  });

  test("CV concentration: a bare number is M, like every concentration field in the group", () => {
    const withUnit = run("chem-cv-peak", { c: "1 mM" });
    const bare = run("chem-cv-peak", { c: "0.001" });
    expect(bare.text).toMatch(/v = 100 mV\/s: ip = 16\.56 µA/);
    expect(withUnit.text).toMatch(/v = 100 mV\/s: ip = 16\.56 µA/);
    expect(run("chem-cv-peak", { c: "1" }).text).toMatch(/ip = 16\.56 mA/); // 1 M, accepted (≤ 20 M)
    expect(run("chem-cv-randles", { c: "0.001" }).text).toMatch(/D = 7\.6\d×10⁻⁶ cm²\/s/);
    expect(run("chem-cv-peak", { c: "21" }).ok).toBe(false);
    for (const c of TITRATION_CALCS.filter((k) => k.id.startsWith("chem-cv"))) expect(c.fields.find((f) => f.key === "c")!.label).toMatch(/\(M; mM converts\)/);
  });

  test("wording: a dilute strong acid's missing break names dilution, not pKa; a 50/50 speciation is a tie", () => {
    const s = run("chem-titration", { kind: "strong-acid", c0: "1e-6", ct: "1e-6", vat: "" });
    expect(s.text).toMatch(/no clear break: at this dilution/);
    expect(s.text).not.toMatch(/pKa too close/);
    const tie = run("chem-speciation", { sys: "base", pk: "9.25", ph: "9.25" });
    expect(tie.text).toMatch(/No single dominant form: BH⁺ and B are equal\./);
    expect(run("chem-speciation").text).toMatch(/Dominant form: HA²⁻\./);
  });

  // ---- CUMULATIVE GATE: every review probe for these tools, rounds 1–3, under RULE N (dataBlock.ts) ----
  // Each entry is the probe input and its settled outcome: the exact rows, or a NAMED refusal. A named refusal of
  // genuinely ambiguous input is the intended outcome (the integrator's round-3 tiebreak), never a silent misread.

  type Rows = number[][];
  const T2 = { need: 2 };
  const T3 = { need: 2, optional: 1 };
  const LIST = { need: 1, optional: 49, cap: 50 };
  const PK = { need: 1, optional: 3, cap: 4, pairAmbiguity: true };
  const READS: Array<[string, string, Parameters<typeof readTable>[2], Rows | RegExp, RegExp?]> = [
    // round 1
    ["r1 decimal-comma CV data", "10 5,30\n25 8,25\n50 11,68\n100 16,62", T3, [[10, 5.3], [25, 8.25], [50, 11.68], [100, 16.62]], /decimal points/],
    ["r1 tab + ΔEp", "10\t5,30\t58\n25\t8,25\t58\n50\t11,68\t59", T3, [[10, 5.3, 58], [25, 8.25, 58], [50, 11.68, 59]]],
    ["r1 bare-comma separators", "10,5.30\n25,8.25\n50,11.68", T3, [[10, 5.3], [25, 8.25], [50, 11.68]]],
    ["r1 comma-space separators", "10, 5.30\n25, 8.25", T3, [[10, 5.3], [25, 8.25]]],
    ["r1 undecidable thousands", "10 1,250\n25 2,000\n50 3,000", T3, /“1,250” could be a number with a thousands comma/],
    ["r1 pK decimal commas", "2,15 7,20 12,35", PK, [[2.15, 7.2, 12.35]]],
    ["r1 pK semicolons", "2,15; 7,20", PK, [[2.15, 7.2]]],
    ["r1 pK comma-space", "2.15, 7.20", PK, [[2.15, 7.2]]],
    ["r1 pK lone 4,76", "4,76", PK, /could be one number with a decimal comma \(4\.76\) or two values/],
    ["r1 pK 7,2,15 (separators)", "7,2,15", PK, [[7, 2, 15]]],
    ["r1 rates decimal comma", "25 50 100,5", LIST, [[25, 50, 100.5]]],
    // round 2
    ["r2 mixed-spacing comma data", "0,2.88\n5, 4.15\n10,4.76", T2, /"0,2\.88" has both a decimal point and a comma/],
    ["r2 3-column titration", "0\t2.88\t25.0\n5\t4.15\t25.0", T2, [[0, 2.88], [5, 4.15]], /only the first 2 were read/],
    ["r2 4-column Randles", "10 5.30 58 1\n25 8.25 58 1", T3, [[10, 5.3, 58], [25, 8.25, 58]], /only the first 3 were read/],
    ["r2 word 4th column", "10 5.30 58 ok\n25 8.25 58 ok", T3, /line 1 .*mixes words and numbers \("ok"\)/],
    ["r2 optional ΔEp on one row", "10,5.30\n25,8.25,58\n50,11.68", T3, [[10, 5.3], [25, 8.25, 58], [50, 11.68]]],
    ["r2 10,5,30 with dot rows", "10,5,30\n25,8.25\n50,11.68", T3, [[10, 5, 30], [25, 8.25], [50, 11.68]]],
    ["r2 rates 25,50", "25,50", LIST, [[25, 50]]],
    ["r2 rates 100,200", "100,200", LIST, [[100, 200]]],
    ["r2 rates 1000,2000", "1000,2000", LIST, [[1000, 2000]]],
    ["r2 rates 25, 50,100", "25, 50,100", LIST, /“50,100” could be a number with a thousands comma/],
    // round 3 (B1 and review-round3/rt.json)
    ["r3 comma-space + decimal commas", "10, 5,30\n25, 8,25\n50, 11,68\n100, 16,62", T3, [[10, 5.3], [25, 8.25], [50, 11.68], [100, 16.62]]],
    ["r3 tab, mixed 12.5 and 5,10", "0\t2,88\n5\t4,15\n10\t4,76\n12.5\t5,10", T2, /mixes 12\.5 and 2,88/],
    ["r3 tab, mixed 10.5", "0\t2,88\n5\t4,15\n10.5\t4,76", T2, /mixes 10\.5 and 2,88/],
    ["r3 space, mixed 12.5", "0 2,88\n5 4,15\n10 4,76\n12.5 5,20", T2, /mixes 12\.5 and 2,88/],
    ["r3 header with a number in it", "pH 7.0 buffer\n0\t2,88\n5\t4,15", T2, [[0, 2.88], [5, 4.15]], /header/],
    ["r3 header 0.1 M NaOH", "0.1 M NaOH\n0\t2,88\n5\t4,15", T2, [[0, 2.88], [5, 4.15]], /header/],
    ["r3 tab third column 25.0", "0\t2,88\t25.0\n5\t4,15\t25.1", T2, /mixes 25\.0 and 2,88/],
    ["r3 semicolons", "0;2,88\n5;4,15\n10;4,76", T2, [[0, 2.88], [5, 4.15], [10, 4.76]]],
    ["r3 comma-space decimal", "0, 2,88\n5, 4,15", T2, [[0, 2.88], [5, 4.15]]],
    ["r3 trailing comment", "0 2,88\n5 4,15 # pH meter 2.0", T2, /line 2 .*mixes words and numbers/],
    ["r3 tab ΔEp with 50.0", "10\t5,30\t58\n25\t8,25\t58\n50.0\t11,68\t59", T3, /mixes 50\.0 and 5,30/],
    ["r3 extra 1e2 column", "10 5,30\n25 8,25\n50 11,68\n100 16,62 1e2", T3, [[10, 5.3], [25, 8.25], [50, 11.68], [100, 16.62, 100]]],
    ["r3 word third column", "0 2.88 x\n5 4.15 y", T2, /line 1 .*mixes words and numbers \("x"\)/],
    ["r3 ragged extra column", "0 2.88 3.0\n5 4.15", T2, [[0, 2.88], [5, 4.15]], /1 row has more columns/],
    ["r3 1,000 beside 7.0", "1,000 7.0\n2,000 7.5", T2, /mixes 7\.0 and 1,000/],
    ["r3 tab thousands-or-decimal", "0\t1,000\n5\t2,000", T2, /“1,000” could be a number with a thousands comma/],
    ["r3 true-minus decimal commas", "0 −1,5\n1 −0,5", T2, [[0, -1.5], [1, -0.5]]],
    ["r3 rates bare commas", "25,50,100,200", LIST, [[25, 50, 100, 200]]],
    ["r3 pK 2,15 7.20", "2,15 7.20", PK, /mixes 7\.20 and 2,15/],
    ["r3 pK lone 4,76 with space", "4,76 ", PK, /could be one number with a decimal comma/],
    ["r3 pK 2,15, 7,20", "2,15, 7,20", PK, [[2.15, 7.2]]],
    ["r3 partial ΔEp", "10 5.30 58\n25 8.25\n50 11.68 59", T3, [[10, 5.3, 58], [25, 8.25], [50, 11.68, 59]]],
    ["r3 rates 1,000, 2,000", "1,000, 2,000", LIST, /“1,000” could be a number with a thousands comma/],
  ];

  test.each(READS.map(([name, text, opts, want, note]) => ({ name, text, opts, want, note })))("readTable: $name", ({ text, opts, want, note }) => {
    const r = readTable(text, "Data", opts);
    if (want instanceof RegExp) {
      expect(typeof r).toBe("string");
      expect(r as string).toMatch(want);
      return;
    }
    if (typeof r === "string") throw new Error(r);
    expect(r.rows.length).toBe(want.length);
    r.rows.forEach((row, i) => {
      expect(row.length).toBe(want[i].length);
      row.forEach((v, j) => expect(v).toBeCloseTo(want[i][j], 12));
    });
    if (note) expect(r.notes.join(" ")).toMatch(note);
  });

  // The same probes through the calculators: the outcome the user sees.
  const CALC: Array<[string, string, Record<string, string>, RegExp, boolean?]> = [
    ["r1 Randles decimal commas → same D", "chem-cv-randles", { data: "10 5,30\n25 8,25\n50 11,68\n100 16,62" }, /D = 7\.62×10⁻⁶ cm²\/s/],
    ["r3 Randles comma-space decimal → same D", "chem-cv-randles", { data: "10, 5,30\n25, 8,25\n50, 11,68\n100, 16,62" }, /D = 7\.62×10⁻⁶ cm²\/s/],
    ["r1 Randles dot form", "chem-cv-randles", { data: "10 5.30\n25 8.25\n50 11.68\n100 16.62" }, /D = 7\.62×10⁻⁶ cm²\/s/],
    ["r2 optional ΔEp", "chem-cv-randles", { data: "10,5.30\n25,8.25,58\n50,11.68\n100,16.62" }, /ΔEp was given on only some lines, so it is not used\./],
    ["r2 ok column refused", "chem-cv-randles", { data: "10 5.30 58 ok\n25 8.25 58 ok\n50 11.68 59 ok" }, /mixes words and numbers/, false],
    ["r3 titration mixed marks refused", "chem-titration", { data: "0\t2,88\n5\t4,15\n10\t4,76\n12.5\t5,10" }, /mixes 12\.5 and 2,88/, false],
    ["r2 titration mixed spacing refused", "chem-titration", { data: "0,2.88\n5, 4.15\n10,4.76" }, /both a decimal point and a comma/, false],
    ["r2 titration 3 columns", "chem-titration", { data: "0\t2.88\t25.0\n5\t4.15\t25.0\n10\t4.76\t25.1\n20\t5.36\t25.0\n24\t6.14\t25.0\n25\t8.73\t25.0\n26\t11.29\t25.0" }, /Measured endpoint: 24\.5 mL/],
    ["r3 pK 2,15 7.20 refused (not 'ascending')", "chem-speciation", { pk: "2,15 7.20" }, /mixes 7\.20 and 2,15/, false],
    ["r1 pK decimal commas", "chem-speciation", { pk: "2,15 7,20 12,35" }, /pKa 2\.15, 7\.20, 12\.35/],
    ["r1 pK 4,76 refused", "chem-titration", { pk: "4,76" }, /could be one number with a decimal comma \(4\.76\)/, false],
    ["r1 pK 7,2,15 ascending hint", "chem-speciation", { pk: "7,2,15" }, /Commas without spaces were read as separators/, false],
    ["r2 rates 25,50", "chem-cv-peak", { rates: "25,50" }, /v = 50 mV\/s/],
    ["r2 rates 1000,2000", "chem-cv-peak", { rates: "1000,2000" }, /v = 2000 mV\/s/],
    ["r1 rates 100,5", "chem-cv-peak", { rates: "25 50 100,5" }, /v = 100\.5 mV\/s/],
    ["r3 rates 1,000, 2,000 refused (not 'Scan rate 0')", "chem-cv-peak", { rates: "1,000, 2,000" }, /"1,000" could be a number with a thousands comma/, false],
    ["r2 rates 25, 50,100 refused", "chem-cv-peak", { rates: "25, 50,100" }, /"50,100" could be/, false],
    ["r1 CV bare concentration is M", "chem-cv-peak", { c: "0.001" }, /v = 100 mV\/s: ip = 16\.56 µA/],
    ["r1 Randles bare concentration is M", "chem-cv-randles", { c: "0.001" }, /D = 7\.6\d×10⁻⁶ cm²\/s/],
    ["r1 dilute strong acid wording", "chem-titration", { kind: "strong-acid", c0: "1e-6", ct: "1e-6", vat: "" }, /no clear break: at this dilution/],
    ["r1 50/50 speciation is a tie", "chem-speciation", { sys: "base", pk: "9.25", ph: "9.25" }, /No single dominant form: BH⁺ and B are equal\./],
    // round 4 (R1 single-value lists, R2 spaces inside tab fields, R3 grouping spaces, minus echoed as typed)
    ["r4 rates one per line, decimal commas", "chem-cv-peak", { rates: "12,5\n25,5\n50,5" }, /v = 12\.5 mV\/s[\s\S]*v = 25\.5 mV\/s[\s\S]*v = 50\.5 mV\/s/],
    ["r4 rates tab then spaces refused", "chem-cv-peak", { rates: "25\t50\n100 200" }, /"100 200" has spaces inside one tab-separated field/, false],
    ["r4 Randles spaces inside a tab field refused", "chem-cv-randles", { data: "100 250\t16.62\n25\t8.25\n50\t11.68" }, /"100 250" has spaces inside one tab-separated field/, false],
    ["r4 pK one per line, decimal commas", "chem-speciation", { pk: "2,15\n7,20\n12,35" }, /pKa 2\.15, 7\.20, 12\.35/],
    ["r6 grouping space between rates refused (R3″ b)", "chem-cv-peak", { rates: "1\u00A0000 2\u00A0000", vunit: "mV/s" }, /no-break\/thin space between digits/, false],
    ["r6 one-line grouped rate refused (R3″ b)", "chem-cv-peak", { rates: "1\u00A0000\u00A0000", vunit: "mV/s" }, /no-break\/thin space between digits/, false],
    ["r6 two-group rates one per line refused (singleColumn decision)", "chem-cv-peak", { rates: "1\u00A0000\n2\u00A0000", vunit: "mV/s" }, /no-break\/thin space between digits/, false],
    ["r6 grouped rates with a decimal part one per line read", "chem-cv-peak", { rates: "1\u00A0000,5\n2\u00A0000,5", vunit: "mV/s" }, /v = 1001 mV\/s: [\s\S]*v = 2001 mV\/s/], // 1000.5 and 2000.5 mV/s, shown to four figures
    ["r4 minus echoed in the comma note", "chem-cv-randles", { data: "10 −5,30\n25 −8,25\n50 −11,68\n100 −16,62" }, /“−5,30” is −5\.3|"−5,30" is −5\.3/],
  ];
  test.each(CALC.map(([name, id, over, want, ok]) => ({ name, id, over, want, ok })))("calculator: $name", ({ id, over, want, ok }) => {
    const o = run(id, over);
    if (ok === false) expect(o.ok).toBe(false);
    else expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(want);
  });

  test("the scan-rate label states the rule it follows", () => {
    expect(TITRATION_CALCS.find((c) => c.id === "chem-cv-peak")!.fields.find((f) => f.key === "rates")!.label).toMatch(/commas or spaces/);
  });
});
