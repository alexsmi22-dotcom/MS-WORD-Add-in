// Control: settling time, margins at the WORST crossing, and a verdict withheld.
//
// Four defects, each independently reproduced before it was touched, and each
// checked here against something outside this code — a simulated step response, a
// brute-force frequency sweep, or an exactly known factorisation.
//
//   A1  settling time used the underdamped envelope 4/(zeta*wn) for zeta >= 1 and
//       flagged the result `exact`. It ran the WRONG WAY: as damping rose the
//       reported time fell. At zeta = 20, wn = 1 it said 0.2 s against a true
//       156 s — 780x optimistic, telling anyone sizing a controller that the loop
//       settles instantly when it crawls.
//   A2  `margins` returned the FIRST gain crossover rather than the worst, so a
//       loop with three crossings at 33, 149 and 23 degrees was reported as having
//       32.5 degrees of phase margin. The margin is the minimum; that is what the
//       word means.
//   A3  the sweep came from `autoFrequencies`, whose range is set by pole and zero
//       magnitudes — which DO NOT MOVE WHEN THE GAIN CHANGES. `1e12/(s+1)^3` has
//       its crossover at omega = 10005 and the sweep stopped at 100, so a loop with
//       a phase margin was reported as having none.
//   A4  `(s^2+1)^3` — three double poles at +/-i, marginally stable — was reported
//       UNSTABLE with 2 poles in the right half plane.

import {
  secondOrderMetrics,
  margins,
  analyzeStability,
  frequencyResponse,
  autoFrequencies,
  TransferFunction,
} from "../control";
import { ratFromNumber } from "../cas";

const tf = (num: number[], den: number[]): TransferFunction => ({
  num: num.map(ratFromNumber),
  den: den.map(ratFromNumber),
});

// ---------------------------------------------------------------------------
// A1 — settling time, against a simulated step response
// ---------------------------------------------------------------------------

/**
 * The 2% settling time from the ANALYTIC step response, swept finely.
 *
 * This is an independent oracle, not a re-implementation: the closed forms below
 * are the textbook step responses of a second-order system, and the crossing is
 * found by scanning rather than by the bisection the module uses.
 */
function simulatedSettlingTime(zeta: number, wn: number): number {
  const y = (t: number): number => {
    if (zeta === 1) return 1 - (1 + wn * t) * Math.exp(-wn * t);
    if (zeta < 1) {
      const wd = wn * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + ((zeta * wn) / wd) * Math.sin(wd * t));
    }
    const r = wn * Math.sqrt(zeta * zeta - 1);
    const p1 = zeta * wn - r;
    const p2 = zeta * wn + r;
    return 1 - (p2 * Math.exp(-p1 * t) - p1 * Math.exp(-p2 * t)) / (p2 - p1);
  };
  const T = Math.max(400, 2000 / wn);
  const N = 2000000;
  let last = 0;
  for (let i = 1; i <= N; i++) {
    const t = (i * T) / N;
    if (Math.abs(y(t) - 1) > 0.02) last = t;
  }
  return last;
}

