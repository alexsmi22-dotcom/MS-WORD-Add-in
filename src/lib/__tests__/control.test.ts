// Oracle tests for the control-systems engine.
//
// The expected values are closed forms from control theory worked independently
// of the code: the standard second-order identities, Routh arrays tabulated by
// hand, and margins of systems whose crossover frequencies can be solved
// algebraically. Where an answer is exactly rational the assertion is exact.

import {
  parsePoly,
  parseTf,
  polyRoots,
  polyMul,
  polyAdd,
  polyDegree,
  trimPoly,
  polyToString,
  routhHurwitz,
  analyzeStability,
  series,
  feedback,
  pidTf,
  timeResponse,
  secondOrderMetrics,
  frequencyResponse,
  margins,
  TransferFunction,
  RouthResult,
  StabilityResult,
  SecondOrderMetrics,
  Margins,
  TimeResponse,
} from "../control";
import { Rat, ratInt, ratDiv, ratToNumber } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const P = (...xs: number[]): Rat[] => xs.map((x) => ratInt(x));

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

function poly(text: string): Rat[] {
  const p = parsePoly(text);
  if ("ok" in p) throw new Error(p.error);
  return p;
}
function tf(num: string, den: string): TransferFunction {
  const t = parseTf(num, den);
  if ("ok" in t) throw new Error(t.error);
  return t;
}
function stab(t: TransferFunction): StabilityResult {
  const s = analyzeStability(t);
  if (!s.ok) throw new Error(s.error);
  return s;
}
function routh(p: Rat[]): RouthResult {
  const r = routhHurwitz(p);
  if ("ok" in r && r.ok === false) throw new Error(r.error);
  return r as RouthResult;
}

// ---------------------------------------------------------------------------
describe("parsing", () => {
  test("a coefficient list is read highest power first", () => {
    expect(poly("1 2 3").map(ratToNumber)).toEqual([1, 2, 3]);
    expect(poly("1, 2, 3").map(ratToNumber)).toEqual([1, 2, 3]);
  });

  test("a written polynomial gives the same thing", () => {
    expect(poly("s^2+2*s+3").map(ratToNumber)).toEqual([1, 2, 3]);
    expect(poly("s^2 + 2s + 3").map(ratToNumber)).toEqual([1, 2, 3]);
  });

  test("a bare s and a bare constant work", () => {
    expect(poly("s").map(ratToNumber)).toEqual([1, 0]);
    expect(poly("5").map(ratToNumber)).toEqual([5]);
    expect(poly("s^3").map(ratToNumber)).toEqual([1, 0, 0, 0]);
  });

  test("negative and fractional coefficients are exact", () => {
    expect(poly("s^2-0.5*s+0.25").map((r) => `${r.n}/${r.d}`)).toEqual(["1/1", "-1/2", "1/4"]);
    // 0.1 must be one tenth exactly, not the nearest double.
    expect(poly("0.1").map((r) => `${r.n}/${r.d}`)).toEqual(["1/10"]);
  });

  test("like powers are combined", () => {
    expect(poly("s+s").map(ratToNumber)).toEqual([2, 0]);
    expect(poly("2s^2-s^2").map(ratToNumber)).toEqual([1, 0, 0]);
  });

  // Factored input would parse to something plausible and wrong, so it is named.
  test("factored form is refused rather than mis-parsed", () => {
    const r = parsePoly("(s+1)(s+2)");
    expect("ok" in r && r.ok === false).toBe(true);
    if ("ok" in r) expect(r.error).toMatch(/Factored form/);
  });

  test("nonsense is refused", () => {
    for (const bad of ["", "   ", "abc", "s^", "1 2 x"]) {
      expect("ok" in parsePoly(bad)).toBe(true);
    }
  });

  test("a zero denominator is refused", () => {
    const t = parseTf("1", "0");
    expect("ok" in t && t.ok === false).toBe(true);
  });

  test("polyToString round-trips the display form", () => {
    expect(polyToString(poly("s^2+2s+3"))).toBe("s^2 + 2s + 3");
    expect(polyToString(poly("s^2-2s"))).toBe("s^2 - 2s");
    expect(polyToString(P(0))).toBe("0");
  });
});

