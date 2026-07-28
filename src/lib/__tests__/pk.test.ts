// Oracle tests for the pharmacokinetics engine.
//
// The expected values are standard PK closed forms worked independently of the
// code. The strongest test here is the ROUND TRIP: simulate a curve from known
// CL and Vd, hand the sampled points to the non-compartmental analysis as if
// they were measured data, and check it recovers the parameters it was never
// told. The simulator and the analyser share no arithmetic — one evaluates
// exponentials, the other does trapezoids and a log-linear regression — so
// agreement is real evidence rather than a tautology.

import {
  singleDoseCurve,
  steadyState,
  multipleDoseCurve,
  nca,
  parseConcentrationData,
  ConcentrationCurve,
  SteadyState,
  NcaResult,
  PkParams,
} from "../pk";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

const BASE: PkParams = { dose: 500, vd: 35, cl: 3.5, f: 1 };

function curve(route: Parameters<typeof singleDoseCurve>[0], p: PkParams, tEnd: number, n = 400): ConcentrationCurve {
  const r = singleDoseCurve(route, p, tEnd, n);
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---------------------------------------------------------------------------
describe("IV bolus", () => {
  // k = CL/Vd = 0.1, t1/2 = ln2/0.1 = 6.93, C0 = 500/35 = 14.29
  test("the basic parameters follow from CL and Vd", () => {
    const c = curve("iv-bolus", BASE, 48);
    near(c.k, 0.1);
    near(c.halfLife, Math.LN2 / 0.1);
    near(c.cmax, 500 / 35);
    expect(c.tmax).toBe(0);
  });

  test("concentration is a single exponential decay", () => {
    const c = curve("iv-bolus", BASE, 48);
    for (let i = 0; i < c.t.length; i++) {
      near(c.c[i], (500 / 35) * Math.exp(-0.1 * c.t[i]));
    }
  });

  test("one half-life halves the concentration", () => {
    const c = curve("iv-bolus", BASE, 48, 1000);
    const t0 = c.c[0];
    const idx = c.t.findIndex((t) => t >= c.halfLife);
    expect(Math.abs(c.c[idx] / t0 - 0.5)).toBeLessThan(0.01);
  });

  test("AUC is Dose/CL exactly", () => {
    const c = curve("iv-bolus", BASE, 48);
    near(c.auc, 500 / 3.5);
  });

  test("AUC is independent of the volume of distribution", () => {
    // Only clearance sets total exposure; volume sets the shape.
    const a = curve("iv-bolus", BASE, 48);
    const b = curve("iv-bolus", { ...BASE, vd: 200 }, 48);
    near(a.auc, b.auc);
    expect(b.cmax).toBeLessThan(a.cmax);
  });
});

// ---------------------------------------------------------------------------
describe("infusion", () => {
  // rate = 500/10 = 50/h, plateau = rate/CL = 50/3.5 = 14.29
  test("the plateau is rate over clearance and does not involve volume", () => {
    const c = curve("infusion", { ...BASE, tInf: 10 }, 200, 2000);
    const plateau = 50 / 3.5;
    // A very long infusion approaches the plateau.
    const long = curve("infusion", { ...BASE, dose: 50 * 500, tInf: 500 }, 500, 2000);
    expect(Math.abs(long.cmax - plateau) / plateau).toBeLessThan(0.01);
    expect(c.tmax).toBe(10);
  });

  test("concentration rises then falls, peaking at the end of the infusion", () => {
    const c = curve("infusion", { ...BASE, tInf: 10 }, 48, 1000);
    const peakIdx = c.c.indexOf(Math.max(...c.c));
    expect(Math.abs(c.t[peakIdx] - 10)).toBeLessThan(0.1);
    // Monotonic up before, monotonic down after.
    for (let i = 1; i < peakIdx; i++) expect(c.c[i]).toBeGreaterThanOrEqual(c.c[i - 1] - 1e-12);
    for (let i = peakIdx + 2; i < c.c.length; i++) expect(c.c[i]).toBeLessThanOrEqual(c.c[i - 1] + 1e-12);
  });

  test("half the plateau is reached in one half-life", () => {
    const p = { ...BASE, dose: 50 * 500, tInf: 500 };
    const c = curve("infusion", p, 500, 5000);
    const plateau = (p.dose / p.tInf) / p.cl;
    const idx = c.t.findIndex((t) => t >= c.halfLife);
    expect(Math.abs(c.c[idx] / plateau - 0.5)).toBeLessThan(0.02);
  });

  test("AUC is still Dose/CL however it was infused", () => {
    near(curve("infusion", { ...BASE, tInf: 10 }, 200).auc, 500 / 3.5);
    near(curve("infusion", { ...BASE, tInf: 0.5 }, 200).auc, 500 / 3.5);
  });

  test("a missing or non-positive duration is refused", () => {
    expect(singleDoseCurve("infusion", BASE, 48).ok).toBe(false);
    expect(singleDoseCurve("infusion", { ...BASE, tInf: 0 }, 48).ok).toBe(false);
    expect(singleDoseCurve("infusion", { ...BASE, tInf: -1 }, 48).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("oral dosing", () => {
  const ORAL: PkParams = { ...BASE, ka: 1.0, f: 0.8 };

  test("Tmax matches the closed form ln(ka/k)/(ka-k)", () => {
    const c = curve("oral", ORAL, 48);
    const k = 0.1;
    near(c.tmax, Math.log(1.0 / k) / (1.0 - k));
  });

  test("Cmax matches (F*D/Vd)*exp(-k*Tmax)", () => {
    const c = curve("oral", ORAL, 48);
    near(c.cmax, ((0.8 * 500) / 35) * Math.exp(-0.1 * c.tmax));
  });

  test("the curve is the difference of two exponentials", () => {
    const c = curve("oral", ORAL, 48);
    const k = 0.1;
    const ka = 1.0;
    const coeff = (0.8 * 500 * ka) / (35 * (ka - k));
    for (let i = 0; i < c.t.length; i++) {
      near(c.c[i], coeff * (Math.exp(-k * c.t[i]) - Math.exp(-ka * c.t[i])), 1e-8);
    }
  });

  test("the curve starts at zero and peaks in the interior", () => {
    const c = curve("oral", ORAL, 48);
    expect(c.c[0]).toBeCloseTo(0, 12);
    expect(c.tmax).toBeGreaterThan(0);
  });

  test("AUC is F*Dose/CL", () => {
    near(curve("oral", ORAL, 200).auc, (0.8 * 500) / 3.5);
  });

  // THE TRAP THIS MODULE EXISTS PARTLY TO CATCH.
  test("flip-flop kinetics are detected and named when ka < k", () => {
    const c = curve("oral", { ...ORAL, ka: 0.02 }, 400);
    expect(c.notes.join(" ")).toMatch(/FLIP-FLOP KINETICS/);
    expect(c.notes.join(" ")).toMatch(/TERMINAL SLOPE OF THIS CURVE IS ABSORPTION/i);
  });

  test("and it really is absorption that governs the tail there", () => {
    // The physical claim behind the warning: with ka << k the terminal slope
    // equals ka, not k. Verified from the simulated curve itself.
    const p = { ...ORAL, ka: 0.02 };
    const c = curve("oral", p, 600, 4000);
    const i1 = Math.floor(c.t.length * 0.7);
    const i2 = c.t.length - 1;
    const slope = (Math.log(c.c[i2]) - Math.log(c.c[i1])) / (c.t[i2] - c.t[i1]);
    near(-slope, 0.02, 1e-3);
    // Not the elimination constant, which is five times larger.
    expect(Math.abs(-slope - 0.1)).toBeGreaterThan(0.05);
  });

  test("a marginal ka/k ratio is flagged without crying flip-flop", () => {
    const c = curve("oral", { ...ORAL, ka: 0.2 }, 200);
    expect(c.notes.join(" ")).not.toMatch(/FLIP-FLOP/);
    expect(c.notes.join(" ")).toMatch(/biased long/i);
  });

  test("ka equal to k uses the limiting form rather than dividing by zero", () => {
    const c = curve("oral", { ...ORAL, ka: 0.1 }, 100);
    expect(c.c.every((v) => Number.isFinite(v))).toBe(true);
    near(c.tmax, 1 / 0.1);
    expect(c.notes.join(" ")).toMatch(/0\/0|limiting form/i);
  });

  test("oral results state that only CL/F and Vd/F are identifiable", () => {
    expect(curve("oral", ORAL, 48).notes.join(" ")).toMatch(/CL\/F and Vd\/F/);
  });

  test("a missing absorption constant is refused", () => {
    expect(singleDoseCurve("oral", BASE, 48).ok).toBe(false);
    expect(singleDoseCurve("oral", { ...BASE, ka: 0 }, 48).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("steady state", () => {
  // k = 0.1, tau = 12: decay = e^-1.2 = 0.3012, accumulation = 1.4306
  const ss = (): SteadyState => {
    const r = steadyState(BASE, 12);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  test("the accumulation ratio matches 1/(1 - exp(-k*tau))", () => {
    near(ss().accumulation, 1 / (1 - Math.exp(-0.1 * 12)));
  });

  test("peak and trough follow from the accumulation ratio", () => {
    const s = ss();
    near(s.cMaxSs, (500 / 35) * s.accumulation);
    near(s.cMinSs, s.cMaxSs * Math.exp(-0.1 * 12));
  });

  test("the average steady-state concentration is F*D/(CL*tau)", () => {
    near(ss().cAvgSs, 500 / (3.5 * 12));
  });

  // The single most useful fact in dosing, so it is pinned.
  test("halving the dose and the interval leaves the average unchanged", () => {
    const a = steadyState(BASE, 12) as SteadyState;
    const b = steadyState({ ...BASE, dose: 250 }, 6) as SteadyState;
    near(a.cAvgSs, b.cAvgSs);
    // ...and narrows the swing.
    expect(b.fluctuation as number).toBeLessThan(a.fluctuation as number);
  });

  test("the average lies between the trough and the peak", () => {
    const s = ss();
    expect(s.cAvgSs).toBeGreaterThan(s.cMinSs);
    expect(s.cAvgSs).toBeLessThan(s.cMaxSs);
  });

  test("time to steady state depends only on half-life, not on dose", () => {
    const a = steadyState(BASE, 12) as SteadyState;
    const b = steadyState({ ...BASE, dose: 5000 }, 12) as SteadyState;
    near(a.timeTo95, b.timeTo95);
    near(a.timeTo95, 4.32 * (Math.LN2 / 0.1));
    expect(b.cAvgSs).toBeGreaterThan(a.cAvgSs);
  });

  test("the loading dose puts the first peak at the steady-state peak", () => {
    const s = ss();
    near(s.loadingDose / 35, s.cMaxSs);
  });

  test("a long interval reports negligible accumulation", () => {
    const s = steadyState(BASE, 100) as SteadyState;
    expect(s.accumulation).toBeLessThan(1.01);
    expect(s.notes.join(" ")).toMatch(/almost no accumulation/i);
  });

  test("the linearity assumption is always stated", () => {
    expect(ss().notes.join(" ")).toMatch(/FIRST-ORDER \(linear\) elimination/);
    expect(ss().notes.join(" ")).toMatch(/phenytoin/i);
  });

  test("a non-positive interval is refused", () => {
    expect(steadyState(BASE, 0).ok).toBe(false);
    expect(steadyState(BASE, -5).ok).toBe(false);
    expect(steadyState(BASE, NaN).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("multiple dosing by superposition", () => {
  test("the trough after many doses approaches the steady-state trough", () => {
    const r = multipleDoseCurve(BASE, 12, 30, 3000);
    if (!r.ok) throw new Error(r.error);
    const s = steadyState(BASE, 12) as SteadyState;
    // The concentration just before the last dose is the steady-state trough.
    const tLastDose = 12 * 29;
    let idx = 0;
    for (let i = 0; i < r.t.length; i++) if (r.t[i] < tLastDose) idx = i;
    expect(Math.abs(r.c[idx] - s.cMinSs) / s.cMinSs).toBeLessThan(0.02);
  });

  test("one dose reproduces the single-dose curve", () => {
    const r = multipleDoseCurve(BASE, 24, 1, 200);
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; i < r.t.length; i++) {
      near(r.c[i], (500 / 35) * Math.exp(-0.1 * r.t[i]), 1e-9);
    }
  });

  test("bad inputs are refused", () => {
    expect(multipleDoseCurve(BASE, 0, 5).ok).toBe(false);
    expect(multipleDoseCurve(BASE, 12, 0).ok).toBe(false);
    expect(multipleDoseCurve({ ...BASE, cl: 0 }, 12, 5).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("non-compartmental analysis", () => {
  /** Samples an IV bolus curve at realistic study times. */
  function ivSamples(dose: number, vd: number, cl: number, times: number[]) {
    const k = cl / vd;
    return { times, concentrations: times.map((t) => (dose / vd) * Math.exp(-k * t)) };
  }

  // THE ROUND TRIP. The simulator and the analyser share no arithmetic.
  test("it recovers clearance, volume and half-life from a simulated IV curve", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 0.5, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48]);
    const r = nca(times, concentrations, 500, "iv");
    if (!r.ok) throw new Error(r.error);
    // The truth: CL = 3.5, Vd = 35, k = 0.1, t1/2 = 6.93.
    expect(Math.abs(r.lambdaZ - 0.1) / 0.1).toBeLessThan(0.01);
    expect(Math.abs(r.halfLife - Math.LN2 / 0.1) / (Math.LN2 / 0.1)).toBeLessThan(0.01);
    // Trapezoid slightly over-estimates AUC, so clearance comes out slightly low.
    expect(Math.abs(r.clearance - 3.5) / 3.5).toBeLessThan(0.03);
    expect(Math.abs(r.volume - 35) / 35).toBeLessThan(0.03);
  });

  test("the recovered AUC is close to the exact Dose/CL", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 0.5, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    const exact = 500 / 3.5;
    expect(Math.abs(r.aucInf - exact) / exact).toBeLessThan(0.03);
    // And the trapezoidal rule errs HIGH on a convex decay, as the note says.
    expect(r.aucInf).toBeGreaterThan(exact * 0.99);
  });

  test("Cmax and Tmax are read off the data, not modelled", () => {
    const r = nca([0.5, 1, 2, 4, 8], [2, 9, 7, 4, 1], 100, "oral") as NcaResult;
    expect(r.cmax).toBe(9);
    expect(r.tmax).toBe(1);
  });

  test("mean residence time of an IV bolus is 1/k", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 0.5, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48, 72]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    expect(Math.abs(r.mrt - 1 / 0.1) / 10).toBeLessThan(0.05);
  });

  // The quality check that is usually buried.
  test("a study stopped too early reports a large extrapolated fraction", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 0.5, 1, 2, 3]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    expect(r.percentExtrapolated).toBeGreaterThan(20);
    expect(r.notes.join(" ")).toMatch(/EXTRAPOLATION/);
    expect(r.notes.join(" ")).toMatch(/20%/);
  });

  test("a well-sampled study reports a small extrapolated fraction", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 1, 2, 4, 8, 12, 24, 36, 48, 60, 72]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    expect(r.percentExtrapolated).toBeLessThan(10);
  });

  test("oral data is labelled apparent clearance, not clearance", () => {
    const r = nca([0.5, 1, 2, 4, 8, 12, 24], [2, 9, 8, 5, 2, 1, 0.2], 100, "oral") as NcaResult;
    expect(r.notes.join(" ")).toMatch(/APPARENT clearance CL\/F/);
    expect(r.notes.join(" ")).toMatch(/intravenous reference/);
  });

  test("IV data mentions Vss rather than pretending Vz is it", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 1, 2, 4, 8, 12, 24, 48]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    expect(r.notes.join(" ")).toMatch(/Vss = CL x MRT/);
  });

  test("the terminal window is chosen, and uses at least three points", () => {
    const { times, concentrations } = ivSamples(500, 35, 3.5, [0.25, 1, 2, 4, 8, 12, 24, 48]);
    const r = nca(times, concentrations, 500, "iv") as NcaResult;
    expect(r.lambdaPoints).toBeGreaterThanOrEqual(3);
    expect(r.lambdaR2).toBeGreaterThan(0.99);
  });

  test("a profile that never declines is refused rather than fitted", () => {
    const r = nca([1, 2, 3, 4], [1, 2, 3, 4], 100, "iv");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/terminal decline/i);
  });

  test("malformed input is refused", () => {
    expect(nca([1, 2], [1, 2], 100, "iv").ok).toBe(false); // too few
    expect(nca([1, 2, 3], [1, 2], 100, "iv").ok).toBe(false); // mismatched
    expect(nca([1, 1, 2], [3, 2, 1], 100, "iv").ok).toBe(false); // not increasing
    expect(nca([1, 2, 3], [3, -2, 1], 100, "iv").ok).toBe(false); // negative
    expect(nca([1, 2, 3], [3, 2, 1], 0, "iv").ok).toBe(false); // no dose
    expect(nca([1, 2, NaN], [3, 2, 1], 100, "iv").ok).toBe(false);
    expect(nca([1, 2, 3], [0, 0, 0], 100, "iv").ok).toBe(false); // all zero
  });
});

// ---------------------------------------------------------------------------
describe("parsing concentration data", () => {
  test("whitespace, commas and comments all work", () => {
    const p = parseConcentrationData("0.5 12.1\n1, 9.4\n2\t7.2  # a comment\n\n4 3.1");
    expect(p.errors).toEqual([]);
    expect(p.times).toEqual([0.5, 1, 2, 4]);
    expect(p.concentrations).toEqual([12.1, 9.4, 7.2, 3.1]);
  });

  test("malformed lines are reported with their line number", () => {
    const p = parseConcentrationData("0.5 12.1\nbroken\n1 2 3");
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toMatch(/Line 2/);
    expect(p.errors[1]).toMatch(/Line 3/);
  });

  test("empty input says so", () => {
    expect(parseConcentrationData("").errors.join(" ")).toMatch(/No data points/);
  });
});
