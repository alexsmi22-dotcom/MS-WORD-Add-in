// Oracle tests for the op-amp, filter and logic engines.
//
// The strongest checks here are the ones that do not compare against a number I
// wrote down: a designed filter is EVALUATED at its own band edges to confirm it
// meets the specification it was given, and a minimised Boolean expression is
// re-parsed and its truth table compared against the original function. Both
// verify the result rather than the arithmetic that produced it.

import { analyzeOpamp, OpampResult } from "../opamp";
import { designFilter, toTransferFunction, FilterResult } from "../filter";
import { truthTable, minimise, TruthTable, MinimiseResult } from "../logic";
import { analyzeStability } from "../control";
import { ratToNumber } from "../cas";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

// ---------------------------------------------------------------------------
describe("op-amp configurations", () => {
  function amp(over: Partial<Parameters<typeof analyzeOpamp>[0]>): OpampResult {
    const r = analyzeOpamp({ config: "inverting", rin: [1000], rf: 10000, ...over });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("inverting gain is -Rf/Rin and the input resistance is Rin", () => {
    const r = amp({});
    near(r.gain, -10);
    near(r.inputResistance, 1000);
  });

  // The distinction that makes an inverting stage slower than it looks.
  test("the noise gain of an inverting stage is one more than the signal gain", () => {
    const r = amp({});
    near(r.noiseGain, 11);
    expect(r.notes.join(" ")).toMatch(/NOISE GAIN/);
    // Unity-gain inverting: signal gain 1, noise gain 2.
    const unity = amp({ rin: [10000], rf: 10000 });
    near(Math.abs(unity.gain), 1);
    near(unity.noiseGain, 2);
  });

  test("non-inverting gain is 1 + Rf/Rin with infinite input resistance", () => {
    const r = amp({ config: "non-inverting" });
    near(r.gain, 11);
    near(r.noiseGain, 11);
    expect(r.inputResistance).toBe(Infinity);
  });

  test("a buffer has unity gain and the widest bandwidth", () => {
    const b = amp({ config: "buffer", gbw: 1e6 });
    const g10 = amp({ config: "non-inverting", rin: [1000], rf: 9000, gbw: 1e6 });
    expect(b.gain).toBe(1);
    near(b.bandwidth as number, 1e6);
    expect(g10.bandwidth as number).toBeLessThan(b.bandwidth as number);
  });

  // The single most common op-amp surprise.
  test("bandwidth is the gain-bandwidth product divided by the noise gain", () => {
    const r = amp({ config: "non-inverting", rin: [1000], rf: 99000, gbw: 1e6 });
    near(r.noiseGain, 100);
    near(r.bandwidth as number, 1e4);
    expect(r.notes.join(" ")).toMatch(/Gain and bandwidth trade one for one/i);
  });

  test("summing gains are independent and the noise gain uses all inputs", () => {
    const r = amp({ config: "summing", rin: [1000, 2000, 4000], rf: 8000 });
    near(r.inputGains[0], -8);
    near(r.inputGains[1], -4);
    near(r.inputGains[2], -2);
    // Noise gain = 1 + Rf*(1/R1 + 1/R2 + 1/R3) = 1 + 8000*(0.001+0.0005+0.00025)
    near(r.noiseGain, 1 + 8000 * (1 / 1000 + 1 / 2000 + 1 / 4000));
    expect(r.notes.join(" ")).toMatch(/PARALLEL combination/i);
  });

  test("full-power bandwidth follows the slew rate and is flagged when it binds", () => {
    // SR = 1 V/us, 10 V peak: FPBW = 1e6/(2*pi*10) = 15.9 kHz.
    const r = amp({ config: "non-inverting", rin: [1000], rf: 9000, gbw: 1e7, slewRate: 1, vout: 10 });
    near(r.fullPowerBandwidth as number, 1e6 / (2 * Math.PI * 10));
    expect(r.fullPowerBandwidth as number).toBeLessThan(r.bandwidth as number);
    expect(r.notes.join(" ")).toMatch(/SLEW LIMITING/);
    expect(r.notes.join(" ")).toMatch(/not reveal it/i);
  });

  test("an integrator is warned that it saturates without DC feedback", () => {
    const r = amp({ config: "integrator", rin: [10000], rf: 0, c: 1e-7 });
    near(r.cornerFrequency as number, 1 / (2 * Math.PI * 10000 * 1e-7));
    expect(r.notes.join(" ")).toMatch(/IDEAL INTEGRATOR SATURATES/);
    expect(r.notes.join(" ")).toMatch(/does not work/);
  });

  test("a differentiator is warned about noise and instability", () => {
    const r = amp({ config: "differentiator", rin: [0], rf: 10000, c: 1e-7 });
    expect(r.notes.join(" ")).toMatch(/AMPLIFIES NOISE AND IS PRONE TO OSCILLATION/);
  });

  test("a difference amplifier's CMRR is attributed to the resistors", () => {
    const r = amp({ config: "difference" });
    expect(r.notes.join(" ")).toMatch(/COMMON-MODE REJECTION DEPENDS ENTIRELY ON THAT MATCHING/i);
  });

  test("clipping against the supply is called out", () => {
    const r = amp({ vout: 20, vsupply: 12, slewRate: 1 });
    expect(r.notes.join(" ")).toMatch(/CLIPS/);
  });

  test("bad component values are refused", () => {
    expect(analyzeOpamp({ config: "inverting", rin: [0], rf: 1000 }).ok).toBe(false);
    expect(analyzeOpamp({ config: "inverting", rin: [1000], rf: 0 }).ok).toBe(false);
    expect(analyzeOpamp({ config: "integrator", rin: [1000], rf: 0, c: 0 }).ok).toBe(false);
    expect(analyzeOpamp({ config: "summing", rin: [], rf: 1000 }).ok).toBe(false);
    expect(analyzeOpamp({ config: "inverting", rin: [1000], rf: NaN }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("filter design", () => {
  function design(over: Partial<Parameters<typeof designFilter>[0]> = {}): FilterResult {
    const r = designFilter({
      family: "butterworth",
      kind: "lowpass",
      wp: 1000,
      ws: 4000,
      ap: 3,
      as: 40,
      ...over,
    });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  /** |H(jw)| by direct evaluation, independent of the module's own helper. */
  function mag(f: FilterResult, w: number): number {
    const ev = (p: number[]) => {
      let re = 0;
      let im = 0;
      for (const c of p) {
        const nr = -im * w + c;
        const ni = re * w;
        re = nr;
        im = ni;
      }
      return Math.hypot(re, im);
    };
    return ev(f.num) / ev(f.den);
  }

  test("the order is the ceiling of the closed-form minimum", () => {
    const f = design();
    expect(f.order).toBe(Math.ceil(f.exactOrder));
    expect(f.order).toBeGreaterThan(0);
  });

  // THE SCALED REAL POLE STAYS A REAL POLE. denominatorFromPoles classified
  // poles with an ABSOLUTE imaginary-part epsilon (1e-12); the odd-order
  // Chebyshev prototype's real pole carries a ~7e-17 float residue that a
  // band edge of a few thousand rad/s grew past it. The "real" pole was then
  // multiplied in as a conjugate-pair quadratic: denominator one degree too
  // high, |H| at the passband edge -80 dB where the spec says -1 dB, and a
  // reported stopband attenuation ~3x the truth. Found by the adversarial
  // pass THROUGH THE NEW FIGURE, which drew the spec point 79 dB off the
  // curve. The epsilon is now relative to the pole's own magnitude.
  test("an odd-order Chebyshev at a large band edge keeps its degree and meets its spec", () => {
    for (const spec of [
      { kind: "highpass" as const, wp: 4000, ws: 1000 },
      { kind: "lowpass" as const, wp: 15000, ws: 60000 },
    ]) {
      const f = design({ family: "chebyshev", ...spec, ap: 1, as: 40 });
      expect(f.order % 2).toBe(1); // the trap only exists for odd orders
      expect(f.den.length).toBe(f.order + 1); // degree == order, not order+1
      const atPass = 20 * Math.log10(mag(f, spec.wp));
      const atStop = 20 * Math.log10(mag(f, spec.ws));
      expect(atPass).toBeGreaterThanOrEqual(-1 - 0.01);
      expect(atStop).toBeLessThanOrEqual(-40);
      // The reported attenuation is the truth, not three times it.
      expect(Math.abs(-atStop - f.stopbandAttenuation)).toBeLessThan(0.5);
    }
  });

  // THE INDEPENDENT CHECK: does the designed filter meet its own spec?
  test("a Butterworth meets its passband and stopband specification", () => {
    const f = design();
    const passDb = -20 * Math.log10(mag(f, 1000));
    const stopDb = -20 * Math.log10(mag(f, 4000));
    expect(passDb).toBeLessThan(3 + 1e-6); // no worse than the ripple asked for
    expect(stopDb).toBeGreaterThan(40 - 1e-6); // at least the attenuation asked for
  });

  test("a Chebyshev meets the same specification at a lower order", () => {
    const b = design({ family: "butterworth" });
    const c = design({ family: "chebyshev" });
    expect(c.order).toBeLessThanOrEqual(b.order);
    const stopDb = -20 * Math.log10(mag(c, 4000));
    expect(stopDb).toBeGreaterThan(40 - 1e-6);
  });

  test("Butterworth is monotonic in the passband and Chebyshev ripples", () => {
    const b = design({ family: "butterworth", ap: 1 });
    let prev = Infinity;
    let monotonic = true;
    for (let w = 10; w <= 1000; w += 10) {
      const m = mag(b, w);
      if (m > prev + 1e-12) monotonic = false;
      prev = m;
    }
    expect(monotonic).toBe(true);

    // Chebyshev must NOT be monotonic — that is what ripple means.
    const c = design({ family: "chebyshev", ap: 1 });
    let rises = 0;
    prev = -Infinity;
    for (let w = 10; w <= 1000; w += 5) {
      const m = mag(c, w);
      if (m > prev + 1e-9) rises++;
      prev = m;
    }
    expect(rises).toBeGreaterThan(1);
  });

  test("Chebyshev passband ripple never exceeds what was asked for", () => {
    const c = design({ family: "chebyshev", ap: 1 });
    let worst = 0;
    for (let w = 1; w <= 1000; w += 5) {
      const db = -20 * Math.log10(mag(c, w));
      worst = Math.max(worst, db);
    }
    expect(worst).toBeLessThan(1 + 1e-6);
  });

  test("every designed filter is stable — all poles in the left half plane", () => {
    for (const family of ["butterworth", "chebyshev"] as const) {
      for (const kind of ["lowpass", "highpass"] as const) {
        const f = design({
          family,
          kind,
          wp: kind === "lowpass" ? 1000 : 4000,
          ws: kind === "lowpass" ? 4000 : 1000,
        });
        for (const p of f.poles) {
          expect({ family, kind, re: p.re < 0 }).toEqual({ family, kind, re: true });
        }
      }
    }
  });

  // The reuse that justifies the module's shape.
  test("the designed filter hands straight to the control analysis and is stable there too", () => {
    const f = design();
    const tf = toTransferFunction(f);
    const s = analyzeStability(tf);
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.stable).toBe(true);
      expect(s.rhpPolesNumeric).toBe(0);
    }
    // And the coefficients survived the conversion.
    expect(tf.den.length).toBe(f.den.length);
    near(ratToNumber(tf.den[0]), f.den[0], 1e-12);
  });

  test("a high-pass rejects DC and passes high frequencies", () => {
    const f = design({ kind: "highpass", wp: 4000, ws: 1000 });
    expect(mag(f, 1)).toBeLessThan(1e-6);
    expect(mag(f, 1e6)).toBeGreaterThan(0.99);
    const stopDb = -20 * Math.log10(mag(f, 1000));
    expect(stopDb).toBeGreaterThan(40 - 1e-6);
  });

  test("the delivered attenuation and the alternative order are reported", () => {
    const f = design();
    expect(f.stopbandAttenuation).toBeGreaterThan(40);
    expect(f.alternativeOrder).toBeGreaterThan(0);
    expect(f.notes.join(" ")).toMatch(/MAXIMALLY FLAT/);
    expect(f.notes.join(" ")).toMatch(/PHASE plot/);
  });

  test("impossible or backwards specifications are refused", () => {
    expect(designFilter({ family: "butterworth", kind: "lowpass", wp: 4000, ws: 1000, ap: 3, as: 40 }).ok).toBe(false);
    expect(designFilter({ family: "butterworth", kind: "highpass", wp: 1000, ws: 4000, ap: 3, as: 40 }).ok).toBe(false);
    expect(designFilter({ family: "butterworth", kind: "lowpass", wp: 1000, ws: 4000, ap: 40, as: 3 }).ok).toBe(false);
    expect(designFilter({ family: "butterworth", kind: "lowpass", wp: 0, ws: 4000, ap: 3, as: 40 }).ok).toBe(false);
    // An impossibly sharp transition needs an unbuildable order.
    expect(designFilter({ family: "butterworth", kind: "lowpass", wp: 1000, ws: 1001, ap: 0.1, as: 100 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("truth tables", () => {
  function tt(expr: string, vars = "A B"): TruthTable {
    const r = truthTable(expr, vars);
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  test("AND, OR, NOT and XOR give the right tables", () => {
    expect(tt("A AND B").minterms).toEqual([3]);
    expect(tt("A OR B").minterms).toEqual([1, 2, 3]);
    expect(tt("NOT A", "A").minterms).toEqual([0]);
    expect(tt("A XOR B").minterms).toEqual([1, 2]);
  });

  test("all three notations parse to the same function", () => {
    const a = tt("A AND B OR NOT C", "A B C").minterms;
    const b = tt("A & B | ~C", "A B C").minterms;
    const c = tt("A*B + C'", "A B C").minterms;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("implicit AND works, because that is how Boolean algebra is printed", () => {
    expect(tt("AB", "A B").minterms).toEqual([3]);
    expect(tt("A'B + AB'", "A B").minterms).toEqual([1, 2]);
  });

  test("precedence is NOT then AND then XOR then OR", () => {
    // A + B*C must be A OR (B AND C), not (A OR B) AND C.
    expect(tt("A + B*C", "A B C").minterms).toEqual([3, 4, 5, 6, 7]);
  });

  test("brackets override precedence", () => {
    expect(tt("(A + B)*C", "A B C").minterms).toEqual([3, 5, 7]);
  });

  test("the table has 2^n rows in the conventional order", () => {
    const t = tt("A", "A B C");
    expect(t.rows).toHaveLength(8);
    expect(t.rows[0].inputs).toEqual([false, false, false]);
    expect(t.rows[7].inputs).toEqual([true, true, true]);
    // A is the most significant variable, so it is true for the last four rows.
    expect(t.minterms).toEqual([4, 5, 6, 7]);
  });

  test("tautologies and contradictions are named", () => {
    expect(tt("A + A'", "A").notes.join(" ")).toMatch(/tautology/);
    expect(tt("A * A'", "A").notes.join(" ")).toMatch(/contradiction/);
  });

  test("malformed expressions are refused with a reason", () => {
    for (const bad of ["", "A +", "(A", "A)", "A $ B", "Z", "A B C D"]) {
      expect(truthTable(bad, "A B").ok).toBe(false);
    }
  });

  test("too many variables is refused rather than attempted", () => {
    expect(truthTable("A", "A B C D E F G H I J K L").ok).toBe(false);
    expect(truthTable("A", "A A").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Boolean minimisation", () => {
  /** Re-evaluates a minimised expression and compares its truth table. */
  function coversSameFunction(res: MinimiseResult, minterms: number[], dontCares: number[] = []): boolean {
    const t = truthTable(res.expression, res.variables.join(" "));
    if (!t.ok) throw new Error(`minimised expression did not parse: ${res.expression} — ${t.error}`);
    const got = new Set(t.minterms);
    for (const m of minterms) if (!got.has(m)) return false;
    const allowed = new Set([...minterms, ...dontCares]);
    for (const m of got) if (!allowed.has(m)) return false;
    return true;
  }

  test("the classic four-variable example minimises to the known result", () => {
    // F(A,B,C,D) = sum(0,1,2,5,6,7,8,9,10,14) — a standard textbook function.
    const r = minimise([0, 1, 2, 5, 6, 7, 8, 9, 10, 14], ["A", "B", "C", "D"]);
    if (!r.ok) throw new Error(r.error);
    expect(coversSameFunction(r, [0, 1, 2, 5, 6, 7, 8, 9, 10, 14])).toBe(true);
    // The known minimal cost for this function is 4 terms / 11 literals or better.
    expect(r.terms.length).toBeLessThanOrEqual(4);
  });

  // THE INDEPENDENT CHECK, applied broadly: minimise, then re-evaluate.
  test("a minimised expression always computes the original function", () => {
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bad: string[] = [];
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rnd() * 3); // 2 to 4 variables
      const vars = ["A", "B", "C", "D"].slice(0, n);
      const minterms: number[] = [];
      for (let m = 0; m < 1 << n; m++) if (rnd() < 0.5) minterms.push(m);
      if (!minterms.length) continue;
      const r = minimise(minterms, vars);
      if (!r.ok) {
        bad.push(`refused ${minterms}`);
        continue;
      }
      if (!coversSameFunction(r, minterms)) bad.push(`${vars} ${minterms} -> ${r.expression}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("a single minterm gives the full product term", () => {
    const r = minimise([3], ["A", "B"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.expression).toBe("AB");
    expect(r.literals).toBe(2);
  });

  test("adjacent minterms combine and drop a variable", () => {
    // 2 and 3 are AB' and AB, which combine to A.
    const r = minimise([2, 3], ["A", "B"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.expression).toBe("A");
    expect(r.literals).toBe(1);
  });

  test("an all-ones function is the constant 1", () => {
    const r = minimise([0, 1, 2, 3], ["A", "B"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.expression).toBe("1");
  });

  test("an empty function is the constant 0", () => {
    const r = minimise([], ["A", "B"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.expression).toBe("0");
  });

  test("essential prime implicants are identified and explained", () => {
    const r = minimise([0, 1, 2, 5, 6, 7, 8, 9, 10, 14], ["A", "B", "C", "D"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.essential.length).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/ESSENTIAL/);
  });

  // Don't-cares should genuinely simplify, and be flagged.
  test("don't-cares are used and the risk is stated", () => {
    const without = minimise([1, 3, 7], ["A", "B", "C"]);
    const with_ = minimise([1, 3, 7], ["A", "B", "C"], [0, 2, 5]);
    if (!without.ok || !with_.ok) throw new Error("setup");
    expect(with_.literals).toBeLessThanOrEqual(without.literals);
    expect(with_.notes.join(" ")).toMatch(/don't-cares|Don't-cares/i);
    // The result must still cover every required minterm.
    expect(coversSameFunction(with_, [1, 3, 7], [0, 2, 5])).toBe(true);
  });

  test("non-unique minimal forms are reported as such", () => {
    // A cyclic function with several equally minimal covers.
    const r = minimise([0, 1, 2, 3, 4, 5], ["A", "B", "C"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.alternatives).toBeGreaterThanOrEqual(1);
    expect(coversSameFunction(r, [0, 1, 2, 3, 4, 5])).toBe(true);
  });

  test("out-of-range minterms are refused", () => {
    expect(minimise([8], ["A", "B", "C"]).ok).toBe(false);
    expect(minimise([-1], ["A", "B"]).ok).toBe(false);
    expect(minimise([1.5], ["A", "B"]).ok).toBe(false);
    expect(minimise([1], []).ok).toBe(false);
  });
});
