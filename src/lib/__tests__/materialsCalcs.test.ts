// The materials-testing and quality calculators AS THE PANE RUNS THEM: the
// registry objects from materialsCalcs.ts (spread into ENG_CALCS), fed their
// shipped defaults or overrides through the pane's read(k).
//
// ORACLE: numpy 2 / scipy 1.x in the scratchpad venv (statvenv). The script,
// verbatim in substance (oracle.py):
//
//   # tensile default (strain %, MPa): d = the TENSILE_DEFAULT rows
//   e=d[:,0]/100; s=d[:,1]; uts=s.max(); iu=s.argmax()
//   m=(s>=0.1*uts)&(s<=0.4*uts)&(arange(len(s))<=iu)
//   E,a=np.polyfit(e[m],s[m],1); off=s-(a+E*(e-0.002))
//   i=first index with off[i]>0 and off[i+1]<=0; linear interpolation → sy, ey
//   tough=np.trapezoid(s,e); res=sy**2/(2*E); Agp=e[iu]-(uts-a)/E; Afp=e[-1]-(s[-1]-a)/E
//   → E 68882.73307855516, a 1.034949303143631, sy 208.5015295653225,
//     ey 0.005011880786228097, tough 40.8860115, res 0.3155572223121704,
//     Agp 0.07465955294571507, Afp 0.13692111058693854
//   # Weibull: scipy.stats.weibull_min.fit(w, floc=0); Bernard (i-0.3)/(n+0.4),
//   #   np.polyfit(log(sorted w), log(-log(1-F)), 1)
//   → default 20: MLE m 9.443330699368978, σ0 429.15071037565383;
//                 reg m 9.56769797946629, σ0 428.8440082279905
//   → weibull_min.rvs(12, scale=350, size=30, random_state=7) rounded to 0.1:
//                 MLE 12.544639987787836, 351.2760518441355; reg 11.575303159640823,
//                 351.74121011880044; Pf(300) = 0.1290316727301687
//   # Scherrer default: beta=sqrt(fwhm²-0.08²) deg → rad, tau=0.9*1.540598/(beta cos θ)/10 nm
//   → [34.600955928808, 31.113030887289, 29.055345963949, 26.705119750511, 25.134285692173]
//   → Lorentzian β = fwhm − 0.08: first peak 48.208165642946 nm
//   → W–H polyfit(4 sin θ, β cos θ): D 47.144927071509194 nm, ε 0.0010030717985327472, R² 0.9800488331415124
//   # Capability default (30 values, subgroups of 5, d2 = 2.326), Bissell z = norm.ppf(0.975):
//   → (o4.py: rng default_rng(11), subgroup means drifting ±0.018, σ 0.02, rounded 0.001)
//   → mean 9.997966666666667, s 0.022938423319134513, σw 0.016122098022356077
//   → within: Cp 2.0675555555555354, Cpk 2.0255152592592394, CI 1.490764242140723–2.5602662763777557, ppm 0.0007375423128821484
//   → overall: Pp 1.4531658462126118, Ppk 1.4236181406729553, CI 1.0383138922242598–1.8089223891216508, ppm 14.067114932544621
//   → scipy.stats.normaltest p = 0.7200102798358512 (D'Agostino–Pearson K², same test)
//   → one-sided USL 5.3, 50 values norm.rvs(5, 0.1, random_state=3) rounded 0.001, 90 %:
//     Cpu 1.0882241803357733, CI 0.8914855155919609–1.2849628450795856, ppm 547.9534658034909
//   # Stack default: nominal 0.5, centre 0.53, worst 0.26, RSS 0.12884098726725127,
//   #   shares [0.602409638554, 0.150602409639, 0.096385542169, 0.096385542169, 0.05421686747]
//   # d2(n) = quad(1 - Φ(x)^n - (1-Φ(x))^n, -inf, inf) (d2.py), n = 2..25 — table below.
import { MATERIALS_CALCS, type MatCalc } from "../materialsCalcs";
import { tensileTest, weibullStrength, scherrer, capability, toleranceStack, D2, weibullPf } from "../materialsTesting";
import { weibullFit } from "../reliability";
import { gridToFieldText } from "../dataimport";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { referenceMs } from "./timingFloor";

