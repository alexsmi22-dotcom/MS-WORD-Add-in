// Control design engine: root locus, Nyquist, lead/lag, discrete time.
//
// EXTERNAL ORACLES. Every pinned number below comes from outside this code:
// scipy.signal 1.18.1 (cont2discrete, bilinear, dstep, freqresp-style brute-force
// crossover search) or a closed form written out in the comment next to it.
// The oracle scripts, run with the session venv's python -I:
//
//   # c2d + dstep
//   import numpy as np, scipy.signal as sg
//   r = sg.cont2discrete(([1],[1,3,2]), 0.1, method='zoh')       # also 'bilinear'
//   t, y = sg.dstep((n, d, 0.1), n=12)
//   fs = w/(2*np.tan(w*T/2)); sg.bilinear([1,1],[1,0.5,4], fs=fs) # Tustin prewarped
//
//   # phase margin of a designed loop, brute force + brentq on |L(jw)| = 1
//   ws = np.logspace(-4,4,200001); ... brentq(f, ws[k], ws[k+1]); 180 + angle(L)
//
//   # breakaway: roots of N'D - ND', K = -D/N at each
//   q = np.polysub(np.polymul(np.polyder(num),den), np.polymul(num,np.polyder(den)))

import { parseTf, polyRootsNumeric, polyRoots, TransferFunction, ControlError, analyzeStability, feedback, margins, Margins } from "../control";
import {
  rootLocus,
  nyquist,
  designCompensator,
  c2d,
  discreteStep,
  expm,
  charPoly,
  schurCohnStable,
  errorConstant,
  RootLocusResult,
  NyquistResult,
  CompensatorResult,
  C2dResult,
  ratSqrtExact,
  fmtShort,
} from "../controlDesign";
import { ratMake, ratInt, parseRatLiteral, Rat } from "../cas";

function tf(n: string, d: string): TransferFunction {
  const r = parseTf(n, d);
  if ("ok" in r) throw new Error(r.error);
  return r;
}
function ok<T extends { ok: true }>(r: T | ControlError): T {
  if (!r.ok) throw new Error((r as ControlError).error);
  return r as T;
}
const q = (s: string): Rat => parseRatLiteral(s) as Rat;
const rs = (r: Rat | null): string | null => (r ? `${r.n}/${r.d}` : null);

