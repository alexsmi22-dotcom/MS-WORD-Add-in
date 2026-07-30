// Pharmacokinetics: the area before the first sample, flip-flop, and absorption.
//
// Three defects, each reproduced and quantified before being touched, and each
// checked here against a closed form or an independent simulation.
//
//   A5  the AUC ran from the FIRST SAMPLE to the last, so if dosing was at t = 0
//       and the first sample was later, that interval was simply missing. On a
//       one-compartment IV bolus the clearance error grew from 1% (first sample at
//       0.25 h) to 98% (first sample at 4 h), with no note of any kind.
//   A6  the terminal slope of an ORAL profile need not be elimination. When
//       absorption is the slower process the tail decays at the absorption rate,
//       and the two cases are numerically identical: ka = 1.0/ke = 0.1 and
//       ka = 0.1/ke = 1.0 both reported a half-life of 6.93, and in the second case
//       the true elimination half-life is 0.693 — ten times smaller.
//   A7  the steady-state peak used F*Dose/Vd, which is the concentration reached
//       when the whole bioavailable dose appears INSTANTANEOUSLY. An absorption
//       rate could be supplied and was silently ignored, overstating the peak by
//       21% to 97%.

import { nca, steadyState } from "../pk";

// ---------------------------------------------------------------------------
// A5 — the area before the first sample
// ---------------------------------------------------------------------------

/** One-compartment IV bolus: C(t) = C0*exp(-k*t). True AUC = C0/k, exactly. */
const ivProfile = (C0: number, k: number, times: number[]): number[] =>
  times.map((t) => C0 * Math.exp(-k * t));

/** One-compartment oral: true AUC = F*Dose/(V*ke), exactly. */
const oralProfile = (
  dose: number, V: number, F: number, ka: number, ke: number, times: number[],
): number[] =>
  times.map((t) => ((F * dose * ka) / (V * (ka - ke))) * (Math.exp(-ke * t) - Math.exp(-ka * t)));