describe("A1: settling time for a critically damped or overdamped system", () => {
  test.each([
    [1, 1],
    [1.5, 1],
    [2, 1],
    [5, 1],
    [20, 1],
    [2, 10],
    [5, 0.5],
    [1, 4],
    [50, 2],
  ])("zeta = %s, wn = %s matches a simulated step response", (zeta, wn) => {
    const m = secondOrderMetrics(tf([wn * wn], [1, 2 * zeta * wn, wn * wn]));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const truth = simulatedSettlingTime(zeta, wn);
    expect(m.settlingTime).not.toBeNull();
    const rel = Math.abs(m.settlingTime! - truth) / truth;
    expect({ zeta, wn, within: rel < 1e-3 }).toEqual({ zeta, wn, within: true });
  });

  test("settling time INCREASES with damping, which the old formula reversed", () => {
    // The clearest statement of the bug: more damping must mean slower settling.
    // The envelope formula gave 4, 2, 0.8, 0.2 for zeta = 1, 2, 5, 20.
    const ts = [1, 1.5, 2, 5, 10, 20].map((z) => {
      const m = secondOrderMetrics(tf([1], [1, 2 * z, 1]));
      return m.ok ? m.settlingTime! : NaN;
    });
    for (let i = 1; i < ts.length; i++) {
      expect({ i, rising: ts[i] > ts[i - 1] }).toEqual({ i, rising: true });
    }
    // and the specific numbers that were 780x wrong
    expect(ts[0]).toBeCloseTo(5.834, 2);   // was 4
    expect(ts[3]).toBeCloseTo(38.83, 1);   // was 0.8
    expect(ts[5]).toBeCloseTo(156.4, 0);   // was 0.2
  });

  test("the underdamped branch is unchanged, because it is the textbook convention", () => {
    // 4/(zeta*wn) is the standard 2% envelope estimate and students expect it.
    // It is approximate — 2 to 4% off the true crossing — and now says so rather
    // than being silently replaced with a different number.
    const m = secondOrderMetrics(tf([1], [1, 0.4, 1]));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.settlingTime).toBeCloseTo(20, 6);
  });

  test("it terminates promptly for extreme damping", () => {
    // The crossing is bracketed by doubling, and an unbounded search in a task pane
    // is a frozen Word rather than an error message.
    const t0 = Date.now();
    for (const z of [1, 100, 1e4, 1e8]) {
      const m = secondOrderMetrics(tf([1], [1, 2 * z, 1]));
      expect(m.ok).toBe(true);
    }
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// A2 / A3 — margins, against a brute-force sweep
// ---------------------------------------------------------------------------

/** Every |L| = 1 crossing with its phase, from a 12-decade brute-force sweep. */
function bruteForceCrossings(num: number[], den: number[]): Array<{ w: number; pm: number }> {
  const L = tf(num, den);
  const ws: number[] = [];
  for (let i = 0; i <= 40000; i++) ws.push(Math.pow(10, -6 + (12 * i) / 40000));
  const fr = frequencyResponse(L, ws);
  const out: Array<{ w: number; pm: number }> = [];
  for (let i = 1; i < fr.length; i++) {
    if (fr[i - 1].magnitudeDb > 0 !== fr[i].magnitudeDb > 0) {
      out.push({ w: ws[i], pm: 180 + fr[i].phaseDeg });
    }
  }
  return out;
}

describe("A2: the margin reported is the WORST crossing, not the first", () => {
  // A resonant loop: 100*(s^2+0.02s+1)/(s+1)^4 crosses 0 dB three times.
  const NUM = [100, 2, 100];
  const DEN = [1, 4, 6, 4, 1];

  test("all three crossings are found", () => {
    const m = margins(tf(NUM, DEN));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.gainCrossings.length).toBe(3);
  });

  test("the reported phase margin is the minimum, and matches a brute-force sweep", () => {
    const m = margins(tf(NUM, DEN));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const truth = bruteForceCrossings(NUM, DEN);
    expect(truth.length).toBe(3);
    const worst = Math.min(...truth.map((c) => c.pm));
    // The old code returned 32.5 — the first crossing — where the binding margin
    // is about 23.1 degrees.
    expect(m.phaseMarginDeg!).toBeCloseTo(worst, 0);
    expect(m.phaseMarginDeg!).toBeLessThan(25);
    for (const c of m.gainCrossings) {
      expect(m.phaseMarginDeg!).toBeLessThanOrEqual(c.marginDeg + 1e-9);
    }
  });

  test("multiple crossings are DISCLOSED, not silently reduced to one number", () => {
    // Three crossings at 33, 149 and 23 degrees is a different engineering
    // situation from one crossing at 23, even though the margin is the same.
    const m = margins(tf(NUM, DEN));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.notes.join(" ")).toMatch(/crosses 0 dB at 3 frequencies/);
    expect(m.notes.join(" ")).toMatch(/SMALLEST/);
  });

  test("a single-crossing loop is unaffected", () => {
    // K/(s(s+1)(s+2)) with K = 1: gain margin 20*log10(6) = 15.563 dB exactly.
    const m = margins(tf([1], [1, 3, 2, 0]));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.gainCrossings.length).toBe(1);
    expect(m.gainMarginDb!).toBeCloseTo(20 * Math.log10(6), 3);
    expect(m.notes.join(" ")).not.toMatch(/frequencies/);
  });

  test("the gain margin at multiple phase crossovers is also the worst", () => {
    const m = margins(tf(NUM, DEN));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    for (const c of m.phaseCrossings) {
      expect(m.gainMarginDb!).toBeLessThanOrEqual(c.marginDb + 1e-9);
    }
  });
});