describe("root locus", () => {
  test("G = 1/(s(s+1)(s+2)): jw crossing K = 6 at omega = sqrt 2, exact and Routh-confirmed", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^3+3*s^2+2*s")));
    expect(rl.crossings).toHaveLength(1);
    const c = rl.crossings[0];
    expect(rs(c.kExact)).toBe("6/1");
    expect(rs(c.w2Exact)).toBe("2/1");
    expect(c.wExact).toBeNull(); // sqrt 2 is irrational
    expect(c.w).toBeCloseTo(Math.SQRT2, 14);
    expect(c.routhConfirmed).toBe(true);
    // stable for 0 < K < 6 exactly
    expect(rl.stableRanges).toHaveLength(1);
    expect(rl.stableRanges[0].lo).toBe(0);
    expect(rs(rl.stableRanges[0].hiExact)).toBe("6/1");
  });

  test("asymptotes: centroid -1 exactly, angles -60, 60, 180; real-axis segments s <= -2 and -1..0", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^3+3*s^2+2*s")));
    expect(rs(rl.centroid)).toBe("-1/1");
    expect(rl.asymptoteAnglesDeg).toEqual([-60, 60, 180]);
    expect(rl.realSegments).toEqual([
      { from: -Infinity, to: -2 },
      { from: -1, to: 0 },
    ]);
  });

  test("breakaway: only s = -0.42265 (K = 0.38490) survives; -1.57735 has K < 0 and is rejected (numpy)", () => {
    // numpy: roots of N'D - ND' = -(3s^2+6s+2): -1.5773502691896257 (K = -0.3849), -0.42264973081037427 (K = 0.38490017945975047)
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^3+3*s^2+2*s")));
    expect(rl.breakaways).toHaveLength(1);
    expect(rl.breakaways[0].s.re).toBeCloseTo(-0.42264973081037427, 12);
    expect(rl.breakaways[0].K).toBeCloseTo(0.38490017945975047, 12);
  });

  test("rational breakaway is exact: G = (s+1)/s^2 breaks in at s = -2, K = 4", () => {
    // N'D - ND' = s^2 - 2s(s+1) = -s^2 - 2s -> s = -2 (s = 0 is the double pole, K = 0)
    const rl = ok<RootLocusResult>(rootLocus(tf("s+1", "s^2")));
    expect(rl.breakaways.map((b) => [rs(b.sExact), rs(b.kExact)])).toEqual([["-2/1", "4/1"]]);
    expect(rl.crossings).toHaveLength(0);
    expect(rl.stableRanges).toEqual([{ lo: 0, hi: null, loExact: ratInt(0), hiExact: null }]);
  });

  test("irrational crossing gets a closed-form omega^2 surd: (s+3)/(s(s+1)(s+2)(s+4))", () => {
    // Re: w^4 - 14 w^2 + 3K = 0, Im: K = 7 w^2 - 8  =>  u^2 + 7u - 24 = 0, u = (-7 + sqrt 145)/2
    // numpy scan: w = 1.5877, K = 9.6455
    const rl = ok<RootLocusResult>(rootLocus(tf("s+3", "s^4+7*s^3+14*s^2+8*s")));
    expect(rl.crossings).toHaveLength(1);
    const c = rl.crossings[0];
    const u = (-7 + Math.sqrt(145)) / 2;
    expect(c.w).toBeCloseTo(Math.sqrt(u), 12);
    expect(c.K).toBeCloseTo(7 * u - 8, 10);
    expect(c.w2Surd).toBe("(−7 + √145)/2");
    expect(c.routhConfirmed).toBeNull();
    // numpy breakaway: s = -0.4349223187724237 with K = 0.5345941756679462
    expect(rl.breakaways).toHaveLength(1);
    expect(rl.breakaways[0].s.re).toBeCloseTo(-0.4349223187724237, 10);
    expect(rl.breakaways[0].K).toBeCloseTo(0.5345941756679462, 10);
  });

  test("order 20: (s+1)^20 + K crosses at K = (1/cos(pi/20))^20, omega = tan(pi/20), and K = 1024 at omega = 1 exactly", () => {
    // closed form: s = -1 + K^(1/20) e^{j(2l+1)pi/20}; Re s = 0 <=> K^(1/20) cos((2l+1)pi/20) = 1
    const den = "1 20 190 1140 4845 15504 38760 77520 125970 167960 184756 167960 125970 77520 38760 15504 4845 1140 190 20 1";
    const t0 = Date.now();
    const rl = ok<RootLocusResult>(rootLocus(tf("1", den)));
    expect(Date.now() - t0).toBeLessThan(3000);
    const ks = rl.crossings.map((c) => c.K);
    expect(ks[0]).toBeCloseTo(Math.pow(1 / Math.cos(Math.PI / 20), 20), 8);
    expect(rl.crossings[0].w).toBeCloseTo(Math.tan(Math.PI / 20), 9);
    const one = rl.crossings.find((c) => c.w2Exact && rs(c.w2Exact) === "1/1");
    expect(one && rs(one.kExact)).toBe("1024/1");
    expect(one && one.routhConfirmed).toBe(true);
  });

  test("the sweep starts at the poles and is bounded; K marks the closed-loop poles (numpy roots of s^3+3s^2+2s+1)", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^3+3*s^2+2*s"), ratInt(1)));
    expect(rl.branches).toHaveLength(3);
    expect(rl.gains.length).toBeLessThanOrEqual(1501);
    expect(rl.sweepCapped).toBe(false);
    const p = rl.atK!.poles.map((z) => z.re).sort((a, b) => a - b);
    expect(p[0]).toBeCloseTo(-2.32471796, 7);
    expect(p[1]).toBeCloseTo(-0.33764102, 7);
    expect(rl.atK!.stability.stable).toBe(true);
    // branch continuity: no step jumps more than a quarter of the plot scale
    for (const br of rl.branches) {
      for (let i = 1; i < br.length; i++) {
        const d = Math.hypot(br[i].re - br[i - 1].re, br[i].im - br[i - 1].im);
        expect(d).toBeLessThan(0.25 * Math.max(3, Math.hypot(br[i].re, br[i].im)));
      }
    }
  });

  test("undamped s^2 + 1: the locus lies on the axis, reported instead of a fake crossing", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^2+1")));
    expect(rl.jwAxisLocus).toBe(true);
    expect(rl.crossings).toHaveLength(0);
  });

  test("complementary locus: (1 - s)/(s + 1) leads with opposite signs; degree drops at K = 1", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("-s+1", "s+1")));
    expect(rl.complementary).toBe(true);
    expect(rl.stableRanges.length).toBe(1);
    expect(rs(rl.stableRanges[0].hiExact)).toBe("1/1");
  });

  test("unstable open loop 1/(s-1): branch crosses the origin at K = 1, stable for K > 1", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s-1")));
    expect(rs(rl.originCrossingK)).toBe("1/1");
    expect(rl.stableRanges[0].lo).toBe(1);
    expect(rl.stableRanges[0].hi).toBeNull();
  });

  test("refusals: zero numerator, improper, constant denominator", () => {
    expect(rootLocus(tf("0", "s+1")).ok).toBe(false);
    expect(rootLocus(tf("s^3", "s+1")).ok).toBe(false);
    expect(rootLocus(tf("1", "5")).ok).toBe(false);
  });
});

