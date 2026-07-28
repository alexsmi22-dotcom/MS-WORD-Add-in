// Adversarial pass over the control-systems engine.
//
// The oracle tests ask whether the control theory is right for systems a
// textbook prints. This file assumes hostile input and asks the two questions
// they structurally cannot:
//
//   1. DOES IT TERMINATE, fast? Three things here iterate — the Routh
//      tabulation, the RK4 integration, and the margin bisection — and all of
//      them run on every keystroke in a Word task pane. A loop that does not
//      return is a frozen Word with the user's document in it.
//   2. DOES IT REFUSE RATHER THAN INVENT? A pole that is really at +1e-14, a
//      transfer function that is not realisable, or a margin that does not
//      exist must be reported as such. A confident number is worse than a
//      refusal, because it reaches the document.

import {
  parsePoly,
  parseTf,
  polyRoots,
  polyMul,
  polyAdd,
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
  autoFrequencies,
  margins,
  RouthResult,
} from "../control";
import { Rat, ratInt, ratDiv } from "../cas";

const P = (...xs: number[]): Rat[] => xs.map((x) => ratInt(x));
const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

/** Every number a result exposes must be finite, or the engine must have refused. */
function nonFinite(o: unknown, path = "result"): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(`${p} = ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "bigint") continue;
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(o, path);
  return bad;
}

// ---------------------------------------------------------------------------
describe("parsing never throws and never invents a polynomial", () => {
  test("junk is refused, not guessed", () => {
    const junk = [
      "",
      "   ",
      "s^",
      "^2",
      "++",
      "--",
      "s^^2",
      "1 2 x",
      "s^2 +",
      "(s+1)",
      "s/(s+1)",
      "NaN",
      "Infinity",
      "1e",
      ".",
      "/",
      "s^1e9",
      "s^999999999999",
      "1/0",
    ];
    for (const j of junk) {
      const r = within(200, () => parsePoly(j));
      // Either a refusal or a genuine polynomial; never a throw, never NaN.
      if (!("ok" in r)) {
        expect(nonFinite(r.map((c) => Number(c.n) / Number(c.d)))).toEqual([]);
      }
    }
  });

  test("an enormous input terminates", () => {
    within(2000, () => {
      parsePoly("1 ".repeat(5000));
      parsePoly("s+".repeat(2000) + "1");
      parsePoly("9".repeat(10000));
    });
  });

  test("order above the cap is refused rather than attempted", () => {
    const r = parsePoly(new Array(60).fill("1").join(" "));
    expect("ok" in r && r.ok === false).toBe(true);
    const r2 = parsePoly("s^40");
    expect("ok" in r2 && r2.ok === false).toBe(true);
  });

  test("a denominator that is only zeros is refused", () => {
    expect("ok" in parseTf("1", "0")).toBe(true);
    expect("ok" in parseTf("1", "0 0 0")).toBe(true);
  });

  test("polyToString survives degenerate polynomials", () => {
    expect(polyToString(P(0))).toBe("0");
    expect(polyToString(P(0, 0, 0))).toBe("0");
    expect(typeof polyToString(P(-1, 0, -1))).toBe("string");
  });
});

// ---------------------------------------------------------------------------
describe("roots terminate and stay finite", () => {
  test("high-order polynomials with wild coefficients do not hang", () => {
    within(3000, () => {
      for (const scale of [1e-8, 1, 1e8]) {
        for (let n = 2; n <= 18; n++) {
          const c = Array.from({ length: n + 1 }, (_, i) => ratInt(Math.round(scale * (i + 1))));
          const r = polyRoots(c);
          if (r) expect(nonFinite(r)).toEqual([]);
        }
      }
    });
  });

  test("a polynomial with a zero leading coefficient is trimmed, not divided by", () => {
    const r = polyRoots(P(0, 0, 1, 3, 2));
    expect(r).not.toBeNull();
    expect(r).toHaveLength(2);
    expect(nonFinite(r)).toEqual([]);
  });

  test("all-zero and constant polynomials give no roots rather than crashing", () => {
    expect(polyRoots(P(0))).toEqual([]);
    expect(polyRoots(P(7))).toEqual([]);
  });

  test("order above the cap returns null rather than attempting it", () => {
    expect(polyRoots(new Array(40).fill(ratInt(1)))).toBeNull();
  });

  test("repeated roots of high multiplicity stay finite", () => {
    // (s+1)^8 — the classic ill-conditioned case for root finding.
    let p = P(1);
    for (let i = 0; i < 8; i++) p = polyMul(p, P(1, 1));
    const r = within(500, () => polyRoots(p));
    expect(r).not.toBeNull();
    expect(nonFinite(r)).toEqual([]);
    // They should all be near -1 even if not exactly so.
    for (const z of r!) expect(Math.hypot(z.re + 1, z.im)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
describe("Routh-Hurwitz terminates on every degenerate shape", () => {
  test("polynomials that vanish in awkward places do not loop", () => {
    const cases = [
      P(1, 0, 0, 0, 1),
      P(1, 0, 1),
      P(1, 0, 0),
      P(0, 0, 1, 1),
      P(1, 1, 1, 1, 1),
      P(1, 1, 3, 2, 2),
      P(1, 0, 4, 0, 3),
      P(1, 2, 1),
      P(5),
      P(0),
      P(1, -1, 1, -1, 1, -1),
    ];
    within(2000, () => {
      for (const c of cases) {
        const r = routhHurwitz(c);
        if (!("ok" in r && r.ok === false)) {
          const rr = r as RouthResult;
          expect(Number.isFinite(rr.signChanges)).toBe(true);
          expect(rr.signChanges).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  test("the exact tabulation agrees with the numeric roots whenever it is clean", () => {
    // The strongest check available: two methods sharing no arithmetic. A
    // disagreement is either a bug or a genuinely marginal system, and the
    // polynomials here are deliberately not marginal.
    let seed = 987654321;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let checked = 0;
    within(6000, () => {
      for (let trial = 0; trial < 300; trial++) {
        const n = 2 + Math.floor(rnd() * 5);
        const c = Array.from({ length: n + 1 }, () => ratInt(Math.floor(rnd() * 21) - 10));
        const p = trimPoly(c);
        if (p.length < 2) continue;
        const r = routhHurwitz(p);
        if ("ok" in r && r.ok === false) continue;
        const rr = r as RouthResult;
        if (!rr.clean) continue;
        const roots = polyRoots(p);
        if (!roots) continue;
        // Skip anything with a pole within 1e-6 of the axis: there the numeric
        // real part is not trustworthy and a disagreement is expected, which is
        // exactly what the engine reports rather than resolving.
        if (roots.some((z) => Math.abs(z.re) < 1e-6)) continue;
        const rhp = roots.filter((z) => z.re > 0).length;
        expect({ p: p.map((x) => Number(x.n)), routh: rr.signChanges }).toEqual({
          p: p.map((x) => Number(x.n)),
          routh: rhp,
        });
        checked++;
      }
    });
    // Guard against the filters above silently skipping everything.
    expect(checked).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
describe("stability refuses rather than guessing at the boundary", () => {
  test("an integrator and an oscillator are marginal, not stable", () => {
    for (const den of ["s", "s^2", "s^2+1", "s^2+100"]) {
      const t = parseTf("1", den);
      if ("ok" in t) throw new Error(t.error);
      const s = analyzeStability(t);
      if (!s.ok) throw new Error(s.error);
      expect({ den, stable: s.stable }).toEqual({ den, stable: false });
    }
  });

  test("every result is finite for a wide spread of systems", () => {
    within(4000, () => {
      for (const den of [
        "s+1",
        "s-1",
        "s^2+2*s+5",
        "s^3+3*s^2+2*s",
        "s^4+1",
        "s^5+2*s^4+3*s^3+4*s^2+5*s+6",
        "0.0001*s^2+s+1",
        "1000000*s^2+s+1",
      ]) {
        const t = parseTf("1", den);
        if ("ok" in t) continue;
        const s = analyzeStability(t);
        if (s.ok) expect(nonFinite({ p: s.poles, z: s.zeros })).toEqual([]);
      }
    });
  });

  test("a zero denominator is refused everywhere it could appear", () => {
    const t = { num: P(1), den: P(0) };
    expect(analyzeStability(t).ok).toBe(false);
    expect(timeResponse(t, "step", 1).ok).toBe(false);
    expect(secondOrderMetrics(t).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("time response is bounded and honest", () => {
  test("a stiff system does not hang and says the trace is under-resolved", () => {
    // Poles at -1 and -1e6: a fixed step would either take forever or diverge.
    const t = parseTf("1", "0.000001*s^2+1.000001*s+1");
    if ("ok" in t) throw new Error(t.error);
    const r = within(3000, () => timeResponse(t, "step", 10, 400));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(nonFinite(r.y)).toEqual([]);
      expect(r.notes.join(" ")).toMatch(/UNDER-RESOLVED/i);
    }
  });

  test("an unstable system truncates instead of returning Infinity", () => {
    const t = parseTf("1", "s-5");
    if ("ok" in t) throw new Error(t.error);
    const r = within(2000, () => timeResponse(t, "step", 100, 400));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(nonFinite(r.y)).toEqual([]);
      expect(r.finalValue).toBeNull();
    }
  });

  // The budget here is the point: this is what a keystroke costs in the worst
  // case a user can type, so it is asserted tightly rather than generously.
  test("absurd end times and sample counts are bounded", () => {
    const t = parseTf("1", "s+1");
    if ("ok" in t) throw new Error(t.error);
    within(600, () => {
      for (const [tEnd, n] of [
        [1e6, 400],
        [1e-9, 400],
        [10, 1e6],
        [10, -5],
        [10, 0],
      ] as [number, number][]) {
        const r = timeResponse(t, "step", tEnd, n);
        if (r.ok) {
          expect(r.t.length).toBeLessThanOrEqual(4000);
          expect(nonFinite(r.y)).toEqual([]);
        }
      }
    });
    expect(timeResponse(t, "step", Infinity).ok).toBe(false);
    expect(timeResponse(t, "step", NaN).ok).toBe(false);
  });

  test("an improper system is refused for both input kinds", () => {
    const t = parseTf("s^3", "s+1");
    if ("ok" in t) throw new Error(t.error);
    expect(timeResponse(t, "step", 5).ok).toBe(false);
    expect(timeResponse(t, "impulse", 5).ok).toBe(false);
  });

  test("a system with no dynamics is refused rather than plotted flat", () => {
    const t = parseTf("1", "5");
    if ("ok" in t) throw new Error(t.error);
    expect(timeResponse(t, "step", 5).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("margins terminate and report absence as absence", () => {
  test("systems with no crossover report null rather than an edge-of-sweep value", () => {
    for (const [num, den] of [
      ["1", "s+1"],
      ["0.001", "s+1"],
      ["1", "s^2+2*s+1"],
    ]) {
      const t = parseTf(num, den);
      if ("ok" in t) throw new Error(t.error);
      const m = within(2000, () => margins(t));
      expect(m.ok).toBe(true);
      if (m.ok) {
        // A first- or second-order lag never reaches -180 degrees.
        expect(m.gainMarginDb).toBeNull();
        expect(nonFinite({ pm: m.phaseMarginDeg ?? 0, gc: m.gainCrossoverW ?? 0 })).toEqual([]);
      }
    }
  });

  test("the bisection terminates for a wide spread of loop shapes", () => {
    within(8000, () => {
      for (const den of [
        "s^3+3*s^2+2*s",
        "s^4+10*s^3+35*s^2+50*s+24",
        "s^2",
        "s^3",
        "s^5+1",
        "0.001*s^3+s^2+s",
        "s^3-3*s^2+2*s",
      ]) {
        const t = parseTf("1", den);
        if ("ok" in t) continue;
        const m = margins(t);
        if (m.ok) {
          for (const v of [m.gainMarginDb, m.phaseMarginDeg, m.gainCrossoverW, m.phaseCrossoverW]) {
            if (v !== null) expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    });
  });

  // The load-bearing cross-check: a gain margin is a claim about where the
  // closed loop goes unstable, so raising the gain by it must actually do that.
  test("the gain margin predicts the closed-loop stability boundary", () => {
    for (const den of ["s^3+3*s^2+2*s", "s^4+10*s^3+35*s^2+50*s+24", "s^3+6*s^2+11*s+6"]) {
      const L = parseTf("1", den);
      if ("ok" in L) continue;
      const m = margins(L);
      if (!m.ok || m.gainMarginDb === null) continue;
      const K = Math.pow(10, m.gainMarginDb / 20);
      const at = (k: number) => {
        const scaled = series({ num: [ratDiv(ratInt(Math.round(k * 1e6)), ratInt(1e6))], den: [ratInt(1)] }, L);
        const s = analyzeStability(feedback(scaled));
        return s.ok ? s.rhpPolesNumeric : -1;
      };
      // Comfortably below the margin: stable. Comfortably above: unstable.
      expect({ den, below: at(K * 0.9) }).toEqual({ den, below: 0 });
      expect(at(K * 1.1)).toBeGreaterThan(0);
    }
  });

  test("frequency response at zero and at absurd frequencies stays defined", () => {
    const t = parseTf("1", "s");
    if ("ok" in t) throw new Error(t.error);
    const r = frequencyResponse(t, [0, 1e-300, 1e300]);
    expect(r).toHaveLength(3);
    // w = 0 for an integrator is genuinely infinite gain; it must not be NaN.
    expect(Number.isNaN(r[0].magnitude)).toBe(false);
    for (const p of r.slice(1)) expect(Number.isFinite(p.phaseDeg)).toBe(true);
  });

  test("autoFrequencies always produces a usable ascending range", () => {
    for (const den of ["s+1", "s", "1", "s^5+1", "1000000*s+1", "0.000001*s+1"]) {
      const t = parseTf("1", den);
      if ("ok" in t) continue;
      const f = autoFrequencies(t, 50);
      expect(f.length).toBeGreaterThan(1);
      expect(nonFinite(f)).toEqual([]);
      for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
describe("connections and PID", () => {
  // The bug an oracle test caught: (Kd s^2 + Kp s)/s left a pole at the origin,
  // so a pure proportional gain was reported as marginally stable.
  test("a P or PD controller introduces no pole at the origin", () => {
    for (const [kp, ki, kd] of [
      [1, 0, 0],
      [5, 0, 2],
      [0, 0, 3],
    ]) {
      const c = pidTf(R(kp), R(ki), R(kd));
      const s = analyzeStability(c);
      if (!s.ok) continue;
      expect({ kp, ki, kd, imag: s.imaginaryAxisPoles }).toEqual({ kp, ki, kd, imag: 0 });
    }
  });

  test("a PI or PID controller does have an integrator", () => {
    const s = analyzeStability(pidTf(R(1), R(1), R(0)));
    if (s.ok) expect(s.imaginaryAxisPoles).toBe(1);
  });

  test("an all-zero PID is not a crash", () => {
    const c = pidTf(R(0), R(0), R(0));
    expect(polyToString(c.num)).toBe("0");
  });

  test("series and feedback stay finite for awkward pairs", () => {
    const a = parseTf("1", "s+1");
    const b = parseTf("0", "s+2");
    if ("ok" in a || "ok" in b) throw new Error("setup");
    const s = series(a, b);
    expect(polyToString(s.num)).toBe("0");
    const f = feedback(a, b);
    // G/(1+G*0) = G, so the denominator must not collapse.
    expect(trimPoly(f.den).length).toBeGreaterThan(1);
  });

  test("feedback of a system with itself terminates", () => {
    const a = parseTf("1", "s^3+3*s^2+2*s");
    if ("ok" in a) throw new Error("setup");
    let acc = a;
    within(1000, () => {
      for (let i = 0; i < 5; i++) acc = feedback(acc, a);
    });
    expect(trimPoly(acc.den).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("the pane's per-keystroke budget is respected", () => {
  test("a full Bode-and-margins pass is fast enough to run on every keystroke", () => {
    const t = parseTf("1", "s^4+10*s^3+35*s^2+50*s+24");
    if ("ok" in t) throw new Error(t.error);
    within(1500, () => {
      for (let i = 0; i < 10; i++) {
        margins(t);
        frequencyResponse(t, autoFrequencies(t, 300));
      }
    });
  });

  test("a full stability-and-response pass is fast enough too", () => {
    const t = parseTf("4", "s^2+2*s+4");
    if ("ok" in t) throw new Error(t.error);
    within(1500, () => {
      for (let i = 0; i < 10; i++) {
        analyzeStability(t);
        timeResponse(t, "step", 10, 400);
        secondOrderMetrics(t);
      }
    });
  });
});