describe("A3: the sweep is extended until the magnitude brackets 0 dB", () => {
  test("a high-gain loop whose crossover lies outside the pole/zero range", () => {
    // 1e12/(s+1)^3. Every pole is at 1, so autoFrequencies stops at 100 — but the
    // crossover is at omega = 10005. The old code reported NO phase margin.
    const NUM = [1e12];
    const DEN = [1, 3, 3, 1];
    const plotRange = autoFrequencies(tf(NUM, DEN));
    const truth = bruteForceCrossings(NUM, DEN);
    expect(truth.length).toBe(1);
    // The premise of the test: the crossover really is outside the plotting range.
    expect(truth[0].w).toBeGreaterThan(plotRange[plotRange.length - 1]);

    const m = margins(tf(NUM, DEN));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.phaseMarginDeg).not.toBeNull();
    expect(m.phaseMarginDeg!).toBeCloseTo(truth[0].pm, 0);
    expect(m.gainCrossoverW!).toBeCloseTo(truth[0].w, -2);
  });

  test.each([
    [[1e3], [1, 3, 3, 1]],
    [[1e6], [1, 3, 3, 1]],
    [[1e9], [1, 3, 3, 1]],
    [[1e12], [1, 3, 3, 1]],
    [[1e15], [1, 3, 3, 1]],
    [[1e6], [1, 6, 11, 6]],
    [[1e9], [1, 2, 1]],
  ])("a crossover that EXISTS is found, whatever the loop gain", (num, den) => {
    // One-directional on purpose. The converse would be wrong: 1/(s+1)^3 has
    // |L| = 1 exactly at DC, so it genuinely has a crossover at omega -> 0 that a
    // log-spaced brute-force sweep cannot represent. `margins` reporting 180
    // degrees there is correct, and an oracle that cannot see omega = 0 must not be
    // used to contradict it. What matters is the direction that was broken: a real
    // crossover must never be missed because the gain pushed it outside the range
    // the pole magnitudes suggested.
    const truth = bruteForceCrossings(num, den);
    expect(truth.length).toBeGreaterThan(0); // premise of this case
    const m = margins(tf(num, den));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect({ num, found: m.phaseMarginDeg !== null }).toEqual({ num, found: true });
    const worst = Math.min(...truth.map((c) => c.pm));
    expect(Math.abs(m.phaseMarginDeg! - worst)).toBeLessThan(1);
  });

  test("a loop with genuinely no gain crossover still says so", () => {
    // 0.01/(s+1): |L| never reaches 1, so there is no phase margin and none must
    // be invented. Extending the sweep must not manufacture one.
    const m = margins(tf([0.01], [1, 1]));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.phaseMarginDeg).toBeNull();
    expect(m.notes.join(" ")).toMatch(/never crosses 0 dB/);
  });

  test("it stays fast enough for a task pane", () => {
    const t0 = Date.now();
    for (const k of [1, 1e3, 1e6, 1e9, 1e12]) margins(tf([k], [1, 3, 3, 1]));
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// A4 — a verdict withheld, and the refusal itself asserted
// ---------------------------------------------------------------------------

describe("A4: a repeated pole near the axis makes the verdict unresolvable", () => {
  // Truth comes from the factorisation, which is exact and known by construction.
  test.each([
    // label, descending coefficients, repeated?, verdict prefix
    ["(s+1)(s+2)", [1, 3, 2], false, "STABLE"],
    ["(s+1)(s+2)(s+3)", [1, 6, 11, 6], false, "STABLE"],
    ["s^2+2s+5", [1, 2, 5], false, "STABLE"],
    ["s^2+1", [1, 0, 1], false, "MARGINALLY STABLE"],
    ["s (integrator)", [1, 0], false, "MARGINALLY STABLE"],
    ["(s-1)(s+2)", [1, 1, -2], false, "UNSTABLE"],
    ["s^4-1", [1, 0, 0, 0, -1], false, "UNSTABLE"],
    // Repeated, but the verdict is still sound.
    ["(s+1)^2", [1, 2, 1], true, "STABLE"],
    ["(s+1)^3", [1, 3, 3, 1], true, "STABLE"],
    ["(s+1)^2(s+2)", [1, 4, 5, 2], true, "STABLE"],
    ["(s-1)^2", [1, -2, 1], true, "UNSTABLE"],
    ["(s^2-1)^2", [1, 0, -2, 0, 1], true, "UNSTABLE"],
    ["s^2 (double at origin)", [1, 0, 0], true, "MARGINALLY STABLE"],
    ["s^3 (triple at origin)", [1, 0, 0, 0], true, "MARGINALLY STABLE"],
    // Repeated AND on the axis: genuinely unresolvable.
    ["(s^2+1)^2", [1, 0, 2, 0, 1], true, "UNDETERMINED"],
    ["(s^2+1)^3", [1, 0, 3, 0, 3, 0, 1], true, "UNDETERMINED"],
  ] as [string, number[], boolean, string][])("%s", (_label, den, repeated, verdict) => {
    const r = analyzeStability(tf([1], den));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repeatedPole).toBe(repeated);
    expect(r.verdict.startsWith(verdict)).toBe(true);
  });

  test("the refusal is asserted directly, so a future root-finder cannot quietly resume guessing", () => {
    // (s^2+1)^3 is three double poles at +/-i — marginally stable — and was
    // reported UNSTABLE with 2 poles in the right half plane. The point of the fix
    // is that no verdict is asserted, so THAT is what is pinned here.
    const r = analyzeStability(tf([1], [1, 0, 3, 0, 3, 0, 1]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verdict).toMatch(/^UNDETERMINED/);
    expect(r.verdict).toMatch(/REPEATED pole/);
    expect(r.verdict).toMatch(/Treat this as MARGINAL/);
    expect(r.stable).toBe(false);
    // and it must NOT claim right-half-plane poles
    expect(r.verdict).not.toMatch(/right half plane\./);
  });

  test("repeated-root detection is exact, so it does not depend on pole accuracy", () => {
    // gcd(p, p') over the rationals. The first version of this helper was written
    // for ascending coefficients while this module is highest-power-first — which
    // happens to be right for a palindrome like (s^2+1)^n, the very case it was
    // built for, and wrong for s^2. Hence the deliberately unpalindromic cases.
    const cases: Array<[number[], boolean]> = [
      [[1, 0, 0], true],
      [[1, 0, 0, 0], true],
      [[1, 4, 5, 2], true],
      [[1, 6, 11, 6], false],
      [[1, 1, 1, 1], false],
      [[2, 8, 10, 4], true],
      [[1, 0, 1], false],
    ];
    for (const [den, want] of cases) {
      const r = analyzeStability(tf([1], den));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect({ den, rep: r.repeatedPole }).toEqual({ den, rep: want });
    }
  });
});