describe("Nyquist", () => {
  const cases: Array<[string, string, number, number, number]> = [
    // num, den, P, N, Z   (closed-loop RHP counts from numpy roots of den+num)
    ["1", "s^3+3*s^2+2*s", 0, 0, 0],
    ["10", "s^3+3*s^2+2*s", 0, 2, 2], // s^3+3s^2+2s+10: two RHP roots (Routh: 3*2 < 10)
    ["2", "s-1", 1, -1, 0], // closed loop s + 1
    ["s+2", "s^2-1", 1, -1, 0], // closed loop s^2 + s + 1
    ["1", "s^4+2*s^2+1", 0, 2, 2], // (s^2+1)^2 + 1: s^2 = -1 +/- j, two RHP roots
  ];
  test.each(cases)("L = (%s)/(%s): P = %i, N = %i, Z = %i, and Z agrees with the closed-loop poles", (n, d, P, N, Z) => {
    const ny = ok<NyquistResult>(nyquist(tf(n, d)));
    expect(ny.P).toBe(P);
    expect(ny.N).toBe(N);
    expect(ny.Z).toBe(Z);
    expect(ny.closedRhp).toBe(Z);
    expect(ny.agree).toBe(true);
    expect(ny.evaluations).toBeLessThanOrEqual(250000 + 1000);
  });

  test("axis poles are found exactly and indented: s = 0 once; +/-j1 twice", () => {
    expect(ok<NyquistResult>(nyquist(tf("1", "s^3+3*s^2+2*s"))).axisPoles).toEqual([{ w: 0, mult: 1 }]);
    expect(ok<NyquistResult>(nyquist(tf("1", "s^4+2*s^2+1"))).axisPoles).toEqual([{ w: 1, mult: 2 }]);
  });

  test("critical gain K = 6: the curve passes through -1, so nothing is counted or decided", () => {
    const ny = ok<NyquistResult>(nyquist(tf("6", "s^3+3*s^2+2*s")));
    expect(ny.throughMinusOne).toBe(true);
    expect(ny.N).toBeNull();
    expect(ny.stable).toBeNull();
    expect(ny.verdict).toMatch(/^MARGINAL/);
  });

  test("margins on the plot are margins() exactly: GM 15.56 dB at sqrt 2, PM 53.41 deg", () => {
    // closed form: phase -180 at w^2 = 2, |L| = 1/(sqrt2 * sqrt3 * sqrt6) = 1/6 -> GM = 20 log10 6 = 15.563 dB
    const ny = ok<NyquistResult>(nyquist(tf("1", "s^3+3*s^2+2*s")));
    expect(ny.margins!.gainMarginDb!).toBeCloseTo(20 * Math.log10(6), 6);
    expect(ny.margins!.phaseCrossoverW!).toBeCloseTo(Math.SQRT2, 6);
    expect(ny.margins!.phaseMarginDeg!).toBeCloseTo(53.41, 2);
  });

  test("refusals: improper and constant", () => {
    expect(nyquist(tf("s^2", "s+1")).ok).toBe(false);
    expect(nyquist(tf("1", "3")).ok).toBe(false);
  });

  test("order-20 loop stays inside the evaluation budget and the time budget", () => {
    const t0 = Date.now();
    const ny = ok<NyquistResult>(
      nyquist(tf("1", "1 20 190 1140 4845 15504 38760 77520 125970 167960 184756 167960 125970 77520 38760 15504 4845 1140 190 20 1")),
    );
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ny.Z).toBe(0); // (s+1)^20 + 1: Re of roots = -1 + cos(pi/20) < 0
    expect(ny.agree).toBe(true);
  });
});

describe("lead / lag design", () => {
  test("Ogata-style lead: G = 4/(s(s+2)), Kv = 20, PM 50: C(s) = (2.268s + 10)/(0.0563s + 1), verified PM 49.77 deg (scipy brentq)", () => {
    const r = ok<CompensatorResult>(designCompensator(tf("4", "s^2+2*s"), { kind: "lead", pm: 50, wc: null, errorConst: 20 }));
    expect(r.C.num.map(rs)).toEqual(["567/250", "10/1"]); // 2.268, 10
    expect(r.C.den.map(rs)).toEqual(["563/10000", "1/1"]); // 0.0563, 1
    // scipy oracle for THIS printed C(s): crossover 8.84903657698544, PM 49.767611402739476
    expect(r.after.gainCrossoverW!).toBeCloseTo(8.84903657698544, 6);
    expect(r.after.phaseMarginDeg!).toBeCloseTo(49.767611402739476, 4);
    expect(r.errAfter.name).toBe("Kv");
    expect(r.errAfter.value).toBeCloseTo(20, 12);
    expect(r.targetMet).toBe(true);
    // closed-loop overshoot, scipy step on 200001 points: 22.405 %; this simulation samples 400 points
    expect(r.stepAfter!.overshootPct!).toBeCloseTo(22.405, 0);
    expect(r.stepBefore!.overshootPct!).toBeCloseTo(16.303, 0);
  });

  test("lead at a chosen crossover places it there exactly (scipy: 9.000710 rad/s, PM 49.991 deg)", () => {
    const r = ok<CompensatorResult>(designCompensator(tf("4", "s^2+2*s"), { kind: "lead", pm: 50, wc: 9, errorConst: null }));
    expect(r.after.gainCrossoverW!).toBeCloseTo(9.000710353060986, 5);
    expect(r.after.phaseMarginDeg!).toBeCloseTo(49.99135181069582, 4);
  });

  test("lag: G = 1/(s(s+1)(0.5s+1)), Kv = 5, PM 40: verified PM 39.927 deg at 0.56365 rad/s (scipy)", () => {
    const r = ok<CompensatorResult>(designCompensator(tf("1", "0.5*s^3+1.5*s^2+s"), { kind: "lag", pm: 40, wc: null, errorConst: 5 }));
    expect(r.C.num.map(rs)).toEqual(["2226/25", "5/1"]); // 89.04 s + 5
    expect(r.C.den.map(rs)).toEqual(["1331/10", "1/1"]); // 133.1 s + 1
    expect(r.after.phaseMarginDeg!).toBeCloseTo(39.927388389388085, 4);
    expect(r.after.gainCrossoverW!).toBeCloseTo(0.5636488959866733, 6);
    expect(r.errAfter.value).toBeCloseTo(5, 12);
    expect(r.closedAfter.stable).toBe(true);
  });

  test("more lead than one stage can give is refused with the two-stage advice", () => {
    const r = designCompensator(tf("4", "s^2+2*s"), { kind: "lead", pm: 85, wc: null, errorConst: 20 });
    expect(r.ok).toBe(false);
    expect((r as ControlError).error).toMatch(/two lead stages/);
  });

  test("a loop already meeting the target gets the gain alone, with no false 'missed' note", () => {
    const r = ok<CompensatorResult>(designCompensator(tf("1", "s^3+3*s^2+2*s"), { kind: "lead", pm: 50, wc: null, errorConst: null }));
    expect(r.C.den).toHaveLength(1);
    expect(r.targetMet).toBe(true);
  });

  test("error constants by type: Kp, Kv, Ka", () => {
    expect(errorConstant(tf("2", "s+4"))).toEqual({ type: 0, value: 0.5, name: "Kp" });
    expect(errorConstant(tf("4", "s^2+2*s"))).toEqual({ type: 1, value: 2, name: "Kv" });
    expect(errorConstant(tf("3", "s^3+s^2"))).toEqual({ type: 2, value: 3, name: "Ka" });
  });

  test("refusals: PM outside (0, 90), improper plant, negative error constant", () => {
    expect(designCompensator(tf("4", "s^2+2*s"), { kind: "lead", pm: 95, wc: null, errorConst: null }).ok).toBe(false);
    expect(designCompensator(tf("4", "s^2+2*s"), { kind: "lead", pm: 0, wc: null, errorConst: null }).ok).toBe(false);
    expect(designCompensator(tf("s^3", "s+1"), { kind: "lead", pm: 50, wc: null, errorConst: null }).ok).toBe(false);
    expect(designCompensator(tf("4", "s^2+2*s"), { kind: "lag", pm: 50, wc: null, errorConst: -3 }).ok).toBe(false);
  });
});