const calc = (id: string): MatCalc => {
  const c = MATERIALS_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
function insertable(text: string): boolean {
  return !!text && !text.includes("—") && !text.includes("NaN") && !text.includes("Infinity") && !text.includes("undefined");
}
/** Display contract violations in a text. */
function contract(text: string): string[] {
  const bad: string[] = [];
  if (/(^|[\s(=:;,/±])-\.?\d/m.test(text)) bad.push("ASCII hyphen as a minus");
  if (/\d%/.test(text)) bad.push("no space before %");
  if (/\d\.?\d*e[+-]?\d/i.test(text)) bad.push("e-notation");
  if (text.includes("^")) bad.push("caret");
  if (/NaN|Infinity|undefined|not finite/.test(text)) bad.push("non-finite word");
  return bad;
}
function plots(out: AnalyzeOutput): string[] {
  return (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
}
const okOut = (out: AnalyzeOutput): void => {
  expect(out.ok).not.toBe(false);
  expect(insertable(out.text)).toBe(true);
  expect(contract(out.text)).toEqual([]);
  const svgs = plots(out);
  expect(svgs.length).toBeGreaterThan(0);
  for (const s of svgs) {
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toMatch(/NaN|Infinity|undefined/);
  }
};
const refused = (out: AnalyzeOutput, re?: RegExp): void => {
  expect(out.ok).toBe(false);
  expect(out.text.length).toBeGreaterThan(10);
  expect(out.text).not.toMatch(/NaN|Infinity|undefined|—/);
  if (re) expect(out.text).toMatch(re);
};

// The pane's ENG_GROUP_ORDER (taskpane.ts), restated: tsc proves every group used is one of them.
const ENG_GROUP_ORDER = [
  "Structural & solids", "Fatigue & machine design", "Reliability", "Fluids", "Thermal", "Energy & power",
  "Audio & acoustics", "Video & display", "Light & camera", "Electronics", "Chips & semiconductors",
  "Aviation & avionics", "Trajectory & orbits", "Robotics & kinematics", "Computation & information",
  "Control systems", "Vibration", "Optics & photonics", "Quantum optics", "Biomedical", "Pharmacokinetics",
] as const;
type EngGroup = (typeof ENG_GROUP_ORDER)[number];

const TENSILE_ROWS: [number, number][] = [
  [0, 0], [0.0357, 25], [0.0714, 50], [0.1072, 75], [0.1431, 100], [0.1804, 125], [0.224, 150], [0.2888, 175],
  [0.4146, 200], [0.6183, 220], [0.8861, 235], [1.3177, 250], [1.8391, 262], [2.4406, 272], [3.1519, 281],
  [3.9539, 289], [4.8151, 296], [5.693, 302], [6.5382, 307], [7.2976, 311], [7.9203, 314], [11.5, 313],
  [12.5, 308], [13.4, 298], [14.1, 282],
];

describe("registry", () => {
  test("five calculators, unique ids, existing groups only", () => {
    expect(MATERIALS_CALCS.map((c) => c.id)).toEqual([
      "mat-tensile", "mat-weibull-strength", "mat-scherrer", "qual-capability", "qual-tolerance-stack",
    ]);
    const groups: EngGroup[] = MATERIALS_CALCS.map((c) => c.group);
    for (const g of groups) expect(ENG_GROUP_ORDER).toContain(g);
  });
  test.each(MATERIALS_CALCS.map((c) => [c.id, c] as const))("%s: defaults compute, draw and meet the display contract", (_id, c) => {
    expect(c.hint.length).toBeGreaterThan(80);
    expect(c.fields.length).toBeGreaterThan(0);
    for (const f of c.fields) if (f.kind === "select") expect(f.options?.some((o) => o.value === f.default)).toBe(true);
    okOut(run(c.id));
  });
  test.each(MATERIALS_CALCS.map((c) => [c.id, c] as const))("%s reads every field it declares", (_id, c) => {
    // Changing any one field (to a value of the same kind) must be noticed or refused.
    const base = run(c.id).text;
    for (const f of c.fields) {
      const num = Number(f.default);
      const alt = f.kind === "select" ? f.options!.find((o) => o.value !== f.default)!.value : f.default && Number.isFinite(num) && num !== 0 ? String(num * 1.1) : f.default ? "" : "7";
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((g) => [g.key, g.default]));
      vals[f.key] = alt;
      if (c.id === "mat-tensile" && (f.key === "loadUnit" || f.key === "extUnit" || f.key === "gauge" || f.key === "area")) vals.mode = "le";
      if (c.id === "mat-scherrer" && f.key === "lambdaCustom") {
        vals.lambda = "custom";
        vals.lambdaCustom = "1.79";
      }
      const t = c.compute((k) => vals[k] ?? "").text;
      expect(`${f.key}:${t === base ? "same" : "changed"}`).toBe(`${f.key}:changed`);
    }
  });
  test("every figure lands in a plot block with a caption", () => {
    for (const c of MATERIALS_CALCS) {
      const out = run(c.id, c.id === "qual-tolerance-stack" ? { mc: "on" } : {});
      for (const b of out.blocks ?? []) if (b.kind === "plot") expect(b.caption.length).toBeGreaterThan(10);
    }
  });
});

describe("tensile test", () => {
  const strain = TENSILE_ROWS.map((r) => r[0] / 100);
  const stress = TENSILE_ROWS.map((r) => r[1]);
  test("default curve matches the numpy oracle", () => {
    const r = tensileTest({ strain, stress, offset: 0.002 });
    if (!r.ok) throw new Error(r.error);
    expect(r.modulus!.E).toBeCloseTo(68882.73307855516, 6);
    expect(r.modulus!.intercept).toBeCloseTo(1.034949303143631, 9);
    expect(r.offsetYield!.stress).toBeCloseTo(208.5015295653225, 9);
    expect(r.offsetYield!.strain).toBeCloseTo(0.005011880786228097, 12);
    expect(r.uts).toBe(314);
    expect(r.toughness).toBeCloseTo(40.8860115, 9);
    expect(r.resilience).toBeCloseTo(0.3155572223121704, 12);
    expect(r.uniformPlastic).toBeCloseTo(0.07465955294571507, 12);
    expect(r.fracturePlastic).toBeCloseTo(0.13692111058693854, 12);
    expect(r.modulus!.points).toBe(4);
  });
  test("the pane text shows those numbers", () => {
    const t = run("mat-tensile").text;
    expect(t).toContain("68.88 GPa");
    expect(t).toContain("208.5 MPa");
    expect(t).toContain("314.0 MPa");
    expect(t).toContain("40.89 MJ/m³");
    expect(t).toContain("0.2 % offset yield");
  });
  test("load–extension gives the same answer as stress–strain", () => {
    // A₀ = 78.54 mm², L₀ = 50 mm: extension mm = ε·50, load kN = σ·78.54/1000.
    const rows = TENSILE_ROWS.map(([e, s]) => `${(e / 100) * 50}\t${(s * 78.54) / 1000}`).join("\n");
    const t = run("mat-tensile", { mode: "le", data: rows, gauge: "50 mm", area: "78.54 mm²", loadUnit: "kN", extUnit: "mm" }).text;
    expect(t).toContain("68.88 GPa");
    expect(t).toContain("208.5 MPa");
    // the same in inches and pounds-force, converted through units.ts
    const rowsUs = TENSILE_ROWS.map(([e, s]) => `${((e / 100) * 50) / 25.4}\t${(s * 78.54) / 4.4482216152605}`).join("\n");
    const out = run("mat-tensile", { mode: "le", data: rowsUs, gauge: "1.968503937 in", area: "0.121737 in^2", loadUnit: "lbf", extUnit: "in" });
    okOut(out);
    expect(out.text).toMatch(/Gauge length: 1\.968503937 in = 50\.0000 mm/);
    expect(out.text).toContain("208.5 MPa");
  });
  test("ksi in, ksi out; strain as mm/mm", () => {
    const k = 6.894757; // MPa per ksi, as units.ts
    const rows = TENSILE_ROWS.map(([e, s]) => `${e / 100}\t${s / k}`).join("\n");
    const out = run("mat-tensile", { data: rows, strainUnit: "frac", stressUnit: "ksi" });
    okOut(out);
    expect(out.text).toContain(`${(68882.73307855516 / k).toPrecision(4)} ksi`); // 9991 ksi
    expect(out.text).toContain(`${(208.5015295653225 / k).toPrecision(4)} ksi`);
    expect(out.text).toMatch(/in·lbf\/in³/);
  });
  test("a strain window is honoured", () => {
    const r = tensileTest({ strain, stress, offset: 0.002, window: { lo: 0.0003, hi: 0.0015 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.modulus!.points).toBe(4); // 0.000357, 0.000714, 0.001072, 0.001431
    expect(r.modulus!.windowRule).toBe("your strain window");
    for (const w of ["0.03–0.15", "0.03-0.15", "0.03 - 0.15", "0.03 to 0.15", "0.03 0.15"]) {
      const t = run("mat-tensile", { window: w }).text;
      expect(t).toContain("your strain window");
      expect(t).toContain("strain 0.03000 % to 0.1500 %");
      expect(t).toContain("4 points");
    }
  });
  test("brittle and sparse curves report what they can (no refusal); bad input refuses", () => {
    // Linear to fracture: the offset line never meets the curve.
    const brittle = Array.from({ length: 10 }, (_, i) => `${i * 0.01}\t${i * 30}`).join("\n");
    const b = run("mat-tensile", { data: brittle });
    okOut(b);
    expect(b.text).toMatch(/offset yield +none/);
    expect(b.text).toMatch(/never meets the curve/);
    expect(b.text).toContain("Ultimate strength UTS    270.0 MPa");
    // Only two rows in the 10–40 % band: no modulus, but UTS, elongation and toughness.
    const sparse = "0 0\n0.1 50\n0.2 100\n0.5 260\n2 300\n5 310\n8 305";
    const sp = run("mat-tensile", { data: sparse });
    okOut(sp);
    expect(sp.text).toMatch(/No elastic region could be fitted/);
    expect(sp.text).toContain("Ultimate strength UTS    310.0 MPa");
    expect(sp.text).toContain("Elongation at fracture   8.000 % total, plastic not determined (no elastic region fitted) (row 7)");
    // Reversal.
    refused(run("mat-tensile", { data: "0 0\n0.1 70\n0.2 140\n0.15 150\n0.5 200\n1 220" }), /goes backwards/);
    refused(run("mat-tensile", { data: "0 0\n0.1 70" }), /at least 5 rows/);
    refused(run("mat-tensile", { data: "" }), /nothing to read/);
    refused(run("mat-tensile", { data: "0 0\n0.1 abc\n0.2 140\n0.3 200\n0.4 210" }), /line 2 .* mixes words and numbers/);
    // "1,234" alone is ambiguous (decimal or thousands): refused, never guessed.
    refused(run("mat-tensile", { data: "0 0\n1,234 70\n2,468 140\n3,702 150\n4,936 160" }), /comma/);
    refused(run("mat-weibull-strength", { data: "1,234 2,345 3,456" }), /comma/);
    refused(run("mat-tensile", { offset: "-1" }));
    refused(run("mat-tensile", { mode: "le", area: "50 mm" }), /Area/); // a length where an area belongs
    refused(run("mat-tensile", { mode: "le", gauge: "0 mm" }), /greater than zero/);
    refused(run("mat-tensile", { window: "0.5" }), /strain window/);
    // A curved "elastic" region is reported with a caveat, never refused.
    const curved = Array.from({ length: 40 }, (_, i) => `${i * 0.1}\t${300 * Math.sqrt(i / 39)}`).join("\n");
    const cv = run("mat-tensile", { data: curved });
    okOut(cv);
    expect(cv.text).toMatch(/No linear elastic region|No elastic region could be fitted/);
  });
  test("huge and tiny magnitudes stay finite or refuse", () => {
    const huge = TENSILE_ROWS.map(([e, s]) => `${e}\t${s * 1e300}`).join("\n");
    refused(run("mat-tensile", { data: huge }), /beyond 10¹⁰⁰/);
    const big = TENSILE_ROWS.map(([e, s]) => `${e}\t${s * 1e40}`).join("\n");
    okOut(run("mat-tensile", { data: big }));
    const tiny = TENSILE_ROWS.map(([e, s]) => `${e}\t${s * 1e-200}`).join("\n");
    const o2 = run("mat-tensile", { data: tiny });
    expect(contract(o2.text)).toEqual([]);
  });
  test("70 000 rows: no argument-spread crash (JavaScriptCore caps calls at ~65 536 args) and a thinned drawing", () => {
    const n = 70000;
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = (314 * i) / (n - 1);
      rows.push(`${((s / 70000 + 0.002 * Math.pow(s / 210, 9)) * 100).toFixed(6)}\t${s.toFixed(4)}`);
    }
    const out = run("mat-tensile", { data: rows.join("\n") });
    okOut(out);
    for (const s of plots(out)) expect(s.length).toBeLessThan(400000);
  });
  test("a Word table through the block conversion", () => {
    const grid = [["strain %", "stress MPa"], ...TENSILE_ROWS.map(([e, s]) => [String(e), String(s)])];
    const t = run("mat-tensile", { data: gridToFieldText(grid, "block") }).text;
    expect(t).toContain("68.88 GPa");
  });
});

describe("Weibull strength", () => {
  const W20 = [312, 334, 351, 362, 371, 380, 387, 393, 399, 405, 411, 417, 424, 430, 437, 445, 454, 465, 480, 502];
  const W30 = [283.4, 362.3, 334.3, 357.4, 391.3, 342.6, 339.6, 282, 317.7, 339.5, 353.8, 364.5, 329.2, 279.8, 319.9, 376.5, 310.8, 335.5, 379.9, 257.6, 347.5, 383.5, 313, 343.4, 376.5, 297.6, 341.4, 359.7, 352.9, 336.8];
  test("MLE matches scipy weibull_min.fit(floc=0); regression matches numpy polyfit", () => {
    for (const [data, mle, reg] of [
      [W20, [9.443330699368978, 429.15071037565383], [9.56769797946629, 428.8440082279905]],
      [W30, [12.544639987787836, 351.2760518441355], [11.575303159640823, 351.74121011880044]],
    ] as const) {
      const r = weibullStrength([...data]);
      if (!r.ok) throw new Error(r.error);
      // scipy's fit stops at its optimiser tolerance (≈1e-6 relative); weibullFit
      // solves the likelihood equation exactly (o3.py: brentq on it gives
      // 12.544626813272375, 351.27601839597054 for W30, agreeing to 1e-13).
      expect(Math.abs(r.mle.m / mle[0] - 1)).toBeLessThan(2e-6);
      expect(Math.abs(r.mle.sigma0 / mle[1] - 1)).toBeLessThan(2e-6);
      expect(r.reg.m).toBeCloseTo(reg[0], 9);
      expect(r.reg.sigma0).toBeCloseTo(reg[1], 8);
    }
    const w30 = weibullStrength(W30);
    if (!w30.ok) throw new Error(w30.error);
    expect(w30.mle.m).toBeCloseTo(12.544626813272375, 9);
    expect(w30.mle.sigma0).toBeCloseTo(351.27601839597054, 8);
    expect(weibullPf(300, 12.544639987787836, 351.2760518441355)).toBeCloseTo(0.1290316727301687, 12);
  });
  test("the MLE IS reliability.ts weibullFit (one fitter in the app)", () => {
    const r = weibullStrength(W20);
    const w = weibullFit({ times: W20, events: W20.map(() => 1) });
    if (!r.ok || !w.ok) throw new Error("fit");
    expect(r.mle.m).toBe(w.beta);
    expect(r.mle.sigma0).toBe(w.eta);
  });
  test("pane text and failure probability", () => {
    const t = run("mat-weibull-strength", { at: "300" }).text;
    expect(t).toContain("9.443");
    expect(t).toContain("9.568");
    expect(t).toContain("429.2 MPa");
    expect(t).toMatch(/Probability of failure at 300\.0 MPa/);
    expect(t).not.toMatch(/hours|still running|MTTF/);
  });
  test("refuses: too few, zero/negative, all equal, garbage", () => {
    refused(run("mat-weibull-strength", { data: "300 310" }), /at least 3/);
    refused(run("mat-weibull-strength", { data: "300 0 310 320" }), /greater than zero/);
    refused(run("mat-weibull-strength", { data: "300 −5 310 320" }), /greater than zero/);
    refused(run("mat-weibull-strength", { data: "300 300 300 300" }), /same/);
    refused(run("mat-weibull-strength", { data: "300 x 310" }), /line 1 .* mixes words and numbers/);
    refused(run("mat-weibull-strength", { data: "300 310\n320 x 330" }), /line 2 \("320 x 330"\) mixes words and numbers/);
    refused(run("mat-weibull-strength", { data: "" }));
    refused(run("mat-weibull-strength", { at: "−3" }));
  });
  test("extreme magnitudes", () => {
    okOut(run("mat-weibull-strength", { data: W20.map((v) => v * 1e-200).join(" ") }));
    okOut(run("mat-weibull-strength", { data: W20.map((v) => v * 1e200).join(" ") }));
  });
});

describe("Scherrer and Williamson–Hall", () => {
  const PEAKS = [
    { twoTheta: 28.44, fwhm: 0.25 },
    { twoTheta: 47.3, fwhm: 0.29 },
    { twoTheta: 56.12, fwhm: 0.32 },
    { twoTheta: 69.13, fwhm: 0.37 },
    { twoTheta: 76.37, fwhm: 0.41 },
  ];
  const opts = { K: 0.9, lambda: 1.540598, instrument: 0.08, mode: "gauss" as const };
  test("sizes match the closed form (oracle)", () => {
    const r = scherrer(PEAKS, opts);
    if (!r.ok) throw new Error(r.error);
    const want = [34.600955928808, 31.113030887289, 29.055345963949, 26.705119750511, 25.134285692173];
    r.peaks.forEach((p, i) => expect(p.size / 10).toBeCloseTo(want[i], 9));
    expect(r.wh!.size! / 10).toBeCloseTo(47.144927071509194, 8);
    expect(r.wh!.strain).toBeCloseTo(0.0010030717985327472, 12);
    expect(r.wh!.fit.r2).toBeCloseTo(0.9800488331415124, 10);
    const L = scherrer(PEAKS, { ...opts, mode: "lorentz" });
    if (!L.ok) throw new Error(L.error);
    expect(L.peaks[0].size / 10).toBeCloseTo(48.208165642946, 9);
  });
  test("θ is half of 2θ and β is converted to radians (a textbook check)", () => {
    // τ = 0.9·1.5406 Å/(β cos θ); 2θ = 60°, β = 0.5° → 0.9·1.5406/(0.0087266·cos 30°) = 183.47 Å
    const r = scherrer([{ twoTheta: 60, fwhm: 0.5 }], { K: 0.9, lambda: 1.5406, instrument: 0, mode: "none" });
    if (!r.ok) throw new Error(r.error);
    expect(r.peaks[0].size).toBeCloseTo((0.9 * 1.5406) / (0.5 * (Math.PI / 180) * Math.cos(Math.PI / 6)), 9);
    expect(r.peaks[0].size).toBeCloseTo(183.47, 1);
    expect(r.wh).toBeNull();
  });
  test("pane: wavelength from solidform, custom λ in nm, per-peak instrument column", () => {
    const t = run("mat-scherrer").text;
    expect(t).toContain("1.540598 Å");
    expect(t).toContain("34.6 nm");
    expect(t).toContain("47.1 nm");
    const nm = run("mat-scherrer", { lambda: "custom", lambdaCustom: "0.1540598 nm" }).text;
    expect(nm).toContain("34.6 nm");
    expect(nm).toMatch(/Units read/);
    const per = run("mat-scherrer", { peaks: "28.44 0.25 0.08\n47.30 0.29 0.08", inst: "" }).text;
    expect(per).toContain("34.6 nm");
    expect(per).toMatch(/needs at least 3 peaks/);
    okOut(run("mat-scherrer", { peaks: "28.44 0.25" }));
  });
  test("refuses: instrument ≥ observed, bad 2θ, FWHM nonsense, bad K, bad λ unit", () => {
    refused(run("mat-scherrer", { inst: "0.3" }), /not smaller than the observed/);
    refused(run("mat-scherrer", { peaks: "190 0.2" }), /between 0 and 180/);
    refused(run("mat-scherrer", { peaks: "28 0" }), /positive/);
    refused(run("mat-scherrer", { peaks: "28 25" }), /not a Bragg peak/);
    refused(run("mat-scherrer", { K: "0" }), /shape factor/);
    refused(run("mat-scherrer", { lambda: "custom", lambdaCustom: "1.54 kg" }), /Wavelength/);
    refused(run("mat-scherrer", { peaks: "" }));
  });
  test("a non-positive W–H intercept is reported as not determinable", () => {
    // β cos θ falling with 4 sin θ through zero.
    const r = scherrer(
      [
        { twoTheta: 30, fwhm: 0.05 },
        { twoTheta: 60, fwhm: 0.2 },
        { twoTheta: 90, fwhm: 0.45 },
      ],
      { K: 0.9, lambda: 1.540598, instrument: 0, mode: "none" },
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.wh!.size).toBeNull();
    const t = run("mat-scherrer", { peaks: "30 0.05\n60 0.2\n90 0.45", inst: "" }).text;
    expect(t).toMatch(/not determinable/);
  });
});

describe("process capability", () => {
  const DEF = [9.989, 10.015, 10.012, 9.978, 9.982, 9.995, 10.017, 10.005, 10.021, 9.969, 10.049, 10.016, 10.032, 10.015, 10.01, 10.009, 10.016, 9.996, 9.997, 10.014, 9.967, 9.954, 9.992, 9.971, 9.946, 9.994, 10.001, 9.986, 9.98, 10.011];
  test("d₂ table equals the defining integral (scipy quad) to the published 3 decimals", () => {
    const integral: Record<number, number> = {
      2: 1.128379, 3: 1.692569, 4: 2.058751, 5: 2.325929, 6: 2.534413, 7: 2.704357, 8: 2.847201, 9: 2.970026,
      10: 3.077505, 11: 3.172873, 12: 3.258455, 13: 3.33598, 14: 3.406763, 15: 3.471827, 16: 3.531983,
      17: 3.587884, 18: 3.640064, 19: 3.688963, 20: 3.73495, 21: 3.778336, 22: 3.819385, 23: 3.858323,
      24: 3.895348, 25: 3.930629,
    };
    for (let n = 2; n <= 25; n++) expect(D2[n]).toBe(Number(integral[n].toFixed(3)));
  });
  test("default matches numpy/scipy (Bissell interval, normal ppm)", () => {
    const r = capability({ data: DEF, lsl: 9.9, usl: 10.1, target: 10, subgroup: 5, confidence: 0.95 });
    if (!r.ok) throw new Error(r.error);
    expect(r.mean).toBeCloseTo(9.997966666666667, 12);
    expect(r.sOverall).toBeCloseTo(0.022938423319134513, 13);
    expect(r.sWithin).toBeCloseTo(0.016122098022356077, 13);
    expect(r.within.p!).toBeCloseTo(2.0675555555555354, 10);
    expect(r.within.k).toBeCloseTo(2.0255152592592394, 10);
    expect(r.within.kLow).toBeCloseTo(1.490764242140723, 10);
    expect(r.within.kHigh).toBeCloseTo(2.5602662763777557, 10);
    expect(Math.abs(r.within.ppm / 0.0007375423128821484 - 1)).toBeLessThan(1e-7); // deep tail: scipy sf vs erfc agree to 1e-8
    expect(r.overall.p!).toBeCloseTo(1.4531658462126118, 10);
    expect(r.overall.k).toBeCloseTo(1.4236181406729553, 10);
    expect(r.overall.kLow).toBeCloseTo(1.0383138922242598, 10);
    expect(r.overall.ppm).toBeCloseTo(14.067114932544621, 9);
    const t = run("qual-capability").text;
    expect(t).toContain("Cpk   2.03");
    expect(t).toContain("Ppk   1.42");
    expect(t).toContain("p = 0.720");
    expect(t).toContain("14.1 ppm");
  });
  test("one-sided USL, individuals, 90 % (oracle)", () => {
    const X = "5.179 5.044 5.01 4.814 4.972 4.965 4.992 4.937 4.996 4.952 4.869 5.088 5.088 5.171 5.005 4.96 4.945 4.845 5.098 4.89 4.881 4.979 5.149 5.024 4.898 4.929 5.063 4.984 4.923 4.977 5.075 5.198 4.876 4.937 4.92 4.758 4.908 4.898 5.112 4.987 4.838 5.065 4.964 4.826 4.94 4.941 4.913 5.003 4.775 4.973";
    const data = X.split(" ").map(Number);
    const r = capability({ data, lsl: null, usl: 5.3, target: null, subgroup: null, confidence: 0.9 });
    if (!r.ok) throw new Error(r.error);
    expect(r.within.p).toBeNull();
    expect(r.overall.k).toBeCloseTo(1.0882241803357733, 10);
    expect(r.overall.kLow).toBeCloseTo(0.8914855155919609, 10);
    expect(r.overall.kHigh).toBeCloseTo(1.2849628450795856, 10);
    expect(r.overall.ppm).toBeCloseTo(547.9534658034909, 7);
    const out = run("qual-capability", { data: X, lsl: "", usl: "5.3", target: "", subgroup: "", conf: "0.90" });
    okOut(out);
    expect(out.text).toContain("not defined (one-sided limit)");
    expect(out.text).toContain("90 % interval");
  });
  test("refuses: no limits, LSL ≥ USL, subgroup mismatch, out-of-table subgroup, constant, overflow", () => {
    refused(run("qual-capability", { lsl: "", usl: "" }), /at least one specification limit/);
    refused(run("qual-capability", { lsl: "10.2", usl: "10.1" }), /greater than the LSL/);
    refused(run("qual-capability", { subgroup: "7" }), /do not split/);
    refused(run("qual-capability", { subgroup: "30", data: Array.from({ length: 60 }, (_, i) => 10 + (i % 7) / 100).join(" ") }), /2 to 25/);
    refused(run("qual-capability", { subgroup: "2.5" }), /whole number/);
    refused(run("qual-capability", { data: "5 5 5 5 5", subgroup: "" }), /same/);
    refused(run("qual-capability", { data: "1e300 -1e300 1e300", subgroup: "" }), /too large/);
    refused(run("qual-capability", { data: "1" }), /at least 2/);
    refused(run("qual-capability", { usl: "abc" }), /not a number/);
  });
  test("100 000 measurements compute and draw (no argument spread over the data)", () => {
    const vals: string[] = [];
    for (let i = 0; i < 100000; i++) vals.push((10 + 0.02 * Math.sin(i * 12.9898) * Math.cos(i * 0.731)).toFixed(4));
    const out = run("qual-capability", { data: vals.join(" "), subgroup: "5" });
    okOut(out);
  });
  test("an incapable process: negative Cpk carries a true minus, ppm stays readable", () => {
    const out = run("qual-capability", { lsl: "10.02", usl: "", target: "", subgroup: "" });
    okOut(out);
    expect(out.text).toMatch(/Ppk {3}−0\.\d+/);
    const far = run("qual-capability", { lsl: "", usl: "11", subgroup: "" });
    okOut(far);
    expect(far.text).toMatch(/expected out of spec {3}(0|below 0\.001) ppm/);
  });
  test("small samples refuse the normality p-value but still compute", () => {
    const out = run("qual-capability", { data: "9.98 10.01 10.03 9.99 10.02 10.00", subgroup: "" });
    okOut(out);
    expect(out.text).toMatch(/Normality: A normality test needs at least 20/);
  });
});

describe("tolerance stack-up", () => {
  test("default matches the hand/numpy result", () => {
    const out = run("qual-tolerance-stack");
    okOut(out);
    const t = out.text;
    expect(t).toContain("Nominal gap        0.500");
    expect(t).toContain("Centred gap        0.530");
    expect(t).toContain("0.530 ±0.260");
    expect(t).toContain("0.530 ±0.129");
    // fix2-eng1: the dimensions are a table block; the share column's header carries the unit.
    expect(t).toContain("Share of RSS variance (%)");
    const tbl = (out.blocks ?? []).find((b) => b.kind === "table");
    expect(tbl && tbl.kind === "table" ? tbl.rows[1][3] : "").toBe("60.2");
    expect(t).toContain("+0.00/−0.06");
  });
  test("engine numbers", () => {
    const r = toleranceStack([
      { name: "a", sign: 1, nominal: 50, plus: 0.1, minus: -0.1 },
      { name: "b", sign: -1, nominal: 20, plus: 0.05, minus: -0.05 },
      { name: "c", sign: -1, nominal: 14, plus: 0.04, minus: -0.04 },
      { name: "d", sign: -1, nominal: 14, plus: 0.04, minus: -0.04 },
      { name: "e", sign: -1, nominal: 1.5, plus: 0, minus: -0.06 },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.nominal).toBeCloseTo(0.5, 12);
    expect(r.centre).toBeCloseTo(0.53, 12);
    expect(r.worst).toBeCloseTo(0.26, 12);
    expect(r.rss).toBeCloseTo(0.12884098726725127, 14);
    expect(r.rows.map((x) => x.share)).toEqual(
      [0.602409638554, 0.150602409639, 0.096385542169, 0.096385542169, 0.05421686747].map((v) => expect.closeTo(v, 11)),
    );
  });
  test("input forms: spaces, names with digits, signed nominal, two-token tolerance, ± variants", () => {
    const t = run("qual-tolerance-stack", { dims: "Bearing 2 + 10.0 ±0.1\nPart 3 −4.0 +0.10 −0.05\nshim − 1 0.02" }).text;
    expect(t).toContain("+ Bearing 2");
    expect(t).toContain("− Part 3");
    expect(t).toContain("− shim");
    // 10 − 4.025 − 1 = 4.975 centred; WC 0.1 + 0.075 + 0.02
    expect(t).toMatch(/Centred gap +4\.975/);
    expect(t).toMatch(/4\.975 ±0\.195/);
  });
  test("an interference (negative gap) prints with a true minus", () => {
    const out = run("qual-tolerance-stack", { dims: "a + 10.00 ±0.05\nb − 10.20 ±0.05", gapMin: "0" });
    okOut(out);
    expect(out.text).toMatch(/Nominal gap +−0\.200/);
    expect(out.text).toMatch(/some assemblies can violate/);
  });
  test("Monte Carlo reuses monteCarlo.ts and agrees with RSS/k", () => {
    const t = run("qual-tolerance-stack", { mc: "on" }).text;
    expect(t).toMatch(/Monte Carlo \(100 000 draws, seed 1\): mean 0\.53\d, σ 0\.04\d+/);
    expect(t).toMatch(/reproduces RSS by construction/);
  });
  test("limits: a stack that can interfere", () => {
    const out = run("qual-tolerance-stack", { gapMin: "0.3", gapMax: "0.7" });
    okOut(out);
    expect(out.text).toMatch(/some assemblies can violate/);
    // σ = 0.128841/3; Φ((0.3 − 0.53)/σ) + Φ((0.53 − 0.7)/σ) = 37.8 ppm (scipy norm.sf)
    expect(out.text).toMatch(/expected outside the limits: 37\.8 ppm/);
  });
  test("refuses: unreadable tolerance, bad k, inverted limits, empty", () => {
    refused(run("qual-tolerance-stack", { dims: "a + 10 tight" }), /tolerance/);
    // Both deviations above nominal is a real (unilateral) tolerance, re-centred.
    expect(run("qual-tolerance-stack", { dims: "a + 10 +0.1/+0.3" }).text).toMatch(/as 10\.20 ±0\.10/);
    refused(run("qual-tolerance-stack", { k: "0" }), /σ multiple/);
    refused(run("qual-tolerance-stack", { gapMin: "1", gapMax: "0.5" }), /larger than the minimum/);
    refused(run("qual-tolerance-stack", { dims: "" }));
    refused(run("qual-tolerance-stack", { dims: "a + −10 0.1" }), /not both/);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL REVIEW, Release B integration: each defect pinned.

/** Deterministic standard normals (LCG + Box–Muller), so the noisy curve is the same every run. */
function normals(n: number, seed = 12345): number[] {
  let s = seed >>> 0;
  const u = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
  const out: number[] = [];
  while (out.length < n) {
    const r = Math.sqrt(-2 * Math.log(u()));
    const t = 2 * Math.PI * u();
    out.push(r * Math.cos(t), r * Math.sin(t));
  }
  return out.slice(0, n);
}

describe("review: tolerance stack never drops a line", () => {
  test("a trailing unit on the first line is read, not skipped as a header", () => {
    const out = run("qual-tolerance-stack", { dims: "Housing + 50.00 ±0.10 mm\nSpacer - 20.00 ±0.05" });
    okOut(out);
    expect(out.text).toContain("2 dimensions");
    expect(out.text).toMatch(/Nominal gap +30\.000/);
    expect(out.text).toContain("Dimensions are in mm");
  });
  test("a unit glued to the nominal, tab-separated", () => {
    const out = run("qual-tolerance-stack", { dims: "Housing\t+\t50mm\t±0.10\nSpacer\t−\t20mm\t±0.05" });
    okOut(out);
    expect(out.text).toContain("2 dimensions");
    expect(out.text).toMatch(/Nominal gap +30\.000/);
  });
  test("e-notation in the tolerance", () => {
    const out = run("qual-tolerance-stack", { dims: "Housing + 50 ±1e-3\nSpacer - 20 ±2e-3" });
    okOut(out);
    expect(out.text).toContain("2 dimensions");
    expect(out.text).toMatch(/30\.0000 ±0\.0030/); // worst case 0.003
  });
  test("a header with no digits is skipped and named; a first line with numbers that does not parse is refused", () => {
    const out = run("qual-tolerance-stack", { dims: "Part\tSign\tNominal\tTol\nHousing\t+\t50.00\t±0.10\nSpacer\t−\t20.00\t±0.05" });
    okOut(out);
    expect(out.text).toContain("2 dimensions");
    expect(out.text).toMatch(/first line \(“Part Sign Nominal Tol”\) was read as a column header/);
    refused(run("qual-tolerance-stack", { dims: "Housing + 50.00 ±0.10 furlongs\nSpacer - 20.00 ±0.05" }), /Line 1/);
  });
  test("mixed units are refused", () => {
    refused(run("qual-tolerance-stack", { dims: "a + 50 ±0.1 mm\nb − 1 ±0.001 in" }), /mixes mm and in/);
  });
  test("tiny tolerances are never printed as zero", () => {
    const out = run("qual-tolerance-stack", { dims: "a + 0.0005 ±4e-7\nb − 0.0001 ±3e-7", gapMin: "" });
    okOut(out);
    expect(out.text).not.toMatch(/±0\.0+(\s|$)/m);
    expect(out.text).toContain("±0.0000004");
    expect(out.text).toMatch(/0\.00039930 to 0\.00040070/); // worst case 0.0004 ± 7×10⁻⁷
    // Past 8 decimals: significant figures, still distinguishing the ends.
    const far = run("qual-tolerance-stack", { dims: "a + 1000 ±1e-9\nb − 1 ±2e-9", gapMin: "" });
    okOut(far);
    expect(far.text).not.toMatch(/±0(\s|$)/m);
    expect(far.text).toMatch(/±3\.0+×10⁻⁹/);
  });
});

describe("review: European and English thousands are never split", () => {
  test("Weibull and capability read 1.234,5 as 1234.5 and say so", () => {
    const w = run("mat-weibull-strength", { data: "1.234,5 1.180,2 998,7 1.050,0 1.111,1 1.302,9" });
    okOut(w);
    expect(w.text).toContain("Weibull strength, 6 specimens");
    expect(w.text).toMatch(/European notation/);
    const c = run("qual-capability", { data: "1.000,02 999,98 1.000,05 1.000,01 999,97 1.000,03", lsl: "999.9", usl: "1000.1", target: "", subgroup: "" });
    okOut(c);
    expect(c.text).toContain("n = 6");
  });
  test("RULE N2: English 1,234.5 (comma and point in one field) is refused by name, never split", () => {
    refused(run("mat-weibull-strength", { data: "1,234.5 1,180.2 998.7 1,050.0 1,111.1" }), /"1,234\.5" has both a decimal point and a comma/);
  });
  test("refused: both forms, a plain decimal point in a European block, a bare 1,234,567", () => {
    refused(run("mat-weibull-strength", { data: "1.234,5 1,180.2 998.7" }), /"1,180\.2" has both a decimal point and a comma/);
    refused(run("mat-weibull-strength", { data: "1.234,5 1180.2 998,7" }), /mixes 1180\.2 and 1\.234,5/);
    // N3: "1,234,567" has only thousands groups, read as 1234567 (never split into 1, 234, 567)
    const th = run("mat-weibull-strength", { data: "1,234,567 1,234,568 1,234,570" });
    okOut(th);
    expect(th.text).toContain("3 specimens");
    expect(th.text).toContain("1.235×10⁶");
  });
  test("tensile and Scherrer tables go through the same reader", () => {
    // Stresses ×10 written the European way ("3.140,0"), strains with decimal commas ("0,0357").
    const euro = (v: number): string => {
      const [i, d] = v.toFixed(1).split(".");
      return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
    };
    const t = TENSILE_ROWS.map(([e, s]) => `${String(e).replace(".", ",")}\t${euro(s * 10)}`).join("\n");
    const out = run("mat-tensile", { data: t });
    okOut(out);
    expect(out.text).toMatch(/European notation/);
    expect(out.text).toContain("Ultimate strength UTS    3140 MPa");
    expect(out.text).toContain("688.8 GPa"); // ten times the default 68.88 GPa
    // an unambiguous decimal comma ("0,25", "28,44") is read as such, with a note
    const sc = run("mat-scherrer", { peaks: "28,44 0,25" });
    okOut(sc);
    expect(sc.text).toContain("34.6 nm");
    expect(sc.text).toMatch(/European notation|decimal/);
  });
});

describe("review: capability with individuals uses the moving range", () => {
  const X =
    "5.179 5.044 5.01 4.814 4.972 4.965 4.992 4.937 4.996 4.952 4.869 5.088 5.088 5.171 5.005 4.96 4.945 4.845 5.098 4.89 4.881 4.979 5.149 5.024 4.898 " +
    "4.929 5.063 4.984 4.923 4.977 5.075 5.198 4.876 4.937 4.92 4.758 4.908 4.898 5.112 4.987 4.838 5.065 4.964 4.826 4.94 4.941 4.913 5.003 4.775 4.973";
  test("σ within = MR̄/1.128 (o5.py numpy oracle)", () => {
    const r = capability({ data: X.split(" ").map(Number), lsl: null, usl: 5.3, target: null, subgroup: null, confidence: 0.95 });
    if (!r.ok) throw new Error(r.error);
    expect(r.sWithin).toBeCloseTo(0.09643218989723558, 13);
    expect(r.within.k).toBeCloseTo(1.138347407129452, 10);
    expect(r.within.ppm).toBeCloseTo(318.8606276482507, 7);
    expect(r.within.k).not.toBe(r.overall.k);
  });
  test("subgroup 1 and blank both say individuals, never 'no subgroup size given'", () => {
    for (const sg of ["", "1"]) {
      const out = run("qual-capability", { data: X, lsl: "", usl: "5.3", target: "", subgroup: sg });
      okOut(out);
      expect(out.text).toMatch(/individuals: average moving range MR̄\/d₂ with d₂ = 1\.128/);
      expect(out.text).not.toMatch(/no subgroup size given/);
      expect(out.text).toContain("Cpk   1.14");
    }
  });
});

describe("review: tensile curvature gate, yield point and the break", () => {
  test("straight but noisy elastic data passes (the old R² gate refused it at R² ≈ 0.987)", () => {
    const z = normals(4000);
    const rows: string[] = [];
    for (let i = 0; i <= 3000; i++) {
      const s = i * 0.1;
      const e = s / 69000 + 0.002 * Math.pow(s / 250, 12);
      rows.push(`${(e * 100).toFixed(7)}\t${(s + 3 * z[i]).toFixed(3)}`);
    }
    const out = run("mat-tensile", { data: rows.join("\n") });
    okOut(out);
    const m = /Young's modulus E +([\d.]+) GPa\s+\(R² = ([\d.]+), (\d+) points\)/.exec(out.text);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(68);
    expect(Number(m![1])).toBeLessThan(70);
    expect(Number(m![2])).toBeLessThan(0.99);
    expect(Number(m![3])).toBeGreaterThan(800);
    expect(out.text).not.toMatch(/Yield drop/);
    expect(out.text).not.toMatch(/No linear elastic region/);
  });
  test("a genuinely curved elastic region withholds everything built on E (RULE T), keeps the rest", () => {
    const rows = Array.from({ length: 60 }, (_, i) => {
      const e = i * 0.0004;
      return `${e * 100}\t${300 * (1 - Math.exp(-e / 0.004))}`;
    }).join("\n");
    const out = run("mat-tensile", { data: rows });
    okOut(out);
    expect(out.text).toMatch(/No linear elastic region: .* slope changes by \d+ %/);
    expect(out.text).toContain("Young's modulus E        not determined (no linear elastic region)");
    expect(out.text).toContain("0.2 % offset yield     not determined (no linear elastic region)");
    expect(out.text).toMatch(/ISO 527-1 takes the modulus as the chord between 0\.05 % and 0\.25 %/);
  });
  const STEEL = ((): [number, number][] => {
    const r: [number, number][] = [];
    for (let s = 0; s <= 300; s += 20) r.push([s / 200000, s]);
    const plateau = [270, 272, 268, 271, 269, 272, 270, 271, 269, 270, 272, 269, 271, 270, 268, 271, 270, 269, 270];
    plateau.forEach((s, i) => r.push([0.002 + i * 0.001, s]));
    for (let k = 1; k <= 16; k++) {
      const e = 0.02 + k * 0.01;
      r.push([e, 270 + 150 * (1 - Math.exp(-(e - 0.02) / 0.04))]);
    }
    r.push([0.2, 410], [0.22, 395], [0.24, 370], [0.25, 352]);
    return r;
  })();
  test("discontinuous yield: ReH, ReL and Ae are reported (ISO 6892-1), offset kept for comparison", () => {
    const r = tensileTest({ strain: STEEL.map((x) => x[0]), stress: STEEL.map((x) => x[1]), offset: 0.002 });
    if (!r.ok) throw new Error(r.error);
    expect(r.yieldDrop).not.toBeNull();
    expect(r.yieldDrop!.upper).toBe(300);
    expect(r.yieldDrop!.lower).toBe(268);
    expect(r.yieldDrop!.elongation).toBeCloseTo(0.02 - 0.0015, 12);
    const out = run("mat-tensile", { data: STEEL.map(([e, s]) => `${e * 100}\t${s}`).join("\n") });
    okOut(out);
    expect(out.text).toContain("Yield drop               upper 300.0 MPa at strain 0.1500 %, lower 268.0 MPa");
    expect(out.text).toContain(
      "(for metals these are ReH and ReL, ISO 6892-1; for plastics ISO 527 reports the yield stress σy at the peak)",
    );
    expect(out.text).toMatch(/Yield-drop elongation +1\.850 %/);
    // offset-based resilience and yield ratio stay; the lower-yield ones are EXTRA lines
    expect(out.text).toContain("(σy²/2E, offset yield)");
    expect(out.text).toContain("Yield ratio σy/UTS");
    expect(out.text).toContain("Resilience from lower");
  });
  test("the continuous default curve reports no yield drop", () => {
    expect(run("mat-tensile").text).not.toMatch(/Yield drop/);
  });
  test("rows after the break are ignored, with a note", () => {
    const rows = [...TENSILE_ROWS.map(([e, s]) => `${e}\t${s}`), "14.1\t3", "14.3\t0.5"].join("\n");
    const out = run("mat-tensile", { data: rows });
    okOut(out);
    expect(out.text).toContain("Elongation at fracture   14.10 % total");
    expect(out.text).toMatch(/The last 2 row\(s\) are below 10 % of the UTS, read as after the break/);
    // a crosshead that returns after the break no longer trips the "strain goes backwards" refusal
    const back = [...TENSILE_ROWS.map(([e, s]) => `${e}\t${s}`), "14.1\t1", "10\t0"].join("\n");
    okOut(run("mat-tensile", { data: back }));
    const r = tensileTest({ strain: [...TENSILE_ROWS.map((x) => x[0] / 100), 0.141], stress: [...TENSILE_ROWS.map((x) => x[1]), 3], offset: 0.002 });
    if (!r.ok) throw new Error(r.error);
    expect(r.rowsUsed).toBe(25);
    expect(r.toughness).toBeCloseTo(40.8860115, 9);
  });
});

// ---------------------------------------------------------------------------
// ROUND-2 REVIEW: regressions introduced by the round-1 fixes, each pinned with
// the reviewer's exact input (scratchpad review-round2/tcases.json, t4/t5, m5–m9, s2).
// PRINCIPLE: a doubtful sub-result never takes the whole report down.

const tab = (rows: [number, number][]): string => rows.map(([e, s]) => `${e}\t${s}`).join("\n");
const fmt5 = (v: number): string => String(Number(v.toPrecision(5)));
const curveOf = (es: number[], f: (e: number) => number): string => es.map((e) => `${fmt5(e)}\t${fmt5(f(e))}`).join("\n");
const range = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

describe("round 2: fracture is only a TERMINAL tail below 10 % of the UTS", () => {
  test("HDPE sparse: necking drop of 24 % is not a break; fracture at 400 %", () => {
    const hdpe = tab([
      [0, 0], [0.25, 2.5], [0.5, 5], [0.75, 7.5], [1, 10], [1.25, 12.5], [1.5, 15], [1.75, 17.5], [2, 20], [4, 23], [6, 24.5],
      [8, 25], [10, 19], [12, 18], [50, 18], [100, 18.2], [200, 18.5], [300, 19], [400, 19.5], [410, 2],
    ]);
    const out = run("mat-tensile", { data: hdpe });
    okOut(out);
    expect(out.text).toContain("Elongation at fracture   400.0 % total");
    expect(out.text).toMatch(/The last 1 row\(s\) are below 10 % of the UTS/);
  });
  test("textbook sparse: the last row (320 MPa after 420) IS the fracture row", () => {
    const g = "0\t0\n0.1\t70\n0.2\t140\n0.3\t200\n0.5\t240\n1\t260\n2\t290\n5\t350\n10\t410\n15\t440\n20\t450\n25\t420\n28\t320";
    const out = run("mat-tensile", { data: g, window: "0-0.2" });
    okOut(out);
    expect(out.text).toContain("Elongation at fracture   28.00 % total");
    expect(out.text).toContain("Young's modulus E        70.00 GPa");
    expect(out.text).not.toMatch(/are below 10 % of the UTS/);
    // automatic window has only 2 rows: still a report (UTS, elongation, toughness), modulus not determined
    const auto = run("mat-tensile", { data: g });
    okOut(auto);
    expect(auto.text).toContain("Ultimate strength UTS    450.0 MPa");
    expect(auto.text).toContain("Elongation at fracture   28.00 % total");
    expect(auto.text).toMatch(/Young's modulus E +not determined/);
  });
});

describe("round 2: yield drop only at the END of the elastic region", () => {
  test("PET-like neck far from the elastic limit is not a yield drop", () => {
    const es = range(0, 4, 21);
    const pet =
      curveOf(es, (x) => (55 * (1 - Math.exp(-x / 1.2))) / (1 - Math.exp(-4 / 1.2))) +
      "\n4.5\t52\n5\t47\n6\t45\n8\t45\n10\t45\n20\t45.5\n50\t46\n100\t48\n150\t52\n200\t58\n250\t64\n300\t70";
    const out = run("mat-tensile", { data: pet });
    okOut(out);
    expect(out.text).not.toMatch(/Yield drop/);
  });
  test("PLC serrations at 2 % strain in aluminium are not a yield drop (4 MPa sawtooth, 10 MPa square)", () => {
    const es = range(0, 20, 2001);
    const base = (e: number): number => Math.min((70000 * e) / 100, 150 + 150 * (1 - Math.exp(-e / 6)));
    for (const saw of [(e: number) => (e > 2 ? -4 * ((e * 10) % 1) : 0), (e: number) => (e > 2 && (e * 5) % 1 < 0.3 ? -10 : 0)]) {
      const out = run("mat-tensile", { data: curveOf(es, (e) => base(e) + saw(e)) });
      okOut(out);
      expect(out.text).not.toMatch(/Yield drop/);
      expect(out.text).toContain("Young's modulus E        70.00 GPa");
    }
  });
  test("a dense steel yield point is still found, worded neutrally, offset values kept", () => {
    const es = range(0, 25, 2501);
    const steel = curveOf(es, (e) => {
      const el = (200000 * e) / 100;
      if (el < 300) return el;
      const ep = e - 0.15;
      return ep < 0.05 ? 300 - (60 * ep) / 0.05 : ep < 2 ? 240 + 3 * Math.sin(ep * 30) : 240 + 180 * (1 - Math.exp(-(ep - 2) / 6));
    });
    const out = run("mat-tensile", { data: steel });
    okOut(out);
    expect(out.text).toMatch(/Yield drop +upper 300\.0 MPa/);
    expect(out.text).toContain("(σy²/2E, offset yield)");
    expect(out.text).toContain("Yield ratio σy/UTS");
  });
});

describe("round 2: curvature is a caveat on the modulus, never a refusal", () => {
  const cases: [string, string][] = [
    ["parabolic σ = 15ε(1 − ε/16)", curveOf(range(0, 8, 81), (e) => ((1500 * e) / 100) * (1 - e / 16))],
    ["PP σ = 34(1 − e^(−ε/2.5))", curveOf(range(0, 12, 49), (e) => 34 * (1 - Math.exp(-e / 2.5)))],
    ["grey iron σ = 200(1 − e^(−ε/0.25))", curveOf(range(0, 0.6, 31), (e) => 200 * (1 - Math.exp(-e / 0.25)))],
  ];
  test.each(cases)("%s reports UTS, elongation and toughness; E-derived values not determined (RULE T)", (_n, data) => {
    const out = run("mat-tensile", { data });
    okOut(out);
    expect(out.text).toContain("Young's modulus E        not determined (no linear elastic region)");
    expect(out.text).toMatch(/plastic not determined \(no linear elastic region\)/);
    expect(out.text).not.toMatch(/MJ\/m³ {3}\(σy²\/2E/);
    expect(out.text).toMatch(/No linear elastic region/);
    expect(out.text).toMatch(/Ultimate strength UTS/);
    expect(out.text).toMatch(/Elongation at fracture/);
    expect(out.text).toMatch(/Toughness \(area\)/);
  });
  test("grey iron numbers: UTS and elongation are the data's, whatever the modulus", () => {
    const t = run("mat-tensile", { data: cases[2][1] }).text;
    expect(t).toContain("Ultimate strength UTS    181.9 MPa   at strain 0.6000 %");
    expect(t).toContain("Elongation at fracture   0.6000 % total");
  });
});

describe("round 2: header rule reads fields, not digits", () => {
  test("tensile headers with digits inside words", () => {
    const body = TENSILE_ROWS.slice(0, 14).map(([e, s]) => `${e}\t${s}`).join("\n");
    for (const h of ["Strain (%)\tStress (N/mm2)", "Specimen 1"]) {
      const out = run("mat-tensile", { data: `${h}\n${body}` });
      okOut(out);
      expect(out.text).toContain("Young's modulus E        69.73 GPa");
      expect(out.text).toMatch(/was read as a (column )?header/);
    }
    const frac = run("mat-tensile", {
      data: "Strain (mm/mm)\tStress (N/mm2)\n0\t0\n0.0005\t100\n0.001\t200\n0.0015\t300\n0.002\t360\n0.004\t400\n0.01\t420\n0.02\t430",
      strainUnit: "frac",
    });
    okOut(frac);
    expect(frac.text).toContain("Ultimate strength UTS    430.0 MPa");
  });
  test("stack headers: 'Tol (3 sigma)' and 'Dim 1-4 per DWG 1234' (tab-separated) are headers", () => {
    for (const h of ["Part\tSign\tNominal\tTol (3 sigma)", "Dim 1-4 per DWG 1234"]) {
      const out = run("qual-tolerance-stack", { dims: `${h}\nA\t+\t50.00\t±0.10\nB\t-\t20.00\t±0.05` });
      okOut(out);
      expect(out.text).toContain("2 dimensions");
      expect(out.text).toMatch(/Nominal gap +30\.000/);
    }
    // round-1 fix stays: a first line with numbers that does not parse is refused, never dropped
    refused(run("qual-tolerance-stack", { dims: "Housing + 50.00 ±0.10 furlongs\nSpacer - 20.00 ±0.05" }), /Line 1/);
  });
  test("list headers: 'Run #3 diameters' and 'Diameter (mm)' are headers; 'Sample 1' is refused by line (RULE N4)", () => {
    const a = run("mat-weibull-strength", { data: "Run #3 diameters\n9.98 10.01 10.02 9.97 10.00" });
    okOut(a);
    expect(a.text).toContain("5 specimens");
    refused(
      run("qual-capability", { data: "Sample 1\n9.98 10.01 10.02 9.97 10.00 10.03 9.99 10.01 9.98 10.02", subgroup: "" }),
      /line 1 \("Sample 1"\) mixes words and numbers/,
    );
    const c = run("mat-weibull-strength", { data: "Diameter (mm)\n9,98\n10,01\n10,02\n9,97\n10,00" });
    okOut(c);
    expect(c.text).toContain("5 specimens");
    expect(c.text).toMatch(/European notation|decimal/);
  });
  test("decimal-comma tensile tables (tab or semicolon) read; a comma separator between dot-decimals splits", () => {
    const rows = TENSILE_ROWS.slice(0, 13);
    const semi = rows.map(([e, s]) => `${String(e).replace(".", ",")};${s}`).join("\n");
    const o1 = run("mat-tensile", { data: semi });
    okOut(o1);
    expect(o1.text).toContain("69.73 GPa");
    // (the reviewer's m5 input, strains to 4 decimals: "0.2240,150")
    const commaSep = rows.map(([e, s]) => `${e === 0 ? "0" : e.toFixed(4)},${s}`).join("\n");
    const o2 = run("mat-tensile", { data: commaSep });
    okOut(o2);
    expect(o2.text).toContain("69.73 GPa");
  });
});

describe("round 2: sorted or trending capability data is flagged", () => {
  test("sorted 9.90 … 10.10: MR̄ σ is a fraction of s, the note says so and Ppk is shown", () => {
    const out = run("qual-capability", { data: "9.90 9.92 9.94 9.96 9.98 10.00 10.02 10.04 10.06 10.08 10.10", subgroup: "" });
    okOut(out);
    expect(out.text).toMatch(
      /σ within from moving ranges is much smaller than σ overall \(0\.27 of it\): either the data are sorted or the process shifts/,
    );
    expect(out.text).not.toMatch(/production order/);
    expect(out.text).toContain("Cpk   1.88");
    expect(out.text).toMatch(/Ppk {3}0\.503/);
  });
  test("production-order data carries no such note", () => {
    const out = run("qual-capability", { data: "9.98 10.01 10.02 9.97 10.00 10.03 9.99 10.01 9.98 10.02", subgroup: "" });
    okOut(out);
    expect(out.text).not.toMatch(/much smaller than σ overall|run monotonically/);
  });
});

describe("round 2: round-1 cases stay fixed", () => {
  test("stack, European numbers, individuals, noisy aluminium, steel yield point, break tail", () => {
    expect(run("qual-tolerance-stack", { dims: "Housing + 50.00 ±0.10 mm\nSpacer - 20.00 ±0.05" }).text).toContain("2 dimensions");
    expect(run("qual-tolerance-stack", { dims: "Housing\t+\t50mm\t±0.10\nSpacer\t−\t20mm\t±0.05" }).text).toContain("2 dimensions");
    expect(run("qual-tolerance-stack", { dims: "Housing + 50 ±1e-3\nSpacer - 20 ±2e-3" }).text).toContain("2 dimensions");
    expect(run("mat-weibull-strength", { data: "1.234,5 1.180,2 998,7 1.050,0 1.111,1 1.302,9" }).text).toContain("6 specimens");
    expect(run("qual-tolerance-stack", { dims: "A\t+\t50.00\t±1e-9\nB\t-\t20.00\t±0.05" }).text).not.toMatch(/±0(\.0+)?(\s|$)/m);
    const eu = run("qual-tolerance-stack", { dims: "Housing\t+\t1.000,50\t±0,10\nSpacer\t-\t20,00\t±0,05" });
    okOut(eu);
    expect(eu.text).toMatch(/Nominal gap +980\.500/);
  });
});

// ---------------------------------------------------------------------------
// CUMULATIVE GATE (relB-round3-rules.md): every reviewer probe for these tools
// from rounds 1–3 (scratchpad review-films-materials\, review-round2\,
// review-round3\), input → intended outcome. Large curves are regenerated from
// the reviewers' own generator formulas (ported verbatim); small inputs are
// literal. A row may only change on a deliberate rule change.

type Expect = { refused: RegExp } | { has: (string | RegExp)[]; hasNot?: (string | RegExp)[] };
interface GateCase {
  name: string;
  id: string;
  over: Record<string, string>;
  expect: Expect;
}
const WITHHELD = "Young's modulus E        not determined (no linear elastic region)";
const NO_NEG_PLASTIC = /−\d[\d.]* % plastic/;

/** m4/m4x/cu.json: Ramberg–Osgood ε = σ/E + 0.002(σ/σ0.2)ⁿ to the UTS, then a 49-row decline. Strain in %. */
function roCurve(E: number, sy: number, n: number, uts: number, step: number): string {
  const rows: string[] = [];
  let last = 0;
  for (let sv = 0; sv <= uts; sv += step) {
    last = sv / E + 0.002 * Math.pow(sv / sy, n);
    rows.push(`${last * 100}\t${sv}`);
  }
  for (let k = 1; k < 50; k++) rows.push(`${(last + k * 0.002) * 100}\t${uts - k * 0.5}`);
  return rows.join("\n");
}
/** review-films-materials m1.js: mild steel with a yield point; seeded noise and an optional seating toe (shared LCG, seed 7). */
function m1Steel(): string[] {
  let rng = 7;
  const rnd = (): number => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out: string[] = [];
  for (const [noise, toe] of [[0, 0], [2, 0], [5, 0], [2, 0.0003]]) {
    const rows: string[] = [];
    for (let i = 0; i <= 3000; i++) {
      const x = i * 0.0001;
      let y: number;
      if (x <= 0.0015) y = 200000 * x;
      else if (x <= 0.0017) y = 300 - ((x - 0.0015) / 0.0002) * 30;
      else if (x <= 0.02) y = 270 + 3 * Math.sin(x * 3000);
      else if (x <= 0.2) y = 270 + 150 * (1 - Math.pow(1 - (x - 0.02) / 0.18, 2));
      else y = 420 - 2000 * (x - 0.2) ** 2;
      const xe = toe ? x + toe * Math.exp(-x / 0.0002) : x;
      rows.push(`${xe * 100}\t${y + noise * gauss()}`);
    }
    out.push(rows.join("\n"));
  }
  return out;
}
/** review-round2 gen.py F_steel_yieldpoint (= review-round3 st.json steel_toe0). */
const F_STEEL = curveOf(range(0, 25, 2501), (e) => {
  const el = (200000 * e) / 100;
  if (el < 300) return el;
  const ep = e - 0.15;
  return ep < 0.05 ? 300 - (60 * ep) / 0.05 : ep < 2 ? 240 + 3 * Math.sin(ep * 30) : 240 + 180 * (1 - Math.exp(-(ep - 2) / 6));
});
const M1 = m1Steel();
const SPARSE_HDPE = "0\t0\n0.5\t5\n1\t9.5\n1.5\t13\n2\t15.5\n3\t18.5\n4\t20.5\n6\t23\n8\t24.5\n10\t25\n15\t18\n20\t17.5\n50\t17.6\n100\t17.8\n200\t18\n300\t18.3\n400\t18.6\n500\t19";
const TEXTBOOK = "0\t0\n0.1\t70\n0.2\t140\n0.3\t200\n0.5\t240\n1\t260\n2\t290\n5\t350\n10\t410\n15\t440\n20\t450\n25\t420\n28\t320";
const DEF_ROWS = TENSILE_ROWS.map(([e, s]) => [e, s] as const);

const GATE: GateCase[] = [
  // ---- round 1: tensile (m1, m3, m4, m6, s1) ----
  { name: "r1 m1 steel, no noise", id: "mat-tensile", over: { data: M1[0] }, expect: { has: ["Young's modulus E        200.0 GPa", /Yield drop +upper 300\.0 MPa/] } },
  { name: "r1 m1 steel, noise 2", id: "mat-tensile", over: { data: M1[1] }, expect: { has: [/Yield drop +upper 299\.9 MPa/] } },
  { name: "r1 m1 steel, noise 5 (6-point window)", id: "mat-tensile", over: { data: M1[2] }, expect: { has: [WITHHELD, "Ultimate strength UTS"] } },
  { name: "r1 m1 steel, noise 2 + seating toe", id: "mat-tensile", over: { data: M1[3] }, expect: { has: [WITHHELD] } },
  { name: "r1 m3 psi", id: "mat-tensile", over: { data: DEF_ROWS.map(([e, s]) => `${e}\t${s / 6.894757293168361e-3}`).join("\n"), stressUnit: "psi" }, expect: { has: ["0.2 % offset yield     30240 psi"] } },
  { name: "r1 m3 ksi", id: "mat-tensile", over: { data: DEF_ROWS.map(([e, s]) => `${e}\t${s / 6.894757293168361}`).join("\n"), stressUnit: "ksi" }, expect: { has: ["0.2 % offset yield     30.24 ksi"] } },
  { name: "r1 m3 GPa", id: "mat-tensile", over: { data: DEF_ROWS.map(([e, s]) => `${e}\t${s * 1e-3}`).join("\n"), stressUnit: "GPa" }, expect: { has: ["0.2 % offset yield     0.2085 GPa"] } },
  { name: "r1 m3 mm/mm", id: "mat-tensile", over: { data: DEF_ROWS.map(([e, s]) => `${e / 100}\t${s}`).join("\n"), strainUnit: "frac" }, expect: { has: ["0.2 % offset yield     208.5 MPa"] } },
  { name: "r1 m3 extension/load kN mm", id: "mat-tensile", over: { mode: "le", data: "ext\tload\n" + DEF_ROWS.map(([e, s]) => `${(e / 100) * 50}\t${(s * 78.54) / 1000}`).join("\n") }, expect: { has: ["0.2 % offset yield     208.5 MPa"] } },
  { name: "r1 m4 Cu annealed (RO n 5)", id: "mat-tensile", over: { data: roCurve(117000, 70, 5, 220, 0.5) }, expect: { has: [WITHHELD, "Ultimate strength UTS    220.0 MPa"], hasNot: [/offset yield +\d/] } },
  { name: "r1 m4 304 SS (RO n 6)", id: "mat-tensile", over: { data: roCurve(193000, 250, 6, 600, 0.5) }, expect: { has: [WITHHELD], hasNot: [/offset yield +\d/] } },
  { name: "r1 m4 Cu n 8", id: "mat-tensile", over: { data: roCurve(117000, 70, 8, 220, 0.5) }, expect: { has: [WITHHELD] } },
  { name: "r1 m4 Al 6061 (RO n 20)", id: "mat-tensile", over: { data: roCurve(69000, 276, 20, 310, 0.5) }, expect: { has: ["Young's modulus E        69.00 GPa", "0.2 % offset yield     276.0 MPa"] } },
  { name: "r1 m4 mild-ish (RO n 10)", id: "mat-tensile", over: { data: roCurve(200000, 250, 10, 420, 0.5) }, expect: { has: [WITHHELD] } },
  { name: "r1 s1 offset 0", id: "mat-tensile", over: { offset: "0" }, expect: { has: ["0 % offset yield     114.2 MPa"] } },
  { name: "r1 s1 offset 5", id: "mat-tensile", over: { offset: "5" }, expect: { has: ["5 % offset yield     300.2 MPa"] } },
  { name: "r1 s1 window en dash", id: "mat-tensile", over: { window: "0.05–0.15" }, expect: { has: ["Young's modulus E        69.73 GPa"] } },
  { name: "r1 s1 window hyphen", id: "mat-tensile", over: { window: "0.05-0.2" }, expect: { has: ["Young's modulus E        68.88 GPa"] } },
  // ---- round 1: capability, stack, Scherrer, Weibull (s1, s2) ----
  { name: "r1 s1 cap one-sided LSL", id: "qual-capability", over: { usl: "" }, expect: { has: ["Cpk   2.03"] } },
  { name: "r1 s1 cap one-sided USL", id: "qual-capability", over: { lsl: "" }, expect: { has: ["Cpk   2.11"] } },
  { name: "r1 s1 cap subgroup 4 of 30", id: "qual-capability", over: { subgroup: "4" }, expect: { refused: /do not split into subgroups of 4/ } },
  { name: "r1 s1 cap subgroup 1", id: "qual-capability", over: { subgroup: "1" }, expect: { has: [/individuals: average moving range/, "Cpk   1.70"] } },
  { name: "r1 s1 cap tiny values", id: "qual-capability", over: { data: "1e-9 2e-9 3e-9 2.5e-9 1.5e-9", lsl: "0", usl: "5e-9", subgroup: "" }, expect: { has: ["Cpk   0.859"] } },
  { name: "r1 s1 cap 10⁹ values", id: "qual-capability", over: { data: "1e9 1.000001e9 1.000002e9 0.999999e9", lsl: "0.99e9", usl: "1.01e9", subgroup: "2" }, expect: { has: ["Cpk   1880"] } },
  { name: "r1 s1 cap negative Cpk", id: "qual-capability", over: { lsl: "10.05", usl: "10.1" }, expect: { has: ["Cpk   −1.08"] } },
  { name: "r1 s1 cap negative values, default subgroup 5", id: "qual-capability", over: { lsl: "-5", usl: "-1", data: "-3 -2.5 -3.5 -2.9 -3.1 -3.0" }, expect: { refused: /do not split into subgroups of 5/ } },
  { name: "r1 s1 cap CRLF + header", id: "qual-capability", over: { data: "value\r\n9.9\r\n10.1\r\n10.0\r\n\r\n", subgroup: "" }, expect: { has: ["n = 3", /read as a (column )?header/] } },
  { name: "r1 s1 cap subgroup 2.5", id: "qual-capability", over: { subgroup: "2.5" }, expect: { refused: /whole number from 2 to 25/ } },
  { name: "r1 s1 stack default", id: "qual-tolerance-stack", over: {}, expect: { has: ["0.530 ±0.129"] } },
  { name: "r1 s1 stack mc limits", id: "qual-tolerance-stack", over: { gapMin: "0.3", gapMax: "0.6", mc: "on" }, expect: { has: [/some assemblies can violate/, /Monte Carlo \(100 000 draws/] } },
  { name: "r1 s1 stack +0.1/0.05", id: "qual-tolerance-stack", over: { dims: "A + 10 +0.1/0.05\nB - 5 ±0.02" }, expect: { has: ["5.075 ±0.045"] } },
  { name: "r1 s1 stack 10⁻⁶ dims", id: "qual-tolerance-stack", over: { dims: "A\t+\t1e-6\t±1e-7\nB\t−\t5e-7\t±1e-8" }, expect: { has: ["5.000×10⁻⁷ ±1.100×10⁻⁷"] } },
  { name: "r1 s1 stack zero tolerance", id: "qual-tolerance-stack", over: { dims: "A + 10 0\nB - 5 0", gapMin: "5" }, expect: { has: ["Worst case         5.0 ±0.0"] } },
  { name: "r1 s1 stack signed nominals", id: "qual-tolerance-stack", over: { dims: "Shaft -10 ±0.1\nHole 10.2 +0.05/-0.0" }, expect: { has: ["0.225 ±0.125"] } },
  { name: "r1 s1 stack names with digits", id: "qual-tolerance-stack", over: { dims: "Bearing 2 + 14.00 ±0.04\nBolt M8 - 8 ±0.1" }, expect: { has: ["6.000 ±0.140", "+ Bearing 2", "− Bolt M8"] } },
  { name: "r1 s1 stack 10⁸ nominal", id: "qual-tolerance-stack", over: { dims: "A + 100000000 ±0.1" }, expect: { has: ["100000000.00 ±0.10"] } },
  { name: "r1 s2 trailing mm, 3 lines", id: "qual-tolerance-stack", over: { dims: "Housing + 50.00 ±0.10 mm\nSpacer - 20.00 ±0.05\nClip - 1.5 ±0.02", gapMin: "" }, expect: { has: ["3 dimensions", "28.500 ±0.170"] } },
  { name: "r1 s2 ±1e-3", id: "qual-tolerance-stack", over: { dims: "Housing + 50 ±1e-3\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.0000 ±0.0510"] } },
  { name: "r1 s2 '± 0.10'", id: "qual-tolerance-stack", over: { dims: "Housing + 50.00 ± 0.10\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.000 ±0.150"] } },
  { name: "r1 s2 '+/-0.10'", id: "qual-tolerance-stack", over: { dims: "Housing + 50.00 +/-0.10\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.000 ±0.150"] } },
  { name: "r1 s2 '0.1/-0.05'", id: "qual-tolerance-stack", over: { dims: "Housing + 50.00 0.1/-0.05\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.025 ±0.125"] } },
  { name: "r1 s2 '−0.05/+0.10'", id: "qual-tolerance-stack", over: { dims: "Housing + 50 −0.05/+0.10\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.025 ±0.125"] } },
  { name: "r1 s2 '±.1'", id: "qual-tolerance-stack", over: { dims: "Housing + 50 ±.1\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.000 ±0.150"] } },
  { name: "r1 s2 '+0.1 -0.05'", id: "qual-tolerance-stack", over: { dims: "Housing + 50 +0.1 -0.05\nSpacer - 20 ±0.05", gapMin: "" }, expect: { has: ["30.025 ±0.125"] } },
  { name: "r1 s1 Scherrer no instrument", id: "mat-scherrer", over: { inst: "" }, expect: { has: ["32.8 nm", "Size D                  42.8 nm"] } },
  { name: "r1 s1 Scherrer Lorentzian", id: "mat-scherrer", over: { mode: "lorentz" }, expect: { has: ["48.2 nm"] } },
  { name: "r1 s1 Scherrer FWHM 10⁻⁴ is beyond range", id: "mat-scherrer", over: { peaks: "28.44 0.0001", inst: "" }, expect: { has: ["> 200 nm (beyond the method's range)"], hasNot: ["82000 nm"] } },
  { name: "r1 s1 Scherrer equal FWHM", id: "mat-scherrer", over: { peaks: "28.44 0.25\n47.3 0.25\n56.12 0.25" }, expect: { has: ["Size D                  31.5 nm"] } },
  { name: "r1 s1 Scherrer λ in nm", id: "mat-scherrer", over: { lambda: "custom", lambdaCustom: "0.15406 nm" }, expect: { has: ["34.6 nm"] } },
  { name: "r1 s1 Scherrer 179.9°", id: "mat-scherrer", over: { peaks: "179.9 19", inst: "" }, expect: { has: ["> 200 nm (beyond the method's range)"], hasNot: ["479 nm"] } },
  { name: "r1 s1 Scherrer header + inst column", id: "mat-scherrer", over: { peaks: "2θ\tFWHM\n28.44\t0.25\t0.05" }, expect: { has: ["33.5 nm", /read as a (column )?header/] } },
  { name: "r1 s1 Weibull at 300", id: "mat-weibull-strength", over: { at: "300" }, expect: { has: ["Weibull modulus m          9.443"] } },
  { name: "r1 s1 Weibull 10⁻⁶", id: "mat-weibull-strength", over: { data: "1e-6 2e-6 3e-6", at: "1e-7" }, expect: { has: ["Weibull modulus m          2.739"] } },
  { name: "r1 s1 Weibull near-equal", id: "mat-weibull-strength", over: { data: "100 100.0001 100.0002", at: "99" }, expect: { has: ["3 specimens"] } },
  { name: "r1 s1 Weibull 10²⁰⁰", id: "mat-weibull-strength", over: { data: "1e200 2e200 3e200" }, expect: { has: ["2.259×10²⁰⁰"] } },
  // ---- round 2 ----
  { name: "r2 A HDPE sparse", id: "mat-tensile", over: { data: SPARSE_HDPE }, expect: { has: ["Elongation at fracture   500.0 % total", "Young's modulus E        not determined (no elastic region fitted)"] } },
  { name: "r2 A HDPE sparse, window 0–2", id: "mat-tensile", over: { data: SPARSE_HDPE, window: "0-2" }, expect: { has: [WITHHELD, "Elongation at fracture   500.0 % total"] } },
  { name: "r2 B PET (neck, harden)", id: "mat-tensile", over: { data: curveOf(range(0, 4, 21), (x) => (55 * (1 - Math.exp(-x / 1.2))) / (1 - Math.exp(-4 / 1.2))) + "\n4.5\t52\n5\t47\n6\t45\n8\t45\n10\t45\n20\t45.5\n50\t46\n100\t48\n150\t52\n200\t58\n250\t64\n300\t70" }, expect: { has: [WITHHELD, "Ultimate strength UTS    70.00 MPa"], hasNot: [/Yield drop/] } },
  { name: "r2 C PP curved", id: "mat-tensile", over: { data: curveOf(range(0, 12, 49), (e) => 34 * (1 - Math.exp(-e / 2.5))) }, expect: { has: [WITHHELD] } },
  { name: "r2 C2 parabolic", id: "mat-tensile", over: { data: curveOf(range(0, 8, 81), (e) => ((1500 * e) / 100) * (1 - e / 16)) }, expect: { has: [WITHHELD, "Ultimate strength UTS    60.00 MPa"] } },
  { name: "r2 D PLC 4 MPa sawtooth", id: "mat-tensile", over: { data: curveOf(range(0, 20, 2001), (e) => Math.min((70000 * e) / 100, 150 + 150 * (1 - Math.exp(-e / 6))) + (e > 2 ? -4 * ((e * 10) % 1) : 0)) }, expect: { has: ["Young's modulus E        70.00 GPa", "0.2 % offset yield     160.3 MPa"], hasNot: [/Yield drop/] } },
  { name: "r2 D PLC 10 MPa square", id: "mat-tensile", over: { data: curveOf(range(0, 20, 2001), (e) => Math.min((70000 * e) / 100, 150 + 150 * (1 - Math.exp(-e / 6))) + (e > 2 && (e * 5) % 1 < 0.3 ? -10 : 0)) }, expect: { has: ["Young's modulus E        70.00 GPa"], hasNot: [/Yield drop/] } },
  { name: "r2 E noisy sparse steel", id: "mat-tensile", over: { data: "0\t0\n0.02\t42.465\n0.04\t80.991\n0.06\t116.09\n0.08\t162.72\n0.1\t201.34\n0.12\t238.39\n0.15\t252.49\n0.2\t253.33\n0.3\t256.04\n0.5\t260.92\n1\t275.72\n2\t294.7\n4\t330.41\n8\t367.5\n12\t387.84\n16\t393.85\n20\t396.31" }, expect: { has: ["Young's modulus E        184.1 GPa", "0.2 % offset yield     256.9 MPa"] } },
  { name: "r2 F steel yield point (= r3 steel_toe0)", id: "mat-tensile", over: { data: F_STEEL }, expect: { has: [/Yield drop +upper 300\.0 MPa/, "(for comparison)"] } },
  { name: "r2 G textbook, automatic window", id: "mat-tensile", over: { data: TEXTBOOK }, expect: { has: ["Elongation at fracture   28.00 % total", "Ultimate strength UTS    450.0 MPa"] } },
  { name: "r2 G textbook, window 0–0.2", id: "mat-tensile", over: { data: TEXTBOOK, window: "0-0.2" }, expect: { has: ["Young's modulus E        70.00 GPa", "Elongation at fracture   28.00 % total, 27.54 % plastic"] } },
  { name: "r2 H aluminium dense", id: "mat-tensile", over: { data: curveOf(range(0, 15, 1501), (e) => Math.min((70000 * e) / 100, 270 + 60 * (1 - Math.exp(-Math.max(e - 0.4, 0) / 3))) - (e > 13 ? (e - 13) ** 2 * 20 : 0)) }, expect: { has: ["Young's modulus E        70.00 GPa", "0.2 % offset yield     273.7 MPa"] } },
  { name: "r2 J grey iron", id: "mat-tensile", over: { data: curveOf(range(0, 0.6, 31), (e) => 200 * (1 - Math.exp(-e / 0.25))) }, expect: { has: [WITHHELD, "Ultimate strength UTS    181.9 MPa"] } },
  { name: "r2 K seating toe then linear", id: "mat-tensile", over: { data: curveOf(range(0, 2, 41), (e) => Math.min(e < 0.1 ? (2000 * e * e) / 0.2 : 1000 * (e - 0.05), 1200)) }, expect: { has: ["Young's modulus E        100.0 GPa"] } },
  { name: "r2 t5 HDPE terminal tail", id: "mat-tensile", over: { data: "0\t0\n0.25\t2.5\n0.5\t5\n0.75\t7.5\n1\t10\n1.25\t12.5\n1.5\t15\n1.75\t17.5\n2\t20\n4\t23\n6\t24.5\n8\t25\n10\t19\n12\t18\n50\t18\n100\t18.2\n200\t18.5\n300\t19\n400\t19.5\n410\t2" }, expect: { has: ["Elongation at fracture   400.0 % total", /The last 1 row\(s\) are below 10 % of the UTS/] } },
  { name: "r2 m5 header N/mm2, mm/mm", id: "mat-tensile", over: { data: "Strain (mm/mm)\tStress (N/mm2)\n0\t0\n0.0005\t100\n0.001\t200\n0.0015\t300\n0.002\t360\n0.004\t400\n0.01\t420\n0.02\t430", strainUnit: "frac" }, expect: { has: [/read as a (column )?header/, "Ultimate strength UTS    430.0 MPa", "only 1 row falls"] } },
  { name: "r2 m5 decimal commas, tabs", id: "mat-tensile", over: { data: "strain %\tstress MPa\n0\t0\n0,0357\t25\n0,0714\t50\n0,1072\t75\n0,1431\t100\n0,1804\t125\n0,2240\t150\n0,2888\t175\n0,4146\t200\n0,6183\t220\n0,8861\t235\n1,3177\t250\n1,8391\t262" }, expect: { has: ["Young's modulus E        69.73 GPa"] } },
  { name: "r2 m5 comma separator", id: "mat-tensile", over: { data: "0,0\n0.0357,25\n0.0714,50\n0.1072,75\n0.1431,100\n0.1804,125\n0.2240,150\n0.2888,175\n0.4146,200\n0.6183,220\n0.8861,235\n1.3177,250\n1.8391,262" }, expect: { has: ["Young's modulus E        69.73 GPa"] } },
  { name: "r2 m5 semicolons + decimal commas", id: "mat-tensile", over: { data: "0;0\n0,0357;25\n0,0714;50\n0,1072;75\n0,1431;100\n0,1804;125\n0,2240;150\n0,2888;175\n0,4146;200\n0,6183;220\n0,8861;235\n1,3177;250\n1,8391;262" }, expect: { has: ["Young's modulus E        69.73 GPa"] } },
  { name: "r2 m5 outlier 1,000.5 (RULE N2 refuses the mixed marks)", id: "mat-tensile", over: { data: "0 0\n0.0357 25\n0.0714 50\n0.1072 75\n0.1431 100\n0.1804 125\n0.2240 150\n0.2888 175\n0.4146 200\n0.6183 220\n0.8861 235\n1.3177 250\n1.8391 262\n2.5 1,000.5" }, expect: { refused: /"1,000\.5" has both a decimal point and a comma/ } },
  { name: "r2 m7 header (N/mm2)", id: "mat-tensile", over: { data: "Strain (%)\tStress (N/mm2)\n0\t0\n0.0357\t25\n0.0714\t50\n0.1072\t75\n0.1431\t100\n0.1804\t125\n0.2240\t150\n0.2888\t175\n0.4146\t200\n0.6183\t220\n0.8861\t235\n1.3177\t250\n1.8391\t262\n2.4406\t272" }, expect: { has: ["Young's modulus E        69.73 GPa", /read as a (column )?header/] } },
  { name: "r2 m7 'Specimen 1' alone on a tab-separated block (one non-numeric field)", id: "mat-tensile", over: { data: "Specimen 1\n0\t0\n0.0357\t25\n0.0714\t50\n0.1072\t75\n0.1431\t100\n0.1804\t125\n0.2240\t150\n0.2888\t175\n0.4146\t200\n0.6183\t220\n0.8861\t235\n1.3177\t250\n1.8391\t262\n2.4406\t272" }, expect: { has: ["Young's modulus E        69.73 GPa"] } },
  { name: "r2 m6 'Sample 1' (space-separated)", id: "qual-capability", over: { data: "Sample 1\n9.98 10.01 10.02 9.97 10.00 10.03 9.99 10.01 9.98 10.02" }, expect: { refused: /line 1 \("Sample 1"\) mixes words and numbers/ } },
  { name: "r2 m6 'Run #3 diameters'", id: "mat-weibull-strength", over: { data: "Run #3 diameters\n9.98 10.01 10.02 9.97 10.00" }, expect: { has: ["5 specimens"] } },
  { name: "r2 m6 'Diameter (mm)' + decimal commas", id: "mat-weibull-strength", over: { data: "Diameter (mm)\n9,98\n10,01\n10,02\n9,97\n10,00" }, expect: { has: ["5 specimens", /European notation|decimal/] } },
  { name: "r2 m6 European 1.000,5", id: "mat-weibull-strength", over: { data: "1.000,5 1.001,2 999,8 1.000,1 1.000,0" }, expect: { has: ["5 specimens", "1001 MPa"] } },
  { name: "r2 m6 bare commas", id: "mat-weibull-strength", over: { data: "9.98,10.01,10.02,9.97,10.00" }, expect: { has: ["5 specimens"] } },
  { name: "r2 m8 'Run 3' refused", id: "qual-capability", over: { data: "Run 3\n9.98 10.01 10.02 9.97 10.00 10.03 9.99 10.01 9.98 10.02", subgroup: "5" }, expect: { refused: /line 1 \("Run 3"\) mixes words and numbers/ } },
  { name: "r2 m8 individuals", id: "qual-capability", over: { data: "9.98 10.01 10.02 9.97 10.00 10.03 9.99 10.01 9.98 10.02", subgroup: "" }, expect: { has: ["Cpk   1.20", "Ppk   1.63"] } },
  { name: "r2 m8 sorted", id: "qual-capability", over: { data: "9.90 9.92 9.94 9.96 9.98 10.00 10.02 10.04 10.06 10.08 10.10", subgroup: "" }, expect: { has: ["Ppk   0.503", /much smaller than σ overall/] } },
  { name: "r2 m9 header 'Tol (3 sigma)'", id: "qual-tolerance-stack", over: { dims: "Part\tSign\tNominal\tTol (3 sigma)\nA\t+\t50.00\t±0.10\nB\t-\t20.00\t±0.05" }, expect: { has: ["2 dimensions", /read as a (column )?header/] } },
  { name: "r2 m9 header 'Dim 1-4 per DWG 1234'", id: "qual-tolerance-stack", over: { dims: "Dim 1-4 per DWG 1234\nA\t+\t50.00\t±0.10\nB\t-\t20.00\t±0.05" }, expect: { has: ["2 dimensions", /read as a (column )?header/] } },
  { name: "r2 m9 trailing mm", id: "qual-tolerance-stack", over: { dims: "A + 50.00 ±0.10 mm\nB - 20.00 ±0.05 mm" }, expect: { has: ["2 dimensions", "Dimensions are in mm"] } },
  { name: "r2 m9 ±0.0001", id: "qual-tolerance-stack", over: { dims: "A\t+\t50.000\t±0.0001\nB\t-\t20.00\t±0.05" }, expect: { has: ["30.00000 ±0.05010"] } },
  { name: "r2 s2 ±1e-9", id: "qual-tolerance-stack", over: { dims: "A\t+\t50.00\t±1e-9\nB\t-\t20.00\t±0.05" }, expect: { has: ["2 dimensions"], hasNot: [/±0(\.0+)?(\s|$)/m] } },
  { name: "r2 s2 10⁻⁹ dimensions", id: "qual-tolerance-stack", over: { dims: "A\t+\t0.000000015\t±0.000000001\nB\t-\t0.00000001\t±0.000000001", gapMin: "" }, expect: { has: ["5.000×10⁻⁹ ±2.000×10⁻⁹"] } },
  { name: "r2 s2 European stack", id: "qual-tolerance-stack", over: { dims: "Housing\t+\t1.000,50\t±0,10\nSpacer\t-\t20,00\t±0,05" }, expect: { has: ["980.500 ±0.150"] } },
  { name: "r2 s2 bare and asymmetric tolerances", id: "qual-tolerance-stack", over: { dims: "A + 50.1 0.1\nB - 20.25 +0.1/-0.05" }, expect: { has: ["29.825 ±0.175"] } },
  // ---- round 3 ----
  { name: "r3 cu.json Cu annealed (RO, step 2)", id: "mat-tensile", over: { data: roCurve(117000, 70, 5, 220, 2) }, expect: { has: [WITHHELD], hasNot: [/offset yield +\d/, /GPa {3}\(R²/] } },
  { name: "r3 cu.json Cu n 8", id: "mat-tensile", over: { data: roCurve(117000, 70, 8, 220, 2) }, expect: { has: [WITHHELD] } },
  { name: "r3 J-curve σ = 0.05ε²", id: "mat-tensile", over: { data: curveOf(range(0, 30, 61), (e) => 0.05 * e * e) }, expect: { has: [WITHHELD, "Ultimate strength UTS    45.00 MPa"], hasNot: [NO_NEG_PLASTIC, /offset yield +\d/] } },
  { name: "r3 J-curve exponential", id: "mat-tensile", over: { data: "0\t0\n2\t0.016657\n4\t0.034702\n6\t0.05425\n8\t0.075426\n10\t0.098365\n12\t0.12321\n14\t0.15013\n16\t0.1793\n18\t0.21089\n20\t0.24511\n22\t0.28218\n24\t0.32234\n26\t0.36584\n28\t0.41297\n30\t0.46402\n32\t0.51933\n34\t0.57924\n36\t0.64414\n38\t0.71445\n40\t0.79061\n42\t0.87311\n44\t0.96249\n46\t1.0593\n48\t1.1642\n50\t1.2778\n52\t1.4009\n54\t1.5342\n56\t1.6787\n58\t1.8351\n60\t2.0046\n62\t2.1883\n64\t2.3872\n66\t2.6026\n68\t2.8361\n70\t3.0889\n72\t3.3629\n74\t3.6596\n76\t3.981\n78\t4.3293\n80\t4.7065\n82\t5.1152\n84\t5.5578\n86\t6.0374\n88\t6.5569\n90\t7.1196\n92\t7.7293\n94\t8.3897\n96\t9.1051\n98\t9.8801\n100\t10.72" }, expect: { has: [/not determined/], hasNot: [NO_NEG_PLASTIC, /offset yield +\d/] } },
  { name: "r3 rubber", id: "mat-tensile", over: { data: "0\t0\n10\t0.13678\n20\t0.25279\n30\t0.3542\n40\t0.44503\n50\t0.52803\n60\t0.60512\n70\t0.67768\n80\t0.7467\n90\t0.81295\n100\t0.877\n110\t0.93928\n120\t1.0002\n130\t1.0599\n140\t1.1187\n150\t1.1767\n160\t1.2342\n170\t1.2912\n180\t1.3479\n190\t1.4043\n200\t1.4604\n210\t1.5165\n220\t1.5725\n230\t1.6284\n240\t1.6844\n250\t1.7404\n260\t1.7966\n270\t1.8528\n280\t1.9093\n290\t1.9659\n300\t2.0227\n310\t2.0798\n320\t2.1372\n330\t2.1948\n340\t2.2528\n350\t2.3111\n360\t2.3697\n370\t2.4287\n380\t2.488\n390\t2.5478\n400\t2.608\n410\t2.6686\n420\t2.7297\n430\t2.7912\n440\t2.8532\n450\t2.9157\n460\t2.9787\n470\t3.0423\n480\t3.1063\n490\t3.1709\n500\t3.2361" }, expect: { has: ["Ultimate strength UTS    3.236 MPa"], hasNot: [NO_NEG_PLASTIC] } },
  { name: "r3 wb 'S1 312'", id: "mat-weibull-strength", over: { data: "S1 312\nS2 334\nS3 351\nS4 362\nS5 371\nS6 380" }, expect: { refused: /line 1 \("S1 312"\) mixes words and numbers/ } },
  { name: "r3 wb 'Batch A: 312 …'", id: "mat-weibull-strength", over: { data: "Batch A: 312 334 351 362 371\n380 387 393 399 405\n411 417 424 430 437" }, expect: { refused: /line 1 .* mixes words and numbers/ } },
  { name: "r3 wb 'x 312 …'", id: "mat-weibull-strength", over: { data: "x 312 334 351 362 371 380 387 393 399 405 411 417 424 430 437 445 454 465 480 502" }, expect: { refused: /line 1 .* mixes words and numbers/ } },
  { name: "r3 wb 'σf 312'", id: "mat-weibull-strength", over: { data: "σf 312\n334\n351\n362\n371\n380\n387\n393" }, expect: { refused: /line 1 \("σf 312"\) mixes words and numbers/ } },
  { name: "r3 'Lot 7:' capability", id: "qual-capability", over: { data: "Lot 7: 9.98 10.01 10.02 9.97 10.00\n10.03 9.99 10.01 9.98 10.02", subgroup: "" }, expect: { refused: /line 1 .* mixes words and numbers/ } },
  { name: "r3 cap subgroups that shift (production order)", id: "qual-capability", over: { data: "9.990 9.944 9.974 9.964 9.965 10.028 10.010 10.028 10.021 10.063 9.982 9.976 9.977 9.973 9.969 10.036 10.045 10.038 10.050 10.038 9.960 9.975 9.965 9.955 9.958 10.025 10.039 10.017 10.018 10.030", subgroup: "5" }, expect: { has: ["Cpk   2.76", "Ppk   0.952", /either the data are sorted or the process shifts between groups/], hasNot: [/production order/] } },
  { name: "r3 cap two-level individuals", id: "qual-capability", over: { data: "10.0 10.0 10.0 10.1 10.1 10.1 10.1 10.0 10.0 10.1", subgroup: "" }, expect: { has: ["Cpk   0.564"] } },
  { name: "r3 cap step change", id: "qual-capability", over: { data: "10.0 10.0 10.0 10.0 10.1 10.1 10.1 10.1 10.1 10.1", subgroup: "" }, expect: { has: ["Ppk   0.258", /much smaller than σ overall/] } },
  { name: "r3 tt mixes 12.5 and 2,88", id: "mat-tensile", over: { data: "0\t2,88\n5\t4,15\n10\t4,76\n12.5\t5,10\n20\t8,72" }, expect: { refused: /12\.5/ } },
];

describe("cumulative gate: every reviewer probe, rounds 1–3", () => {
  test.each(GATE.map((g) => [g.name, g] as const))("%s", (_n, g) => {
    const out = run(g.id, g.over);
    if ("refused" in g.expect) {
      refused(out, g.expect.refused);
      return;
    }
    okOut(out);
    for (const h of g.expect.has) {
      if (typeof h === "string") expect(out.text).toContain(h);
      else expect(out.text).toMatch(h);
    }
    for (const h of g.expect.hasNot ?? []) {
      if (typeof h === "string") expect(out.text).not.toContain(h);
      else expect(out.text).not.toMatch(h);
    }
    // never a negative plastic strain, anywhere
    expect(out.text).not.toMatch(NO_NEG_PLASTIC);
  });
});

// RULE N table (relB-round3-rules.md), the cases that reach these tools' readers (all go through dataBlock.readDataBlock).
const RULE_N: GateCase[] = [
  { name: "N: space + decimal commas", id: "mat-scherrer", over: { peaks: "28,44 0,25\n47,30 0,29", inst: "" }, expect: { has: ["32.8 nm", "29.9 nm"] } },
  { name: "N: tabs + decimal commas, 3 columns", id: "mat-scherrer", over: { peaks: "28,44\t0,25\t0,08\n47,30\t0,29\t0,08" }, expect: { has: ["34.6 nm", "31.1 nm"] } },
  { name: "N: ', ' separates, dot decimals", id: "mat-scherrer", over: { peaks: "28.44, 0.25\n47.30, 0.29", inst: "" }, expect: { has: ["32.8 nm"] } },
  { name: "N: ', ' separates, decimal commas", id: "mat-scherrer", over: { peaks: "28, 0,25\n47, 0,29", inst: "" }, expect: { has: [/28\.00 +0\.250 .* nm/] } },
  { name: "N2: tabs mixing 12.5 and 2,88", id: "mat-scherrer", over: { peaks: "28\t2,88\n12.5\t5,10" }, expect: { refused: /mixes 12\.5 and 2,88/ } },
  { name: "N2: '2.5,3.5' has both marks", id: "mat-weibull-strength", over: { data: "1, 2.5,3.5" }, expect: { refused: /"2\.5,3\.5" has both a decimal point and a comma/ } },
  { name: "N3: European 1.234,5 1.302,7", id: "mat-weibull-strength", over: { data: "1.234,5 1.302,7 1.111,1" }, expect: { has: ["3 specimens"] } },
  { name: "N2: 1,000 with 7.0", id: "mat-weibull-strength", over: { data: "1,000 7.0 8.0" }, expect: { refused: /mixes 7\.0 and 1,000/ } },
  { name: "N3: 2,15 7,20 12,35", id: "mat-weibull-strength", over: { data: "2,15 7,20 12,35" }, expect: { has: ["3 specimens"] } },
  { name: "N2: 2,15 with 7.20", id: "mat-weibull-strength", over: { data: "2,15 7.20 8.1" }, expect: { refused: /mixes 7\.20 and 2,15/ } },
  { name: "N: lone 4,76 in a list is ambiguous", id: "qual-capability", over: { data: "4,76", subgroup: "" }, expect: { refused: /could be one number with a decimal comma \(4\.76\) or two values/ } },
  { name: "N: lone 25,50 in a list is ambiguous (list option)", id: "qual-capability", over: { data: "25,50", subgroup: "" }, expect: { refused: /could be one number with a decimal comma/ } },
  { name: "N4: 'Batch A: 312 334 351'", id: "mat-weibull-strength", over: { data: "Batch A: 312 334 351\n380 390" }, expect: { refused: /line 1 .* mixes words and numbers/ } },
  { name: "N4: 'Specimen 1' (space-separated)", id: "mat-weibull-strength", over: { data: "Specimen 1\n312\n334\n351" }, expect: { refused: /line 1 \("Specimen 1"\) mixes words and numbers/ } },
  { name: "N4: tab header noted", id: "mat-scherrer", over: { peaks: "2θ\tFWHM\tinst\n28.44\t0.25\t0.08" }, expect: { has: ["34.6 nm", /read as a (column )?header/] } },
  { name: "N: U+2212 minus read", id: "qual-capability", over: { data: "−3 −2.5 −3.5 −2.9 −3.1 −3.0", lsl: "−5", usl: "−1", subgroup: "" }, expect: { has: ["n = 6"] } },
  { name: "N: scientific notation read", id: "mat-weibull-strength", over: { data: "1e-3\n2e-3\n3e-3" }, expect: { has: ["3 specimens"] } },
  { name: "N: CRLF and blank lines ignored", id: "mat-weibull-strength", over: { data: "312\r\n\r\n334\r\n351\r\n" }, expect: { has: ["3 specimens"] } },
  { name: "N2 (stack): 50.00 with ±0,10", id: "qual-tolerance-stack", over: { dims: "Housing + 50.00 ±0,10\nSpacer - 20.00 ±0.05" }, expect: { refused: /mixes .* and 0,10|one decimal mark/ } },
  { name: "N3 (stack): decimal commas throughout", id: "qual-tolerance-stack", over: { dims: "Housing + 50,00 ±0,10\nSpacer - 20,00 ±0,05" }, expect: { has: ["30.000 ±0.150"] } },
];
describe("RULE N table through the materials readers", () => {
  test.each(RULE_N.map((g) => [g.name, g] as const))("%s", (_n, g) => {
    const out = run(g.id, g.over);
    if ("refused" in g.expect) {
      refused(out, g.expect.refused);
      return;
    }
    okOut(out);
    for (const h of g.expect.has) {
      if (typeof h === "string") expect(out.text).toContain(h);
      else expect(out.text).toMatch(h);
    }
  });
});

// ---------------------------------------------------------------------------
// ROUND 4 (relB-round3-rules.md, ROUND 4 RULINGS R1, R5, R6) and the round-4 review items.

/** review-round4 D/t3.js: Park–Miller LCG and Box–Muller, the reviewer's exact seeded noise. */
function pmRnd(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
const pmGauss = (r: () => number): number => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());

describe("round 4: R5 noise-scaled negative-plastic tolerance", () => {
  test.each([
    ["GFRP E 25 GPa, 1.5 MPa noise (0.3 % of UTS)", 25000, 0.02, 40, 1.5],
    ["GFRP E 25 GPa, 4 MPa noise", 25000, 0.02, 40, 4],
    ["PMMA E 3 GPa, 0.3 MPa noise (0.5 %)", 3000, 0.02, 40, 0.3],
    ["wood E 10 GPa, 1 MPa noise", 10000, 0.01, 40, 1],
    ["glass E 70 GPa, 0.5 MPa noise", 70000, 0.001, 30, 0.5],
  ])("%s: a straight noisy line keeps its modulus in ≥ 97 % of 200 seeded runs (was 77/200 lost)", (_n, E, ef, N, noise) => {
    let withheld = 0;
    let negative = 0;
    for (let s = 1; s <= 200; s++) {
      const r = pmRnd(s * 7919);
      const strain: number[] = [];
      const stress: number[] = [];
      for (let i = 0; i <= N; i++) {
        const e = (ef * i) / N;
        strain.push(e);
        stress.push(E * e + noise * pmGauss(r));
      }
      const res = tensileTest({ strain, stress, offset: 0.002 });
      if (!res.ok) throw new Error(res.error);
      if (res.withheld) withheld++;
      if ((res.uniformPlastic ?? 0) < 0 || (res.fracturePlastic ?? 0) < 0) negative++;
    }
    expect(withheld).toBeLessThanOrEqual(6);
    expect(negative).toBe(0);
  });
});

describe("round 4: R6 small-window curvature, and a noise-free toe past 15 % withholds", () => {
  test("σ = 60·tanh(ε/0.03), 200 steps (4-point window, 14 % change): the chord caveat is shown", () => {
    const rows = Array.from({ length: 201 }, (_, i) => {
      const e = (0.5 * i) / 200;
      return `${(e * 100).toPrecision(8)}\t${(60 * Math.tanh(e / 0.03)).toPrecision(8)}`;
    }).join("\n");
    const out = run("mat-tensile", { data: rows });
    okOut(out);
    expect(out.text).toContain("Young's modulus E        1.832 GPa   (R² = 0.99956, 4 points; chord over a slightly curved region)");
    expect(out.text).toMatch(/The elastic region is slightly curved: .* slope changes by 14 %/);
  });
  test("noise-free seating toe (7-point window, 18 % change, st.json case 4 shape): withheld, never 193.8 GPa", () => {
    const rows: string[] = [];
    for (let i = 0; i <= 19; i++) rows.push(`${i * 0.01}\t${i <= 8 ? 1.25 * i * i : 80 + 20 * (i - 8)}`); // 300 MPa at 0.19 %
    for (let k = 1; k <= 30; k++) rows.push(`${0.19 + k * 0.05}\t${k < 3 ? 300 - 30 * k : 240}`);
    for (let k = 1; k <= 24; k++) rows.push(`${1.69 + k}\t${240 + 176 * (1 - Math.exp(-k / 6))}`);
    const out = run("mat-tensile", { data: rows.join("\n") });
    okOut(out);
    expect(out.text).toContain(WITHHELD);
    expect(out.text).not.toMatch(/193\.8 GPa/);
  });
  test("the 'No linear elastic region' note appears exactly once", () => {
    const rows: string[] = [];
    let x = 0;
    for (let sv = 0; sv <= 300; sv += 2) {
      x = sv / 69000 + 0.002 * Math.pow(sv / 276, 20) + 0.0005 * (1 - Math.exp(-sv / 60));
      rows.push(`${(x * 100).toFixed(5)}\t${sv.toFixed(2)}`);
    }
    for (let k = 1; k < 300; k++) {
      x += 0.0004;
      rows.push(`${(x * 100).toFixed(5)}\t${(300 + 10 * Math.min(1, k / 150) - (k > 250 ? k - 250 : 0)).toFixed(2)}`);
    }
    const t = run("mat-tensile", { data: "strain\tstress\n" + rows.join("\n") }).text;
    expect(t.split("No linear elastic region").length - 1).toBe(1);
  });
});

describe("round 4: honest hint and figure text", () => {
  test("the hint no longer claims the tool refuses curved data", () => {
    const hint = MATERIALS_CALCS.find((c) => c.id === "mat-tensile")!.hint;
    expect(hint).not.toMatch(/refuses/);
    expect(hint).toMatch(/not determined rather than guessed/);
  });
  test("with E withheld, the caption and alt text name only the curve and the UTS", () => {
    const out = run("mat-tensile", { data: curveOf(range(0, 12, 49), (e) => 34 * (1 - Math.exp(-e / 2.5))) });
    const p = (out.blocks ?? []).filter((b) => b.kind === "plot") as { caption: string; alt: string }[];
    expect(p).toHaveLength(1);
    expect(p[0].alt).toBe("Engineering stress against strain with the ultimate strength marked");
    expect(p[0].caption).not.toMatch(/offset line|modulus line,/);
  });
  test("an offset line that never meets the curve is described as such", () => {
    const brittle = Array.from({ length: 10 }, (_, i) => `${i * 0.01}\t${i * 30}`).join("\n");
    const p = (run("mat-tensile", { data: brittle }).blocks ?? []).filter((b) => b.kind === "plot") as { caption: string; alt: string }[];
    expect(p[0].alt).not.toMatch(/yield point/);
    expect(p[1].alt).toMatch(/does not meet the curve/);
  });
});

describe("round 4: tolerance-stack names are echoed exactly as typed", () => {
  test("'O-ring 2-014' and 'Part 007 rev 1.10' keep their digits", () => {
    const out = run("qual-tolerance-stack", { dims: "O-ring 2-014 + 10.00 ±0.05\nPart 007 rev 1.10 - 5 ±0.02" });
    okOut(out);
    expect(out.text).toContain("+ O-ring 2-014");
    expect(out.text).toContain("− Part 007 rev 1.10");
    expect(out.text).toMatch(/Nominal gap +5\.000/);
  });
  test("a name's digits do not vote in the decimal-mark decision", () => {
    const out = run("qual-tolerance-stack", { dims: "Part 1.10 + 50,00 ±0,10\nSpacer 2.5 - 20,00 ±0,05" });
    okOut(out);
    expect(out.text).toContain("Part 1.10");
    expect(out.text).toMatch(/30\.000 ±0\.150/);
  });
});

describe("round 4: R1 single-column lists read a lone comma per line as a decimal comma", () => {
  test("Weibull '1234,5\\n1302,7\\n1410,2' → 3 specimens, m ≈ 14.16", () => {
    const out = run("mat-weibull-strength", { data: "1234,5\n1302,7\n1410,2" });
    okOut(out);
    expect(out.text).toContain("3 specimens");
    expect(out.text).toContain("Weibull modulus m          14.16");
  });
  test("capability '9,98\\n10,01…' (6 lines) → n = 6, mean 10.0017", () => {
    const out = run("qual-capability", { data: "9,98\n10,01\n10,02\n9,97\n10,00\n10,03", subgroup: "" });
    okOut(out);
    expect(out.text).toContain("n = 6");
    expect(out.text).toContain("Mean 10.0017");
  });
  test("CRLF line endings '312,5\\r\\n334,1…' read", () => {
    const out = run("mat-weibull-strength", { data: "312,5\r\n334,1\r\n351,7\r\n362,0" });
    okOut(out);
    expect(out.text).toContain("4 specimens");
  });
});

describe("round 4: freeze caps (nothing near a second at the documented caps)", () => {
  let s = 12345;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  test("Weibull: 2 000 strengths under budget, 2 001 refused by name", () => {
    const w = (n: number): string => Array.from({ length: n }, () => (300 * Math.pow(-Math.log(1 - rnd()), 1 / 10)).toFixed(2)).join(" ");
    const t0 = Date.now();
    okOut(run("mat-weibull-strength", { data: w(2000) }));
    // Measured in plain Node: Weibull 2 000 ≈ 100 ms, stack 100 + MC ≈ 140 ms; jest's transform makes the same code
    // several times slower, so the gate here is a loose ceiling that still catches the old 1.3–3.4 s freezes: 31 × the
    // reference workload (timingFloor.ts), ~3 s here, scaling with the machine (a fixed 3 s failed on a loaded worker).
    expect(Date.now() - t0).toBeLessThan(31 * referenceMs());
    refused(run("mat-weibull-strength", { data: w(2001) }), /more than 2,000 strengths/);
  });
  test("Stack: 100 dimensions with Monte Carlo under budget, 101 refused by name", () => {
    const dims = (n: number): string => Array.from({ length: n }, (_, i) => `D${i} ${i % 2 ? "+" : "−"} ${10 + i} ±0.0${1 + (i % 9)}`).join("\n");
    const t0 = Date.now();
    const out = run("qual-tolerance-stack", { dims: dims(100), mc: "on", gapMin: "" });
    // Measured in plain Node: Weibull 2 000 ≈ 100 ms, stack 100 + MC ≈ 140 ms; jest's transform makes the same code
    // several times slower, so the gate here is a loose ceiling that still catches the old 1.3–3.4 s freezes: 31 × the
    // reference workload (timingFloor.ts), ~3 s here, scaling with the machine (a fixed 3 s failed on a loaded worker).
    expect(Date.now() - t0).toBeLessThan(31 * referenceMs());
    okOut(out);
    expect(out.text).toMatch(/Monte Carlo \(10 000 draws/);
    refused(run("qual-tolerance-stack", { dims: dims(101), gapMin: "" }), /more than 100 dimensions/);
  });
});

describe("round 4 verification: trailing empty cells are not missing values", () => {
  const body = (sep: string): string =>
    TENSILE_ROWS.map(([e, s]) => `${e}${sep}${s}${sep}`).join("\n");
  test("tab: header and data rows ending in a tab read as two columns", () => {
    const out = run("mat-tensile", { data: `strain %\tstress MPa\t\n${body("\t")}` });
    okOut(out);
    expect(out.text).toContain("Young's modulus E        68.88 GPa");
    expect(out.text).not.toMatch(/missing value/);
  });
  test("semicolon: rows ending in ';' (and ';;') read as two columns", () => {
    const out = run("mat-tensile", { data: `strain %;stress MPa;\n${body(";")}` });
    okOut(out);
    expect(out.text).toContain("Young's modulus E        68.88 GPa");
    const two = run("mat-tensile", { data: TENSILE_ROWS.map(([e, s]) => `${e};${s};;`).join("\n") });
    okOut(two);
  });
  test("Scherrer and Weibull lists with trailing tabs", () => {
    okOut(run("mat-scherrer", { peaks: "28.44\t0.25\t\n47.30\t0.29\t" }));
    const w = run("mat-weibull-strength", { data: "312\t\n334\t\n351\t\n362\t" });
    okOut(w);
    expect(w.text).toContain("4 specimens");
  });
  test("an INTERIOR empty cell and a typed NA are still missing values, refused by line", () => {
    refused(run("mat-scherrer", { peaks: "28.44\t\t0.08\n47.30\t0.29\t0.08" }), /line 1 has a missing value/);
    refused(run("mat-scherrer", { peaks: "28.44\t0.25\tNA\n47.30\t0.29\t0.08" }), /line 1 has a missing value/);
  });
});