// ---------------------------------------------------------------------------
describe("polynomial algebra", () => {
  test("multiplication matches the expansion", () => {
    // (s+1)(s+2) = s^2 + 3s + 2
    expect(polyMul(P(1, 1), P(1, 2)).map(ratToNumber)).toEqual([1, 3, 2]);
  });

  test("addition aligns from the constant term, not the leading one", () => {
    // s^2 + 1 plus s = s^2 + s + 1. Aligning left would give s^2 + s + 1 wrong.
    expect(polyAdd(P(1, 0, 1), P(1, 0)).map(ratToNumber)).toEqual([1, 1, 1]);
  });

  test("degree and trimming ignore leading zeros", () => {
    expect(polyDegree(P(0, 0, 1, 2))).toBe(1);
    expect(trimPoly(P(0, 0, 5)).map(ratToNumber)).toEqual([5]);
    expect(polyDegree(P(0))).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
describe("roots", () => {
  test("real roots of a known factorisation", () => {
    // s^2 + 3s + 2 = (s+1)(s+2)
    const r = polyRoots(P(1, 3, 2))!;
    const re = r.map((z) => z.re).sort((a, b) => a - b);
    near(re[0], -2);
    near(re[1], -1);
    expect(r.every((z) => Math.abs(z.im) < 1e-9)).toBe(true);
  });

  test("a complex conjugate pair", () => {
    // s^2 + 2s + 5 has roots -1 +- 2j
    const r = polyRoots(P(1, 2, 5))!;
    expect(r).toHaveLength(2);
    for (const z of r) near(z.re, -1);
    expect(Math.abs(Math.abs(r[0].im) - 2)).toBeLessThan(1e-9);
    // A conjugate pair must actually be conjugate.
    near(r[0].im, -r[1].im);
  });

  test("a repeated root is found twice", () => {
    // (s+1)^2 = s^2 + 2s + 1
    const r = polyRoots(P(1, 2, 1))!;
    expect(r).toHaveLength(2);
    for (const z of r) near(z.re, -1, 1e-6);
  });

  test("roots satisfy the polynomial they came from", () => {
    // The independent check: substitute back.
    const coeffs = [1, 6, 11, 6]; // (s+1)(s+2)(s+3)
    const r = polyRoots(P(...coeffs))!;
    for (const z of r) {
      let re = 0;
      let im = 0;
      for (const c of coeffs) {
        const nr = re * z.re - im * z.im + c;
        const ni = re * z.im + im * z.re;
        re = nr;
        im = ni;
      }
      expect(Math.hypot(re, im)).toBeLessThan(1e-8);
    }
  });

  test("a constant polynomial has no roots", () => {
    expect(polyRoots(P(5))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("Routh-Hurwitz", () => {
  // s^3 + 6s^2 + 11s + 6 = (s+1)(s+2)(s+3): all roots left half plane.
  test("a stable cubic has no sign changes", () => {
    const r = routh(P(1, 6, 11, 6));
    expect(r.signChanges).toBe(0);
    expect(r.clean).toBe(true);
    // First column: 1, 6, 10, 6 — worked by hand.
    const firstCol = r.rows.map((row) => ratToNumber(row[0]));
    expect(firstCol[0]).toBe(1);
    expect(firstCol[1]).toBe(6);
    near(firstCol[2], 10);
    near(firstCol[3], 6);
  });

  // s^3 + s^2 + 2s + 8 has two right-half-plane roots (classic textbook case).
  test("an unstable cubic reports the right count", () => {
    const r = routh(P(1, 1, 2, 8));
    expect(r.signChanges).toBe(2);
  });

  test("the sign-change count always equals the true root count", () => {
    // The independent cross-check, over a spread of polynomials.
    for (const c of [
      [1, 6, 11, 6],
      [1, 1, 2, 8],
      [1, 2, 3, 4, 5],
      [1, 10, 35, 50, 24],
      [1, -1],
      [1, 1],
      [1, 0, 4, 0, 3],
      [2, 5, 3],
      [1, 3, 3, 1],
    ]) {
      const r = routhHurwitz(P(...c));
      if ("ok" in r && r.ok === false) continue;
      const rr = r as RouthResult;
      if (!rr.clean) continue;
      const roots = polyRoots(P(...c))!;
      const rhp = roots.filter((z) => z.re > 1e-9).length;
      expect({ c, routh: rr.signChanges }).toEqual({ c, routh: rhp });
    }
  });

  // s^4 + s^3 + 3s^2 + 2s + 2 — row of zeros, imaginary-axis pair.
  test("a vanishing row is detected and explained", () => {
    const r = routh(P(1, 1, 3, 2, 2));
    expect(r.zeroRowAt).not.toBeNull();
    expect(r.clean).toBe(false);
    expect(r.notes.join(" ")).toMatch(/SYMMETRIC ABOUT/i);
  });

  test("a first-column zero is named rather than divided by", () => {
    // s^4 + s^3 + s^2 + s + 1 stalls with a zero first entry.
    const r = routh(P(1, 1, 1, 1, 1));
    expect(r.epsilonAt !== null || r.zeroRowAt !== null).toBe(true);
    expect(r.clean).toBe(false);
  });

  test("a first-order and a constant polynomial do not crash", () => {
    expect(routh(P(1, 1)).signChanges).toBe(0);
    expect(routh(P(1, -1)).signChanges).toBe(1);
    expect(routh(P(5)).signChanges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("stability", () => {
  test("a stable system is reported stable", () => {
    const s = stab(tf("1", "s^2+2s+1"));
    expect(s.stable).toBe(true);
    expect(s.verdict).toMatch(/STABLE/);
    expect(s.rhpPolesNumeric).toBe(0);
    expect(s.disagreement).toBe(false);
  });

  test("a right-half-plane pole is reported unstable", () => {
    const s = stab(tf("1", "s-1"));
    expect(s.stable).toBe(false);
    expect(s.rhpPolesNumeric).toBe(1);
    expect(s.verdict).toMatch(/UNSTABLE/);
  });

  test("an integrator is marginal, not stable", () => {
    const s = stab(tf("1", "s"));
    expect(s.stable).toBe(false);
    expect(s.imaginaryAxisPoles).toBe(1);
    expect(s.verdict).toMatch(/MARGINALLY STABLE/);
  });

  test("an undamped oscillator is marginal", () => {
    const s = stab(tf("1", "s^2+4"));
    expect(s.imaginaryAxisPoles).toBe(2);
    expect(s.verdict).toMatch(/MARGINALLY STABLE/);
  });

  test("the two methods agree on ordinary systems", () => {
    for (const den of ["s^2+2s+1", "s^3+6s^2+11s+6", "s-1", "s^3+s^2+2s+8", "s^2+2s+5"]) {
      const s = stab(tf("1", den));
      expect({ den, disagreement: s.disagreement }).toEqual({ den, disagreement: false });
      if (s.rhpPolesRouth !== null) {
        expect({ den, routh: s.rhpPolesRouth }).toEqual({ den, routh: s.rhpPolesNumeric });
      }
    }
  });

  test("a right-half-plane zero is called out as non-minimum-phase", () => {
    const s = stab(tf("s-1", "s^2+2s+1"));
    expect(s.nonMinimumPhase).toBe(true);
    expect(s.notes.join(" ")).toMatch(/NON-MINIMUM-PHASE/);
    expect(s.notes.join(" ")).toMatch(/WRONG WAY/);
    // Still stable: the zero does not move the poles.
    expect(s.stable).toBe(true);
  });

  test("a left-half-plane zero is not flagged", () => {
    expect(stab(tf("s+1", "s^2+2s+1")).nonMinimumPhase).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("connections", () => {
  test("series multiplies numerators and denominators", () => {
    const a = tf("1", "s+1");
    const b = tf("2", "s+2");
    const c = series(a, b);
    expect(c.num.map(ratToNumber)).toEqual([2]);
    expect(c.den.map(ratToNumber)).toEqual([1, 3, 2]);
  });

  test("unity feedback forms G/(1+G)", () => {
    // G = 1/(s+1) -> T = 1/(s+2)
    const t = feedback(tf("1", "s+1"));
    expect(t.num.map(ratToNumber)).toEqual([1]);
    expect(t.den.map(ratToNumber)).toEqual([1, 2]);
  });

  test("feedback with a non-unity H", () => {
    // G = 1/s, H = 2 -> T = 1/(s+2)
    const t = feedback(tf("1", "s"), tf("2", "1"));
    expect(t.num.map(ratToNumber)).toEqual([1]);
    expect(t.den.map(ratToNumber)).toEqual([1, 2]);
  });

  test("closing the loop can stabilise an unstable plant", () => {
    // G = 1/(s-1) is unstable; unity feedback gives 1/s, marginal; gain 2 gives 1/(s+1).
    expect(stab(tf("1", "s-1")).stable).toBe(false);
    const closed = feedback(series(tf("2", "1"), tf("1", "s-1")));
    expect(closed.den.map(ratToNumber)).toEqual([1, 1]);
    expect(stab(closed).stable).toBe(true);
  });

  test("PID has the expected transfer function", () => {
    const c = pidTf(R(2), R(3), R(1));
    // (s^2 + 2s + 3)/s
    expect(c.num.map(ratToNumber)).toEqual([1, 2, 3]);
    expect(c.den.map(ratToNumber)).toEqual([1, 0]);
  });

  test("a P-only controller has no integrator", () => {
    const c = pidTf(R(5), R(0), R(0));
    expect(c.num.map(ratToNumber)).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
describe("second-order metrics", () => {
  // wn^2 / (s^2 + 2*zeta*wn*s + wn^2) with wn = 2, zeta = 0.5
  test("damping ratio and natural frequency are read off exactly", () => {
    const m = secondOrderMetrics(tf("4", "s^2+2s+4")) as SecondOrderMetrics;
    expect(m.ok).toBe(true);
    near(m.wn, 2);
    near(m.zeta, 0.5);
    near(m.wd, 2 * Math.sqrt(1 - 0.25));
    expect(m.kind).toBe("underdamped");
    expect(m.exact).toBe(true);
  });

  test("overshoot matches the closed form", () => {
    const zeta = 0.5;
    const m = secondOrderMetrics(tf("4", "s^2+2s+4")) as SecondOrderMetrics;
    near(m.overshoot as number, Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)));
    // The familiar number: zeta = 0.5 gives about 16.3% overshoot.
    expect((m.overshoot as number) * 100).toBeCloseTo(16.303, 2);
  });

  test("peak and settling times match the closed forms", () => {
    const m = secondOrderMetrics(tf("4", "s^2+2s+4")) as SecondOrderMetrics;
    const wd = 2 * Math.sqrt(0.75);
    near(m.peakTime as number, Math.PI / wd);
    near(m.settlingTime as number, 4 / (0.5 * 2));
  });

  test("critical damping and overdamping are classified", () => {
    expect((secondOrderMetrics(tf("1", "s^2+2s+1")) as SecondOrderMetrics).kind).toBe("critically damped");
    expect((secondOrderMetrics(tf("1", "s^2+5s+1")) as SecondOrderMetrics).kind).toBe("overdamped");
    expect((secondOrderMetrics(tf("1", "s^2+4")) as SecondOrderMetrics).kind).toBe("undamped");
  });

  test("an overdamped system has no overshoot or peak time", () => {
    const m = secondOrderMetrics(tf("1", "s^2+5s+1")) as SecondOrderMetrics;
    expect(m.overshoot).toBeNull();
    expect(m.peakTime).toBeNull();
    expect(m.settlingTime).not.toBeNull();
  });

  test("a higher-order system says its figures are an approximation", () => {
    const m = secondOrderMetrics(tf("1", "s^3+3s^2+4s+2")) as SecondOrderMetrics;
    expect(m.ok).toBe(true);
    expect(m.exact).toBe(false);
    expect(m.notes.join(" ")).toMatch(/approximation/i);
  });

  test("a close non-dominant pole downgrades the claim further", () => {
    // Poles at -1+-j and -1.5: only 1.5x separation, well under the factor of 5.
    const m = secondOrderMetrics(tf("1", "s^3+3.5s^2+5s+3")) as SecondOrderMetrics;
    expect(m.notes.join(" ")).toMatch(/indicative only/i);
  });

  test("a nearby zero invalidates the formulas and says so", () => {
    const m = secondOrderMetrics(tf("s+1", "s^2+2s+4")) as SecondOrderMetrics;
    expect(m.notes.join(" ")).toMatch(/zero close to the dominant poles/i);
  });

  test("a system with no oscillatory mode is refused, not given a damping ratio", () => {
    const m = secondOrderMetrics(tf("1", "s^2+3s+2"));
    // Real distinct poles: overdamped is still meaningful for order 2.
    expect(m.ok).toBe(true);
    const m2 = secondOrderMetrics(tf("1", "s^3+6s^2+11s+6"));
    expect(m2.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("time response", () => {
  test("first-order step response matches 1 - exp(-t/T)", () => {
    // G = 1/(s+1): y(t) = 1 - e^-t
    const r = timeResponse(tf("1", "s+1"), "step", 5, 200) as TimeResponse;
    expect(r.ok).toBe(true);
    for (let i = 0; i < r.t.length; i++) {
      expect(Math.abs(r.y[i] - (1 - Math.exp(-r.t[i])))).toBeLessThan(1e-7);
    }
    near(r.finalValue as number, 1);
  });

  test("second-order underdamped step matches the closed form", () => {
    // wn = 2, zeta = 0.5
    const wn = 2;
    const z = 0.5;
    const wd = wn * Math.sqrt(1 - z * z);
    const r = timeResponse(tf("4", "s^2+2s+4"), "step", 6, 300) as TimeResponse;
    for (let i = 0; i < r.t.length; i++) {
      const t = r.t[i];
      const exact =
        1 - (Math.exp(-z * wn * t) / Math.sqrt(1 - z * z)) * Math.sin(wd * t + Math.acos(z));
      expect(Math.abs(r.y[i] - exact)).toBeLessThan(1e-6);
    }
  });

  test("the simulated overshoot matches the analytic overshoot", () => {
    // An independent cross-check: the ODE integration and the closed-form
    // metric are computed by completely different routes.
    const r = timeResponse(tf("4", "s^2+2s+4"), "step", 10, 2000) as TimeResponse;
    const m = secondOrderMetrics(tf("4", "s^2+2s+4")) as SecondOrderMetrics;
    const simulatedOvershoot = r.peak.y - 1;
    expect(Math.abs(simulatedOvershoot - (m.overshoot as number))).toBeLessThan(1e-3);
    expect(Math.abs(r.peak.t - (m.peakTime as number))).toBeLessThan(0.02);
  });

  test("impulse response of a first-order lag is exp(-t)", () => {
    const r = timeResponse(tf("1", "s+1"), "impulse", 5, 200) as TimeResponse;
    for (let i = 0; i < r.t.length; i++) {
      expect(Math.abs(r.y[i] - Math.exp(-r.t[i]))).toBeLessThan(1e-7);
    }
  });

  test("DC gain sets the final value", () => {
    // G = 5/(s+2) settles at 5/2.
    const r = timeResponse(tf("5", "s+2"), "step", 10, 200) as TimeResponse;
    near(r.finalValue as number, 2.5);
    expect(Math.abs(r.y[r.y.length - 1] - 2.5)).toBeLessThan(1e-6);
  });

  test("an unstable system gets no final value and says why", () => {
    const r = timeResponse(tf("1", "s-1"), "step", 5, 100) as TimeResponse;
    expect(r.finalValue).toBeNull();
    expect(r.notes.join(" ")).toMatch(/only applies to a stable system/i);
  });

  // An improper transfer function is not realisable, and simulating it as
  // something else would be inventing a system.
  test("an improper transfer function is refused by name", () => {
    const r = timeResponse(tf("s^2", "s+1"), "step", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/IMPROPER/);
  });

  test("a proper-but-not-strictly-proper system has direct feedthrough", () => {
    // G = s/(s+1): step response starts at 1 and decays to 0.
    const r = timeResponse(tf("s", "s+1"), "step", 5, 200) as TimeResponse;
    near(r.y[0], 1);
    expect(Math.abs(r.y[r.y.length - 1])).toBeLessThan(1e-2);
  });

  test("a bad end time is refused", () => {
    expect(timeResponse(tf("1", "s+1"), "step", 0).ok).toBe(false);
    expect(timeResponse(tf("1", "s+1"), "step", -1).ok).toBe(false);
    expect(timeResponse(tf("1", "s+1"), "step", NaN).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("frequency response and margins", () => {
  test("a first-order lag has the textbook corner behaviour", () => {
    // G = 1/(s+1): at w=1, |G| = 1/sqrt(2) (-3 dB) and phase = -45 deg.
    const [p] = frequencyResponse(tf("1", "s+1"), [1]);
    near(p.magnitude, 1 / Math.SQRT2);
    near(p.magnitudeDb, -3.0103, 1e-4);
    near(p.phaseDeg, -45);
  });

  test("an integrator is -20 dB per decade with constant -90 degrees", () => {
    const r = frequencyResponse(tf("1", "s"), [1, 10, 100]);
    near(r[0].magnitudeDb, 0, 1e-9);
    near(r[1].magnitudeDb, -20);
    near(r[2].magnitudeDb, -40);
    for (const p of r) near(p.phaseDeg, -90);
  });

  test("DC gain appears at low frequency", () => {
    const [p] = frequencyResponse(tf("10", "s+1"), [1e-6]);
    near(p.magnitude, 10, 1e-6);
  });

  // L = 1/(s(s+1)) : |L| = 1 where w^2(w^2+1) = 1, and the phase never
  // reaches -180, so the gain margin is infinite.
  test("a system whose phase never reaches -180 has no finite gain margin", () => {
    const m = margins(tf("1", "s^2+s")) as Margins;
    expect(m.gainMarginDb).toBeNull();
    expect(m.notes.join(" ")).toMatch(/NO finite gain margin/i);
    expect(m.phaseMarginDeg).not.toBeNull();
  });

  // L = K/(s(s+1)(s+2)) has phase crossover where w^2 = 2, i.e. w = sqrt(2),
  // and |L(j*sqrt2)| = K/6, so the gain margin is 20*log10(6/K).
  test("gain margin matches the algebraic value", () => {
    const L = tf("1", "s^3+3s^2+2s");
    const m = margins(L) as Margins;
    near(m.phaseCrossoverW as number, Math.SQRT2, 1e-4);
    near(m.gainMarginDb as number, 20 * Math.log10(6), 1e-4);
  });

  test("the gain margin is exactly where the closed loop goes unstable", () => {
    // The independent check: raising K by the gain margin must put closed-loop
    // poles on the imaginary axis. K = 6 for the plant above.
    const L = tf("1", "s^3+3s^2+2s");
    const m = margins(L) as Margins;
    const K = Math.pow(10, (m.gainMarginDb as number) / 20);
    near(K, 6, 1e-4);
    // At K = 6 the closed loop is s^3+3s^2+2s+6, which Routh must call marginal.
    const closed = feedback(series(tf("6", "1"), L));
    const s = analyzeStability(closed) as StabilityResult;
    expect(s.stable).toBe(false);
    // Just below, it is stable; just above, unstable.
    expect((analyzeStability(feedback(series(tf("5", "1"), L))) as StabilityResult).stable).toBe(true);
    expect((analyzeStability(feedback(series(tf("7", "1"), L))) as StabilityResult).rhpPolesNumeric).toBeGreaterThan(0);
  });

  test("phase margin is measured at the 0 dB crossing", () => {
    const L = tf("1", "s^2+s");
    const m = margins(L) as Margins;
    const at = frequencyResponse(L, [m.gainCrossoverW as number])[0];
    near(at.magnitudeDb, 0, 1e-6);
    near(m.phaseMarginDeg as number, 180 + at.phaseDeg, 1e-6);
  });

  test("a small phase margin is called out", () => {
    // K chosen to sit just under the stability limit of 6.
    const m = margins(series(tf("55/10", "1"), tf("1", "s^3+3s^2+2s"))) as Margins;
    expect(m.phaseMarginDeg as number).toBeLessThan(30);
    expect(m.notes.join(" ")).toMatch(/usual design target/i);
  });

  test("phase is unwrapped rather than jumping 360 degrees", () => {
    const r = frequencyResponse(tf("1", "s^3+3s^2+2s"), [0.1, 1, 10, 100]);
    for (let i = 1; i < r.length; i++) {
      expect(Math.abs(r[i].phaseDeg - r[i - 1].phaseDeg)).toBeLessThan(180);
    }
    // Three poles means the phase heads for -270 degrees, not +90.
    expect(r[r.length - 1].phaseDeg).toBeLessThan(-180);
  });
});