describe("discrete time", () => {
  const close = (a: number[], b: number[], tol = 1e-12): void => {
    expect(a.length).toBe(b.length);
    a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol * Math.max(1, Math.abs(b[i]))));
  };
  // scipy.signal.cont2discrete, method 'zoh' / 'bilinear'
  const ORACLE: Array<[string, string, number, "zoh" | "tustin", number[], number[]]> = [
    ["1", "s^2+3*s+2", 0.1, "zoh", [0, 0.004527958503031, 0.004097066280857], [1, -1.723568171113941, 0.740818220681718]],
    ["1", "s^2+3*s+2", 0.1, "tustin", [0.002164502164502, 0.004329004329005, 0.002164502164502], [1, -1.722943722943723, 0.74025974025974]],
    ["s+1", "s^2+0.5*s+4", 0.2, "zoh", [0, 0.204385880021098, -0.166825597952652], [1, -1.754596289762178, 0.90483741803596]],
    ["s+1", "s^2+0.5*s+4", 0.2, "tustin", [0.100917431192661, 0.018348623853211, -0.08256880733945], [1, -1.761467889908257, 0.908256880733945]],
    ["1", "s^2+s", 0.5, "zoh", [0, 0.106530659712633, 0.09020401043105], [1, -1.606530659712633, 0.606530659712633]],
    ["1", "s^2+s", 0.5, "tustin", [0.05, 0.1, 0.05], [1, -1.6, 0.6]],
    ["2*s+3", "s^2+4*s+5", 0.05, "zoh", [0, 0.093954453855656, -0.087163930263095], [1, -1.807413213757047, 0.818730753077982]],
    ["2*s+3", "s^2+4*s+5", 0.05, "tustin", [0.047025495750708, 0.003399433427762, -0.043626062322946], [1, -1.807365439093485, 0.818696883852691]],
  ];
  test.each(ORACLE)("c2d((%s)/(%s), T = %d, %s) matches scipy.signal.cont2discrete", (n, d, T, m, bn, bd) => {
    const r = ok<C2dResult>(c2d(tf(n, d), T, m));
    close(r.gd.num, bn);
    close(r.gd.den, bd);
  });

  test("Tustin with a rational T is EXACT: 1/(s^2+s) at T = 1/2 -> (z^2 + 2z + 1)/20 over z^2 - 8/5 z + 3/5", () => {
    const r = ok<C2dResult>(c2d(tf("1", "s^2+s"), 0.5, "tustin"));
    expect(r.gd.numExact!.map(rs)).toEqual(["1/20", "1/10", "1/20"]);
    expect(r.gd.denExact!.map(rs)).toEqual(["1/1", "-8/5", "3/5"]);
  });

  test("Tustin prewarped at 2 rad/s matches scipy.signal.bilinear with fs = w/(2 tan(wT/2))", () => {
    const r = ok<C2dResult>(c2d(tf("s+1", "s^2+0.5*s+4"), 0.2, "tustin", 2));
    close(r.gd.num, [0.102244953775707, 0.018818707752126, -0.083426246023581], 1e-12);
    close(r.gd.den, [1, -1.75661473808335, 0.907164400100356], 1e-12);
  });

  test("matched pole-zero, closed form: a/(s+a) -> (1 - e^(-aT))/2 * (z + 1)/(z - e^(-aT))", () => {
    const r = ok<C2dResult>(c2d(tf("1", "s+1"), 0.5, "matched"));
    const p = Math.exp(-0.5);
    close(r.gd.num, [(1 - p) / 2, (1 - p) / 2], 1e-14);
    close(r.gd.den, [1, -p], 1e-14);
  });

  test("matched with an integrator keeps the low-frequency gain: lim ((z-1)/T) Gd(z) = lim s G(s) = 1", () => {
    const r = ok<C2dResult>(c2d(tf("1", "s^2+s"), 0.1, "matched"));
    // Gd(z) = k (z+1)^2 / ((z-1)(z-e^-0.1));  ((z-1)/T) Gd at z=1 = k*4/((1-e^-0.1) T)
    const k = r.gd.num[0];
    expect((k * 4) / ((1 - Math.exp(-0.1)) * 0.1)).toBeCloseTo(1, 12);
    expect(r.onCircle).toBe(1);
  });

  test("discrete step = scipy.signal.dstep for the ZOH models", () => {
    const r1 = ok<C2dResult>(c2d(tf("1", "s^2+3*s+2"), 0.1, "zoh"));
    close(discreteStep(r1.gd, 12), [0, 0.004527958503031, 0.016429269939837, 0.033587597365295, 0.054344436022971, 0.077409060873087, 0.101785469862073, 0.126713178179392, 0.151619294880104, 0.176079784370192, 0.199788200446862, 0.222530495483085], 1e-11);
    const r2 = ok<C2dResult>(c2d(tf("s+1", "s^2+0.5*s+4"), 0.2, "zoh"));
    close(discreteStep(r2.gd, 12), [0, 0.204385880021098, 0.396174988833241, 0.547751455610526, 0.640168999808211, 0.66517242113263, 0.625420479346759, 0.533047838585174, 0.406940190196807, 0.26925439998782, 0.141778342296475, 0.042692579350672], 1e-11);
    const r3 = ok<C2dResult>(c2d(tf("1", "s^2+s"), 0.5, "zoh"));
    close(discreteStep(r3.gd, 12), [0, 0.106530659712633, 0.367879441171442, 0.72313016014843, 1.135335283236613, 1.582084998623899, 2.049787068367864, 2.530197383422319, 3.018315638888734, 3.511108996538242, 4.006737946999086, 4.504086771438464], 1e-11);
  });

  test("stability: exact Jury (Schur-Cohn) agrees with the mapped poles; unstable and marginal cases", () => {
    const s = ok<C2dResult>(c2d(tf("1", "s^2+3*s+2"), 0.1, "zoh"));
    expect(s.juryStable).toBe(true);
    expect(s.numericStable).toBe(true);
    expect(s.maxPoleMag).toBeCloseTo(Math.exp(-0.1), 14);
    const u = ok<C2dResult>(c2d(tf("1", "s-1"), 0.1, "zoh"));
    expect(u.juryStable).toBe(false);
    expect(u.outside).toBe(1);
    expect(u.verdict).toMatch(/^UNSTABLE/);
    const m = ok<C2dResult>(c2d(tf("1", "s^2+100"), 0.5, "zoh"));
    expect(m.onCircle).toBe(2);
    expect(m.notes.join(" ")).toMatch(/ALIASES/);
  });

  test("Schur-Cohn on hand cases: z - 1/2 stable; z - 2 not; z^2 + 1 (on the circle) not strictly stable", () => {
    expect(schurCohnStable([ratInt(1), ratMake(-1n, 2n)])).toBe(true);
    expect(schurCohnStable([ratInt(1), ratInt(-2)])).toBe(false);
    expect(schurCohnStable([ratInt(1), ratInt(0), ratInt(1)])).toBe(false);
    // (z - 0.9)(z + 0.8)(z - 0.5j)(z + 0.5j) = z^4 - 0.1 z^3 - 0.47 z^2 - 0.025 z - 0.18
    expect(schurCohnStable([q("1"), q("-0.1"), q("-0.47"), q("-0.025"), q("-0.18")])).toBe(true);
  });

  test("expm and charPoly against closed forms", () => {
    // exp([[0,1],[-1,0]] t) = [[cos t, sin t],[-sin t, cos t]]
    const E = expm([
      [0, 2],
      [-2, 0],
    ])!;
    expect(E[0][0]).toBeCloseTo(Math.cos(2), 13);
    expect(E[0][1]).toBeCloseTo(Math.sin(2), 13);
    // companion matrix of s^3 + 3 s^2 + 2 s + 5
    expect(charPoly([
      [0, 1, 0],
      [0, 0, 1],
      [-5, -2, -3],
    ]).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, 3, 2, 5]);
  });

  test("refusals: T <= 0, T so short the coefficients cancel, T so long the exponential overflows, prewarp above Nyquist", () => {
    expect(c2d(tf("1", "s+1"), 0, "zoh").ok).toBe(false);
    expect(c2d(tf("4", "s^2+2*s+4"), 1e-9, "zoh").ok).toBe(false);
    expect(c2d(tf("1", "s-1"), 1000, "zoh").ok).toBe(false);
    expect(c2d(tf("1", "s+1"), 0.2, "tustin", 100).ok).toBe(false);
    expect(c2d(tf("s^2", "s+1"), 0.2, "zoh").ok).toBe(false);
  });
});