describe("A5: the AUC starts at dosing, not at the first sample", () => {
  const C0 = 100;
  const k = 0.2;
  const dose = 500;
  const TRUE_AUC = C0 / k;          // 500, by integration
  const TRUE_CL = dose / TRUE_AUC;  // 1.0

  test.each([0.25, 0.5, 1, 2, 4])(
    "a first sample at %s h no longer biases the clearance",
    (first) => {
      const times = [first, ...[1, 2, 4, 8, 12, 24, 36, 48].filter((t) => t > first)];
      const r = nca(times, ivProfile(C0, k, times), dose, "iv");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Before the fix these were -1%, +4%, +14%, +37%, +98% respectively.
      const err = Math.abs(r.clearance / TRUE_CL - 1);
      expect({ first, within8pc: err < 0.08 }).toEqual({ first, within8pc: true });
    },
  );

  test("the error no longer DEPENDS on when sampling started", () => {
    // The sharpest statement of the bug: the same drug sampled from 0.25 h and from
    // 4 h gave clearances differing by a factor of two. Whatever residual bias the
    // trapezoidal rule leaves must at least be the same for both.
    const cls = [0.25, 0.5, 1, 2, 4].map((first) => {
      const times = [first, ...[1, 2, 4, 8, 12, 24, 36, 48].filter((t) => t > first)];
      const r = nca(times, ivProfile(C0, k, times), dose, "iv");
      return r.ok ? r.clearance : NaN;
    });
    const spread = (Math.max(...cls) - Math.min(...cls)) / Math.min(...cls);
    expect(spread).toBeLessThan(0.05);
  });

  test("the residual bias is the TRAPEZOIDAL RULE, and converges to zero", () => {
    // Proof that the back-extrapolation is right rather than merely different: with
    // denser sampling the only remaining error source shrinks away. 2.37% at 4-hour
    // spacing down to 0.00% at 0.1-hour spacing.
    const errs = [4, 2, 1, 0.5, 0.1].map((step) => {
      const times: number[] = [];
      for (let t = step; t <= 48.0001; t += step) times.push(Number(t.toFixed(4)));
      const r = nca(times, ivProfile(C0, k, times), dose, "iv");
      return r.ok ? Math.abs(r.aucInf / TRUE_AUC - 1) : NaN;
    });
    for (let i = 1; i < errs.length; i++) {
      expect({ i, shrinking: errs[i] < errs[i - 1] }).toEqual({ i, shrinking: true });
    }
    expect(errs[errs.length - 1]).toBeLessThan(0.001);
  });

  test("an IV first sample is back-extrapolated log-linearly, and says so", () => {
    const times = [1, 2, 4, 8, 12, 24];
    const r = nca(times, ivProfile(C0, k, times), dose, "iv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const joined = r.notes.join(" ");
    expect(joined).toMatch(/back-extrapolation/);
    expect(joined).toMatch(/C0 = /);
    // The back-extrapolated C0 must be close to the true 100.
    const m = /C0 = ([\d.]+)/.exec(joined);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeCloseTo(C0, 0);
    // and it must admit it is an extrapolation
    expect(joined).toMatch(/IS an extrapolation/);
  });

  test("an ORAL first sample uses C(0) = 0, which is exact, not extrapolated", () => {
    // Different convention on purpose: an oral concentration at t = 0 is zero by
    // definition. Naively back-extrapolating here would invent drug that has not
    // been absorbed.
    const ka = 1.0;
    const ke = 0.1;
    const V = 10;
    const times: number[] = [];
    for (let t = 0.5; t <= 96.0001; t += 0.5) times.push(Number(t.toFixed(4)));
    const r = nca(times, oralProfile(dose, V, 1, ka, ke, times), dose, "oral");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trueAuc = dose / (V * ke);
    expect(Math.abs(r.aucInf / trueAuc - 1)).toBeLessThan
      (0.01);
    expect(r.notes.join(" ")).toMatch(/zero by definition/);
    expect(r.notes.join(" ")).not.toMatch(/back-extrapolation/);
  });

  test("a first sample AT time zero is unchanged", () => {
    const times = [0, 1, 2, 4, 8, 12, 24];
    const r = nca(times, ivProfile(C0, k, times), dose, "iv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/not at time zero/);
  });

  test("a non-declining first pair is refused an extrapolation, and says why", () => {
    // Back-extrapolation needs the first two points to fall. If they rise — a
    // distribution phase, or an infusion still running — inventing C0 from them
    // would be worse than admitting the gap.
    const times = [1, 2, 4, 8, 12, 24];
    const concs = [20, 40, 30, 15, 8, 2];
    const r = nca(times, concs, dose, "iv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).toMatch(/could not be back-extrapolated/);
    expect(r.notes.join(" ")).toMatch(/overestimates/);
  });
});

// ---------------------------------------------------------------------------
// A6 — flip-flop
// ---------------------------------------------------------------------------

describe("A6: an oral terminal slope may be absorption, not elimination", () => {
  const dose = 500;
  const V = 10;

  test("the two cases are numerically identical, which is the whole problem", () => {
    // Same reported half-life, ten-fold different truth. This is not a precision
    // issue — the one-compartment oral model is symmetric in ka and ke, so no fit
    // to oral data can tell them apart.
    const times = [0.25, 0.5, 1, 2, 4, 8, 16, 24, 32, 48];
    const normal = nca(times, oralProfile(dose, V, 1, 1.0, 0.1, times), dose, "oral");
    const flipped = nca(times, oralProfile(dose, V, 1, 0.1, 1.0, times), dose, "oral");
    expect(normal.ok).toBe(true);
    expect(flipped.ok).toBe(true);
    if (!normal.ok || !flipped.ok) return;
    expect(normal.halfLife).toBeCloseTo(flipped.halfLife, 3);
    expect(normal.halfLife).toBeCloseTo(Math.LN2 / 0.1, 2);
    // In the flipped case the TRUE elimination half-life is ten times shorter.
    expect(Math.LN2 / 1.0).toBeCloseTo(0.693, 3);
  });

  test("every oral result carries the flip-flop warning", () => {
    const times = [0.25, 0.5, 1, 2, 4, 8, 16, 24, 32, 48];
    for (const [ka, ke] of [[1.0, 0.1], [0.1, 1.0], [0.3, 0.2], [5, 0.05]] as [number, number][]) {
      const r = nca(times, oralProfile(dose, V, 1, ka, ke, times), dose, "oral");
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const joined = r.notes.join(" ");
      expect({ ka, ke, warned: /FLIP-FLOP/.test(joined) }).toEqual({ ka, ke, warned: true });
      expect(joined).toMatch(/intravenous reference/);
      expect(joined).toMatch(/SLOWER of the two/);
    }
  });

  test("IV data carries no flip-flop warning, because there is no absorption phase", () => {
    const times = [0.5, 1, 2, 4, 8, 12, 24];
    const r = nca(times, ivProfile(100, 0.2, times), 500, "iv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/FLIP-FLOP/);
  });
});

// ---------------------------------------------------------------------------
// A7 — absorption at steady state, against an independent simulation
// ---------------------------------------------------------------------------

/** Steady state by SUPERPOSITION of single-dose responses — an independent oracle. */
function simulatedOralSteadyState(
  dose: number, V: number, F: number, ka: number, ke: number, tau: number,
): { cmax: number; tmax: number; cmin: number } {
  const single = (t: number): number =>
    t <= 0 ? 0 : ((F * dose * ka) / (V * (ka - ke))) * (Math.exp(-ke * t) - Math.exp(-ka * t));
  const c = (t: number): number => {
    let sum = 0;
    for (let j = 0; j < 400; j++) sum += single(t + j * tau);
    return sum;
  };
  let cmax = -Infinity;
  let tmax = 0;
  const M = 20000;
  for (let i = 0; i <= M; i++) {
    const t = (i * tau) / M;
    const v = c(t);
    if (v > cmax) {
      cmax = v;
      tmax = t;
    }
  }
  return { cmax, tmax, cmin: c(tau) };
}

describe("A7: the steady-state peak accounts for absorption when it can", () => {
  const dose = 500;
  const V = 10;
  const tau = 12;

  test.each([
    [0.3, 0.2],
    [0.6, 0.2],
    [1.0, 0.2],
    [3.0, 0.2],
    [2.0, 0.5],
  ])("ka = %s, ke = %s matches a superposition simulation", (ka, ke) => {
    const ss = steadyState({ dose, vd: V, cl: ke * V, f: 1, ka }, tau);
    expect(ss.ok).toBe(true);
    if (!ss.ok) return;
    const truth = simulatedOralSteadyState(dose, V, 1, ka, ke, tau);
    expect(Math.abs(ss.cMaxSs / truth.cmax - 1)).toBeLessThan(1e-6);
    expect(Math.abs(ss.cMinSs / truth.cmin - 1)).toBeLessThan(1e-6);
    expect(ss.tMaxSs).not.toBeNull();
    expect(Math.abs(ss.tMaxSs! - truth.tmax)).toBeLessThan(0.01);
  });

  test("the instantaneous-input formula overstates the peak, by how much it says", () => {
    // 21% to 97% across ordinary absorption rates. The overstatement is disclosed
    // rather than left for the reader to discover.
    for (const ka of [0.3, 0.6, 1.0, 3.0]) {
      const ss = steadyState({ dose, vd: V, cl: 2, f: 1, ka }, tau);
      const bolus = steadyState({ dose, vd: V, cl: 2, f: 1 }, tau);
      expect(ss.ok).toBe(true);
      expect(bolus.ok).toBe(true);
      if (!ss.ok || !bolus.ok) continue;
      expect(bolus.cMaxSs).toBeGreaterThan(ss.cMaxSs);
      expect(ss.notes.join(" ")).toMatch(/Absorption is accounted for/);
      expect(ss.notes.join(" ")).toMatch(/% higher/);
    }
  });

  test("without an absorption rate the assumption is STATED, not left implicit", () => {
    const ss = steadyState({ dose, vd: V, cl: 2, f: 1 }, tau);
    expect(ss.ok).toBe(true);
    if (!ss.ok) return;
    expect(ss.tMaxSs).toBeNull();
    expect(ss.notes.join(" ")).toMatch(/INSTANTANEOUSLY/);
    expect(ss.notes.join(" ")).toMatch(/upper bound/);
  });

  test("the AVERAGE concentration is unaffected, because it depends only on dose rate", () => {
    // Cavg = F*D/(CL*tau) whatever the absorption rate. A fix to the peak that moved
    // the average would be a new bug.
    const withKa = steadyState({ dose, vd: V, cl: 2, f: 1, ka: 0.6 }, tau);
    const without = steadyState({ dose, vd: V, cl: 2, f: 1 }, tau);
    expect(withKa.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withKa.ok || !without.ok) return;
    expect(withKa.cAvgSs).toBeCloseTo(without.cAvgSs, 12);
    expect(withKa.cAvgSs).toBeCloseTo((1 * dose) / (2 * tau), 12);
  });

  test("ka equal to ke is refused an oral solution, because the formula divides by their difference", () => {
    const ss = steadyState({ dose, vd: V, cl: 2, f: 1, ka: 0.2 }, tau);
    expect(ss.ok).toBe(true);
    if (!ss.ok) return;
    // ke = cl/vd = 0.2, so ka == ke exactly.
    expect(ss.tMaxSs).toBeNull();
    expect(ss.notes.join(" ")).toMatch(/indistinguishable/);
    expect(ss.notes.join(" ")).toMatch(/upper bound/);
  });

  test("bioavailability still scales the peak and the average together", () => {
    const full = steadyState({ dose, vd: V, cl: 2, f: 1, ka: 0.6 }, tau);
    const half = steadyState({ dose, vd: V, cl: 2, f: 0.5, ka: 0.6 }, tau);
    expect(full.ok).toBe(true);
    expect(half.ok).toBe(true);
    if (!full.ok || !half.ok) return;
    expect(half.cMaxSs).toBeCloseTo(full.cMaxSs / 2, 9);
    expect(half.cAvgSs).toBeCloseTo(full.cAvgSs / 2, 9);
    // The loading dose is INDEPENDENT of F: both the first peak and the steady-state
    // peak scale with F, so it cancels. Worth pinning, because it looks like a bug.
    expect(half.loadingDose).toBeCloseTo(full.loadingDose, 9);
  });
});