describe("shared plumbing", () => {
  test("polyRoots delegates to polyRootsNumeric: one root finder", () => {
    const a = polyRoots([ratInt(1), ratInt(3), ratInt(2)])!;
    const b = polyRootsNumeric([1, 3, 2])!;
    expect(a).toEqual(b);
    // a rational lead that underflows as a double stays "no answer", not a lower degree
    expect(polyRoots([ratMake(1n, 10n ** 400n), ratInt(1), ratInt(1)])).toBeNull();
  });

  test("ratSqrtExact and fmtShort", () => {
    expect(rs(ratSqrtExact(ratMake(9n, 4n)))).toBe("3/2");
    expect(ratSqrtExact(ratInt(2))).toBeNull();
    expect(fmtShort(1.5)).toBe("1.5");
    expect(fmtShort(-0.000012346)).toBe("−1.235×10⁻⁵");
    expect(fmtShort(200000)).toBe("2×10⁵");
  });

  test("Z = N + P agrees with the closed-loop poles over 40 pseudo-random loops (regression: uniform axis sampling missed every encirclement)", () => {
    // Deterministic pseudo-random third-order loops, stable and unstable. The first
    // contour sampled the axis uniformly from -R to R and returned N = 0 for loops that
    // encircle -1 twice (e.g. 24/(s^3+4s^2+4s+2)); the closed-loop cross-check caught it.
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let compared = 0;
    for (let i = 0; i < 40; i++) {
      const a = Math.round(rnd() * 8 - 2);
      const b = Math.round(rnd() * 8);
      const c = Math.round(rnd() * 6);
      const k = Math.round(rnd() * 30) + 1;
      const L = tf(String(k), `s^3+${a}*s^2+${b}*s+${c}`.replace(/\+-/g, "-"));
      const ny = nyquist(L);
      if (!ny.ok) continue;
      const cl = analyzeStability(feedback(L));
      if (!cl.ok || cl.disagreement || ny.throughMinusOne || ny.N === null) continue;
      compared++;
      expect(ny.Z).toBe(cl.rhpPolesNumeric);
      expect(ny.agree).toBe(true);
    }
    expect(compared).toBeGreaterThan(30);
  });

  test("a lightly damped resonance (zeta = 0.005) is followed, not stepped over", () => {
    // L = 3(s+1)/((s^2 + 0.01 s + 1)(s + 2)); closed loop from numpy roots: compared via analyzeStability
    const L = tf("3*s+3", "s^3+2.01*s^2+1.02*s+2");
    const ny = ok<NyquistResult>(nyquist(L));
    const cl = analyzeStability(feedback(L));
    if (!cl.ok) throw new Error("closed loop");
    expect(ny.Z).toBe(cl.rhpPolesNumeric);
    expect(ny.agree).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Independent adversarial review, round 1 (integration). Each defect pinned.
// Oracle for the margins (numpy/scipy, python -I):
//   f = lambda w: abs(polyval(n,1j*w)/polyval(d,1j*w)) - 1; w = brentq(f, lo, hi)
//   PM = (180 + degrees(angle(L(jw)))) wrapped into (-180, 180]
//   1/s^3 -> (1.0, -90.0); (s+1)/s^3 -> (1.1509639252577581, -40.98531833404536)
//   (2s+2)/(s^2-s) -> (2.0, 36.86989764584402); L(j1) = -2 -> GM = -6.020599913279624 dB
// ---------------------------------------------------------------------------
describe("review round 1: margins() convention (was: unwrapped phase, PM 270 deg for 1/s^3)", () => {
  const m = (n: string, d: string): Margins => ok<Margins>(margins(tf(n, d)));
  test("PM is wrapped into (-180, 180]: 1/s^3 -> -90, (s+1)/s^3 -> -40.985, (2s+2)/(s^2-s) -> 36.870", () => {
    expect(m("1", "s^3").phaseMarginDeg!).toBeCloseTo(-90, 8);
    expect(m("1", "s^3").gainCrossoverW!).toBeCloseTo(1, 10);
    expect(m("s+1", "s^3").phaseMarginDeg!).toBeCloseTo(-40.98531833404536, 6);
    expect(m("s+1", "s^3").gainCrossoverW!).toBeCloseTo(1.1509639252577581, 8);
    const u = m("2*s+2", "s^2-s");
    expect(u.phaseMarginDeg!).toBeCloseTo(36.86989764584402, 6);
    expect(u.gainCrossoverW!).toBeCloseTo(2, 8);
    expect(u.gainMarginDb!).toBeCloseTo(-6.020599913279624, 6);
    expect(u.phaseCrossoverW!).toBeCloseTo(1, 8);
  });
  test("no GM where the phase only SITS at -180 (1/s^2); no crossover where |L| only tends to 1 ((s+2)/(s+1))", () => {
    expect(m("1", "s^2").gainMarginDb).toBeNull();
    expect(m("1", "s^2").phaseMarginDeg!).toBeCloseTo(0, 8);
    expect(m("s+2", "s+1").phaseMarginDeg).toBeNull();
    expect(m("s+2", "s+1").gainCrossoverW).toBeNull();
  });
  test("1/(s-1): L(0) = -1 is a DC condition, not margins at 10^-26 rad/s", () => {
    const r = m("1", "s-1");
    expect(r.phaseMarginDeg).toBeNull();
    expect(r.gainMarginDb).toBeNull();
    expect(r.notes.join(" ")).toMatch(/L\(0\) = −1 exactly/);
    // |G(0)| = 1 touch is not a crossover either (was "180 deg at 5.4e-9 rad/s")
    expect(m("1", "s^2+2*s+1").phaseMarginDeg).toBeNull();
  });
  test("unchanged where the old convention was right: 1/(s(s+1)(s+2)) PM 53.41 deg, GM 20 log10 6", () => {
    const r = m("1", "s^3+3*s^2+2*s");
    expect(r.phaseMarginDeg!).toBeCloseTo(53.41078617769918, 6);
    expect(r.gainMarginDb!).toBeCloseTo(20 * Math.log10(6), 8);
  });
});

describe("review round 1: lead/lag never reports a target met on an unstable closed loop", () => {
  test("1/s^3 (PM was 270 -> 'no lead network is needed'): now refused", () => {
    expect(designCompensator(tf("1", "s^3"), { kind: "lead", pm: 50, wc: null, errorConst: null }).ok).toBe(false);
  });
  test("(3s-9)/(s^3+s^2-2s+5): PM reads 50.08 deg but the closed loop is unstable (numpy roots) -> lead refused, lag not 'met'", () => {
    const L = tf("3*s-9", "s^3+s^2-2*s+5");
    expect(ok<Margins>(margins(L)).phaseMarginDeg!).toBeCloseTo(50.08, 1);
    const st = analyzeStability(feedback(L));
    expect(st.ok && st.stable).toBe(false);
    const lead = designCompensator(L, { kind: "lead", pm: 45, wc: null, errorConst: null });
    expect(lead.ok).toBe(false);
    // lag: the "already meets the target" shortcut no longer fires on an unstable loop
    const lag = designCompensator(L, { kind: "lag", pm: 45, wc: null, errorConst: null });
    if (lag.ok) expect(lag.closedAfter.stable || !lag.targetMet).toBe(true);
    else expect(lag.error).not.toMatch(/already/);
  });
});

describe("review round 1: root locus", () => {
  test("no real poles or zeros: -1/(s^2+2s+2) has the WHOLE real axis (roots -1 +/- sqrt(K-1)), break-in at -1, K = 1", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("-1", "s^2+2*s+2")));
    expect(rl.realSegments).toEqual([{ from: -Infinity, to: Infinity }]);
    expect(rl.breakaways.map((b) => [rs(b.sExact), rs(b.kExact)])).toEqual([["-1/1", "1/1"]]);
    const rl2 = ok<RootLocusResult>(rootLocus(tf("-1", "s^2+1")));
    expect(rl2.realSegments).toEqual([{ from: -Infinity, to: Infinity }]);
    expect(rl2.jwAxisLocus).toBe(true); // s^2 + 1 - K: on the axis for 0 < K < 1
    // positive gain on the same plant: K(sigma) = -(sigma^2+2sigma+2) < 0, no real axis
    expect(ok<RootLocusResult>(rootLocus(tf("1", "s^2+2*s+2"))).realSegments).toEqual([]);
  });
  test("1/s^4: s^4 + K has roots at +/-45 deg, NOT on the imaginary axis", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "s^4")));
    expect(rl.jwAxisLocus).toBe(false);
    expect(rl.crossings).toHaveLength(0);
  });
  test("(s+1)^5: repeated rational poles snap to -1 exactly (were -0.9993 +/- 5.27e-4 j)", () => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", "1 5 10 10 5 1")));
    expect(rl.poles.every((p) => p.re === -1 && p.im === 0)).toBe(true);
    expect(rl.realSegments).toEqual([{ from: -Infinity, to: -1 }]);
  });
  test.each([
    ["1 23.11 202.1879 810.887217 1327.423748 -1.443033 -2003.52003 -1593.922898", "1 34.02 547.5324 5249.832714 32225.933844 125945.877049 290718.541671 302409.258584"],
    ["1 12.76 88.9984 355.855566 883.424969 1264.157572 1078.950276", "1 13.8 85.9593 287.103338 446.454267 91.985654 -332.972964"],
  ])("expanded decimal plants no longer freeze the pane (were 17 s and 12 s): %s", (n, d) => {
    const t0 = Date.now();
    const rl = ok<RootLocusResult>(rootLocus(tf(n, d)));
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(rl.branches.length).toBe(rl.n);
    // the numeric poles still agree with numpy-style eigenvalue roots of the denominator
    expect(rl.poles).toHaveLength(polyRootsNumeric(d.split(" ").map(Number))!.length);
  });
});

// ---------------------------------------------------------------------------
// Review round 2. Exactness restored under a WORK budget, conditionally stable
// loops, display contract of the margins notes.
// ---------------------------------------------------------------------------
describe("review round 2: exact crossings and breakaways restored (cheap inputs), never a false 'irrational'", () => {
  test.each([
    // den, expected exact K of the (single) jw crossing; each confirmed by the exact Routh array
    ["1 3 2.0000003 0", "60000009/10000000"],
    ["1 4.000001 6.000003 4.000003 1.000001", "8000012000006000001/2000001000000125000"],
  ])("1/(%s): K exact and Routh-confirmed", (den, k) => {
    const rl = ok<RootLocusResult>(rootLocus(tf("1", den)));
    expect(rl.crossings).toHaveLength(1);
    expect(rs(rl.crossings[0].kExact)).toBe(k);
    expect(rl.crossings[0].routhConfirmed).toBe(true);
  });
  test("decimal and huge-coefficient loops: crossing K exact and confirmed", () => {
    for (const [n, d] of [
      ["1", "810.887217 1327.423748 543.2 12.5 0"],
      ["123456789012345", "1 98765432109876 12345678901234 0"],
    ]) {
      const rl = ok<RootLocusResult>(rootLocus(tf(n, d)));
      expect(rl.crossings.length).toBeGreaterThan(0);
      for (const c of rl.crossings) expect(c.routhConfirmed).toBe(true);
    }
  });
  test("breakaways exact: -1234567/20000000; -2000001/2000000 at K = 1/4000000000000 (no cancellation); -400003/400000", () => {
    const b1 = ok<RootLocusResult>(rootLocus(tf("1", "1 0.1234567 0"))).breakaways;
    expect(b1.map((b) => rs(b.sExact))).toEqual(["-1234567/20000000"]);
    const b2 = ok<RootLocusResult>(rootLocus(tf("1", "1 2.000001 1.000001"))).breakaways;
    expect(b2.map((b) => [rs(b.sExact), rs(b.kExact)])).toEqual([["-2000001/2000000", "1/4000000000000"]]);
    // (s+1)^3 (s+1.00001): old code found s = -400003/400000; round 1 reported none
    const b3 = ok<RootLocusResult>(rootLocus(tf("1", "1 4.00001 6.00003 4.00003 1.00001"))).breakaways;
    expect(b3.map((b) => rs(b.sExact))).toContain("-400003/400000");
  });
  test("irrational only when proven: the surd case is proven; the budget-limited 7th-order case is NOT claimed", () => {
    const surd = ok<RootLocusResult>(rootLocus(tf("s+3", "s^4+7*s^3+14*s^2+8*s"))).crossings[0];
    expect(surd.w2Irrational).toBe(true);
    const big = ok<RootLocusResult>(
      rootLocus(tf("1 23.11 202.1879 810.887217 1327.423748 -1.443033 -2003.52003 -1593.922898", "1 34.02 547.5324 5249.832714 32225.933844 125945.877049 290718.541671 302409.258584")),
    );
    for (const c of big.crossings) if (!c.kExact) expect(c.w2Irrational).toBe(false);
  });
  test("the two hang plants stay under 500 ms", () => {
    for (const [n, d] of [
      ["1 23.11 202.1879 810.887217 1327.423748 -1.443033 -2003.52003 -1593.922898", "1 34.02 547.5324 5249.832714 32225.933844 125945.877049 290718.541671 302409.258584"],
      ["1 12.76 88.9984 355.855566 883.424969 1264.157572 1078.950276", "1 13.8 85.9593 287.103338 446.454267 91.985654 -332.972964"],
    ]) {
      const t0 = Date.now();
      ok<RootLocusResult>(rootLocus(tf(n, d)));
      expect(Date.now() - t0).toBeLessThan(500);
    }
  });
});

describe("review round 2: conditionally stable loops (margin sign is not a verdict)", () => {
  // numpy (python -I): phase crossings of L = 1e4(s+1)(s+2)/(s^3(s+20)(s+50)) at w = 1.5917, 28.097 rad/s,
  // |L| there -> GM = -21.4905, +14.8707 dB; closed-loop roots of den + num all in the LHP (stable).
  test("1e4(s+1)(s+2)/(s^3(s+20)(s+50)): both GMs listed, headline +14.87 dB at 28.10 rad/s, conditionally stable", () => {
    const L = tf("10000*s^2+30000*s+20000", "s^5+70*s^4+1000*s^3");
    const m = ok<Margins>(margins(L));
    expect(m.phaseCrossings).toHaveLength(2);
    expect(m.phaseCrossings[0].marginDb).toBeCloseTo(-21.4905, 3);
    expect(m.phaseCrossings[1].marginDb).toBeCloseTo(14.8707, 3);
    expect(m.gainMarginDb!).toBeCloseTo(14.8707, 3);
    expect(m.phaseCrossoverW!).toBeCloseTo(28.0974, 3);
    const st = analyzeStability(feedback(L));
    expect(st.ok && st.stable).toBe(true);
    const t = m.notes.join(" ");
    expect(t).toMatch(/CONDITIONALLY STABLE/);
    expect(t).not.toMatch(/must be REDUCED|loop is unstable/);
  });
  test("20(s+0.5)^2/(s^3(s+5)): a negative GM on a STABLE loop is not called unstable", () => {
    const L = tf("20*s^2+20*s+5", "s^4+5*s^3");
    const st = analyzeStability(feedback(L));
    expect(st.ok && st.stable).toBe(true);
    const m = ok<Margins>(margins(L));
    expect(m.gainMarginDb!).toBeLessThan(0);
    expect(m.notes.join(" ")).toMatch(/closed loop is STABLE/);
  });
  test("margins notes obey the display contract (no caret, no ASCII sign minus, no e-notation)", () => {
    for (const [n, d] of [
      ["1", "s^2"], ["1", "s-1"], ["s+2", "s+1"], ["1", "s^3"], ["10000*s^2+30000*s+20000", "s^5+70*s^4+1000*s^3"],
      ["100*s^2+2*s+100", "s^4+4*s^3+6*s^2+4*s+1"], ["10", "s^3+3*s^2+2*s"], ["1000000000000", "s^3+3*s^2+3*s+1"],
    ]) {
      const txt = ok<Margins>(margins(tf(n, d))).notes.join(" ");
      expect(txt).not.toMatch(/\^|(^|[\s(=,;:[])-(?=\.?\d)|\d[eE][+-]?\d|degrees/);
    }
  });
});
