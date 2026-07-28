// Adversarial pass over the op-amp, filter, logic, open-channel, pump,
// compressible-flow and biomedical engines.
//
// Five modules shipped together, so they get one adversarial file, but the
// questions are the same three as always:
//
//   1. DOES IT TERMINATE, fast? Three things here iterate — the critical-depth
//      bisection, the Quine-McCluskey combination rounds, and the prime-implicant
//      cover search — and the last of those is exponential by nature, so its cap
//      is load-bearing rather than decorative.
//   2. DOES IT REFUSE RATHER THAN INVENT? A filter that does not meet its own
//      specification, a channel with no uniform-flow solution, a pump that
//      cavitates, and a sampling rate that aliases are each a real engineering
//      statement rather than a numerical inconvenience.
//   3. DO THE PROPERTIES HOLD EVERYWHERE, not just on the textbook case? A
//      designed filter must be stable for every order and family; a minimised
//      Boolean expression must compute the original function for every input;
//      resistance must always rise as a vessel narrows.

import { analyzeOpamp } from "../opamp";
import { designFilter, toTransferFunction } from "../filter";
import { truthTable, minimise } from "../logic";
import { openChannelFlow, npshAnalysis, compressibleFlow } from "../fluids";
import { vesselFlow, circulation, jointStatics, samplingCheck } from "../biomed";
import { analyzeStability } from "../control";

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

const HOSTILE = [NaN, Infinity, -Infinity];

// ---------------------------------------------------------------------------
describe("op-amps", () => {
  test("every non-finite or non-positive component is refused", () => {
    const bad: string[] = [];
    for (const v of [...HOSTILE, 0, -1]) {
      if (analyzeOpamp({ config: "inverting", rin: [v], rf: 1000 }).ok) bad.push(`rin=${v}`);
      if (analyzeOpamp({ config: "inverting", rin: [1000], rf: v }).ok) bad.push(`rf=${v}`);
    }
    expect(bad).toEqual([]);
  });

  test("extreme gain ratios stay finite", () => {
    const bad: string[] = [];
    within(500, () => {
      for (const rf of [1, 1e3, 1e6, 1e9]) {
        for (const rin of [1, 1e3, 1e6, 1e9]) {
          const r = analyzeOpamp({ config: "inverting", rin: [rin], rf, gbw: 1e6, slewRate: 1, vout: 5 });
          if (!r.ok) continue;
          for (const v of [r.gain, r.noiseGain, r.bandwidth ?? 0, r.fullPowerBandwidth ?? 0]) {
            if (!Number.isFinite(v)) bad.push(`rf=${rf} rin=${rin}: ${v}`);
          }
        }
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("bandwidth always falls as gain rises", () => {
    let prev = Infinity;
    const bad: string[] = [];
    for (const rf of [1e3, 1e4, 1e5, 1e6]) {
      const r = analyzeOpamp({ config: "non-inverting", rin: [1000], rf, gbw: 1e7 });
      if (!r.ok) continue;
      if ((r.bandwidth as number) >= prev) bad.push(`rf=${rf}`);
      prev = r.bandwidth as number;
    }
    expect(bad).toEqual([]);
  });

  test("many summing inputs never produce a noise gain below 1", () => {
    const rin = new Array(50).fill(1000);
    const r = analyzeOpamp({ config: "summing", rin, rf: 1000 });
    if (r.ok) {
      expect(r.noiseGain).toBeGreaterThan(1);
      expect(r.inputGains).toHaveLength(50);
    }
  });
});

// ---------------------------------------------------------------------------
describe("filter design", () => {
  function mag(num: number[], den: number[], w: number): number {
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
    return ev(num) / ev(den);
  }

  // The property that must hold for EVERY design, not just the example.
  test("every designed filter is stable and meets its own specification", () => {
    const bad: string[] = [];
    within(4000, () => {
      for (const family of ["butterworth", "chebyshev"] as const) {
        for (const ap of [0.1, 0.5, 1, 3]) {
          for (const as of [20, 40, 60]) {
            for (const ratio of [1.5, 2, 4, 10]) {
              const r = designFilter({ family, kind: "lowpass", wp: 1000, ws: 1000 * ratio, ap, as });
              if (!r.ok) continue;
              // Stability: every pole strictly in the left half plane.
              for (const p of r.poles) if (p.re >= 0) bad.push(`${family} ap=${ap} as=${as}: pole re=${p.re}`);
              // Specification: passband no worse than ap, stopband at least as.
              const passDb = -20 * Math.log10(mag(r.num, r.den, 1000));
              const stopDb = -20 * Math.log10(mag(r.num, r.den, 1000 * ratio));
              if (passDb > ap + 1e-6) bad.push(`${family} ap=${ap} r=${ratio}: passband ${passDb}`);
              if (stopDb < as - 1e-6) bad.push(`${family} as=${as} r=${ratio}: stopband ${stopDb}`);
            }
          }
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("the control analysis agrees that every designed filter is stable", () => {
    const bad: string[] = [];
    within(4000, () => {
      for (const family of ["butterworth", "chebyshev"] as const) {
        for (const ratio of [1.5, 2, 5]) {
          const r = designFilter({ family, kind: "lowpass", wp: 100, ws: 100 * ratio, ap: 1, as: 40 });
          if (!r.ok) continue;
          const s = analyzeStability(toTransferFunction(r));
          if (s.ok && !s.stable) bad.push(`${family} ratio=${ratio}: unstable after conversion`);
        }
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("an unbuildable order is refused rather than attempted", () => {
    const r = designFilter({ family: "butterworth", kind: "lowpass", wp: 1000, ws: 1002, ap: 0.01, as: 120 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/order/i);
  });

  test("a forced order below the requirement is delivered AND flagged", () => {
    const r = designFilter({
      family: "butterworth",
      kind: "lowpass",
      wp: 1000,
      ws: 2000,
      ap: 1,
      as: 60,
      forceOrder: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order).toBe(2);
      expect(r.notes.join(" ")).toMatch(/does NOT meet the stopband attenuation/);
      expect(r.stopbandAttenuation).toBeLessThan(60);
    }
  });

  test("hostile specifications are refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(designFilter({ family: "butterworth", kind: "lowpass", wp: v, ws: 4000, ap: 3, as: 40 }).ok).toBe(false);
      expect(designFilter({ family: "butterworth", kind: "lowpass", wp: 1000, ws: 4000, ap: v, as: 40 }).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("digital logic", () => {
  test("the parser never throws, whatever it is fed", () => {
    const junk = [
      "",
      "   ",
      "(",
      ")",
      "()",
      "((((((((((",
      "A +",
      "+ A",
      "A B C",
      "!!!!A",
      "A''''",
      "A &&& B",
      "Z",
      "0 + 1",
      "A ANDD B",
      "*".repeat(500),
      "A".repeat(5000),
      "(A".repeat(200),
    ];
    within(2000, () => {
      for (const j of junk) {
        const r = truthTable(j, "A B C");
        expect(typeof r.ok).toBe("boolean");
      }
    });
  });

  // The exponential step, with its cap doing real work.
  test("the worst-case minimisation terminates inside the pane budget", () => {
    within(4000, () => {
      // Every minterm of a 10-variable function: the largest input allowed.
      const all = Array.from({ length: 1 << 10 }, (_, i) => i);
      const vars = "ABCDEFGHIJ".split("");
      const r = minimise(all, vars);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.expression).toBe("1");
    });
  });

  test("a checkerboard function — the worst case for combination — terminates", () => {
    within(6000, () => {
      const vars = "ABCDEFGH".split("");
      const minterms: number[] = [];
      for (let i = 0; i < 1 << 8; i++) if (popcount(i) % 2 === 0) minterms.push(i);
      const r = minimise(minterms, vars);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.terms.length).toBeGreaterThan(0);
    });
  });

  // The correctness property, over more functions than the oracle file checks.
  test("a minimised expression always computes the original function", () => {
    let seed = 987;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bad: string[] = [];
    within(8000, () => {
      for (let trial = 0; trial < 300; trial++) {
        const n = 2 + Math.floor(rnd() * 4); // 2 to 5 variables
        const vars = "ABCDE".slice(0, n).split("");
        const minterms: number[] = [];
        const dontCares: number[] = [];
        for (let m = 0; m < 1 << n; m++) {
          const u = rnd();
          if (u < 0.4) minterms.push(m);
          else if (u < 0.5) dontCares.push(m);
        }
        if (!minterms.length) continue;
        const r = minimise(minterms, vars, dontCares);
        if (!r.ok) {
          bad.push(`refused ${vars} ${minterms}`);
          continue;
        }
        const t = truthTable(r.expression, vars.join(" "));
        if (!t.ok) {
          bad.push(`unparseable: ${r.expression}`);
          continue;
        }
        const got = new Set(t.minterms);
        for (const m of minterms) if (!got.has(m)) bad.push(`${r.expression} misses ${m}`);
        const allowed = new Set([...minterms, ...dontCares]);
        for (const m of got) if (!allowed.has(m)) bad.push(`${r.expression} adds ${m}`);
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("out-of-range and oversized inputs are refused", () => {
    expect(minimise([1], "ABCDEFGHIJK".split("")).ok).toBe(false);
    expect(minimise([1 << 20], ["A", "B"]).ok).toBe(false);
    expect(truthTable("A", "A B C D E F G H I J K").ok).toBe(false);
  });
});

function popcount(x: number): number {
  let c = 0;
  let v = x;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

// ---------------------------------------------------------------------------
describe("open-channel flow", () => {
  test("the critical-depth bisection terminates over a wide sweep", () => {
    const bad: string[] = [];
    within(4000, () => {
      for (const shape of ["rectangular", "trapezoidal", "triangular", "circular"] as const) {
        for (const y of [0.01, 0.5, 2, 10]) {
          for (const S of [1e-5, 1e-3, 0.1]) {
            const r = openChannelFlow({ shape, b: 3, z: 2, D: 20, y, n: 0.02, S });
            if (!r.ok) continue;
            for (const v of [r.area, r.velocity, r.discharge, r.froude, r.specificEnergy]) {
              if (!Number.isFinite(v)) bad.push(`${shape} y=${y} S=${S}: ${v}`);
            }
            if (r.criticalDepth !== null && !Number.isFinite(r.criticalDepth)) {
              bad.push(`${shape}: critical depth ${r.criticalDepth}`);
            }
          }
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("discharge always rises with depth and with slope", () => {
    const bad: string[] = [];
    let prev = -Infinity;
    for (const y of [0.1, 0.5, 1, 2, 5]) {
      const r = openChannelFlow({ shape: "rectangular", b: 3, y, n: 0.02, S: 0.001 });
      if (!r.ok) continue;
      if (r.discharge <= prev) bad.push(`y=${y}`);
      prev = r.discharge;
    }
    prev = -Infinity;
    for (const S of [1e-4, 1e-3, 1e-2, 1e-1]) {
      const r = openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: 0.02, S });
      if (!r.ok) continue;
      if (r.discharge <= prev) bad.push(`S=${S}`);
      prev = r.discharge;
    }
    expect(bad).toEqual([]);
  });

  test("hostile geometry is refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(openChannelFlow({ shape: "rectangular", b: 3, y: v, n: 0.02, S: 0.001 }).ok).toBe(false);
      expect(openChannelFlow({ shape: "rectangular", b: v, y: 1, n: 0.02, S: 0.001 }).ok).toBe(false);
      expect(openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: v, S: 0.001 }).ok).toBe(false);
      expect(openChannelFlow({ shape: "rectangular", b: 3, y: 1, n: 0.02, S: v }).ok).toBe(false);
    }
  });

  test("a nearly full pipe does not divide by a vanishing top width", () => {
    const r = openChannelFlow({ shape: "circular", D: 2, y: 1.9999, n: 0.013, S: 0.001 });
    if (r.ok) {
      expect(Number.isFinite(r.froude)).toBe(true);
      expect(Number.isFinite(r.discharge)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("pumps and compressible flow", () => {
  test("every hostile NPSH argument is refused", () => {
    const base = {
      pSurface: 101325,
      pVapour: 2339,
      rho: 998,
      staticHead: 2,
      suctionLosses: 0.5,
      npshRequired: 3,
    };
    for (const v of HOSTILE) {
      for (const k of ["pSurface", "pVapour", "rho", "staticHead", "suctionLosses", "npshRequired"] as const) {
        expect(npshAnalysis({ ...base, [k]: v }).ok).toBe(false);
      }
    }
    for (const v of [0, -1]) {
      expect(npshAnalysis({ ...base, rho: v }).ok).toBe(false);
      expect(npshAnalysis({ ...base, pSurface: v }).ok).toBe(false);
    }
  });

  test("cavitation is reported whenever the margin is not positive", () => {
    const bad: string[] = [];
    for (let req = 0; req <= 20; req += 0.5) {
      const r = npshAnalysis({
        pSurface: 101325,
        pVapour: 2339,
        rho: 998,
        staticHead: 0,
        suctionLosses: 0,
        npshRequired: req,
      });
      if (!r.ok) continue;
      const shouldCavitate = r.margin <= 0;
      if (r.cavitating !== shouldCavitate) bad.push(`req=${req}`);
    }
    expect(bad).toEqual([]);
  });

  test("compressible relations stay finite and monotonic across Mach", () => {
    const bad: string[] = [];
    let prevP = 0;
    within(1000, () => {
      for (let m = 0; m <= 10; m += 0.05) {
        const r = compressibleFlow(m);
        if (!r.ok) continue;
        for (const v of [r.temperatureRatio, r.pressureRatio, r.densityRatio, r.criticalPressureRatio]) {
          if (!Number.isFinite(v) || v <= 0) bad.push(`M=${m}: ${v}`);
        }
        // Stagnation pressure ratio must rise monotonically with Mach.
        if (r.pressureRatio < prevP) bad.push(`M=${m}: pressure ratio fell`);
        prevP = r.pressureRatio;
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("the area ratio has its minimum of exactly 1 at Mach 1", () => {
    const bad: string[] = [];
    for (let m = 0.05; m <= 5; m += 0.05) {
      const r = compressibleFlow(m);
      if (!r.ok) continue;
      if (r.areaRatio < 1 - 1e-9) bad.push(`M=${m}: A/A* = ${r.areaRatio}`);
    }
    expect(bad).toEqual([]);
  });

  test("hostile compressible arguments are refused", () => {
    for (const v of [...HOSTILE, -1]) expect(compressibleFlow(v).ok).toBe(false);
    for (const v of [...HOSTILE, 1, 0.5, -1]) expect(compressibleFlow(1, v).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("biomedical", () => {
  test("vessel resistance always rises as the radius falls", () => {
    const bad: string[] = [];
    let prev = 0;
    for (const radius of [0.01, 0.005, 0.002, 0.001, 0.0005]) {
      const r = vesselFlow({ radius, length: 0.1, flow: 1e-6, viscosity: 3.5e-3, density: 1060 });
      if (!r.ok) continue;
      if (r.resistance <= prev) bad.push(`r=${radius}`);
      prev = r.resistance;
    }
    expect(bad).toEqual([]);
  });

  test("extreme vessel geometry stays finite", () => {
    const bad: string[] = [];
    within(500, () => {
      for (const radius of [1e-6, 1e-3, 1e-1]) {
        for (const flow of [1e-12, 1e-6, 1e-2]) {
          const r = vesselFlow({ radius, length: 0.1, flow, viscosity: 3.5e-3, density: 1060 });
          if (!r.ok) continue;
          for (const v of [r.resistance, r.pressureDrop, r.velocity, r.reynolds, r.wallShearStress]) {
            if (!Number.isFinite(v)) bad.push(`r=${radius} q=${flow}: ${v}`);
          }
        }
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("every hostile biomedical argument is refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(vesselFlow({ radius: v, length: 0.1, flow: 1e-6, viscosity: 3.5e-3, density: 1060 }).ok).toBe(false);
      expect(jointStatics({ load: 100, loadArm: 0.35, muscleArm: v }).ok).toBe(false);
      expect(samplingCheck(v, 100).ok).toBe(false);
      expect(samplingCheck(1000, v).ok).toBe(false);
    }
    for (const v of HOSTILE) {
      expect(circulation({ mapMmHg: v, cvpMmHg: 5, cardiacOutputLmin: 5 }).ok).toBe(false);
    }
  });

  test("muscle force always rises as the muscle moment arm shrinks", () => {
    const bad: string[] = [];
    let prev = 0;
    for (const arm of [0.2, 0.1, 0.05, 0.02, 0.01]) {
      const r = jointStatics({ load: 100, loadArm: 0.35, muscleArm: arm });
      if (!r.ok) continue;
      if (r.muscleForce <= prev) bad.push(`arm=${arm}`);
      prev = r.muscleForce;
    }
    expect(bad).toEqual([]);
  });

  test("the aliased frequency is always inside the band, whatever the input", () => {
    const bad: string[] = [];
    within(1000, () => {
      for (let fs = 100; fs <= 2000; fs += 100) {
        for (let f = 10; f <= 10000; f += 137) {
          const r = samplingCheck(fs, f);
          if (!r.ok) continue;
          if (r.aliasedTo !== null) {
            if (r.aliasedTo < -1e-9 || r.aliasedTo > fs / 2 + 1e-9) bad.push(`fs=${fs} f=${f}: ${r.aliasedTo}`);
          }
          // A signal above Nyquist must never be reported as adequate.
          if (f >= fs / 2 && r.adequate) bad.push(`fs=${fs} f=${f}: wrongly adequate`);
        }
      }
    });
    expect(bad.slice(0, 3)).toEqual([]);
  });

  test("circulation refuses a non-survivable pressure gradient at every magnitude", () => {
    for (const [map, cvp] of [
      [50, 50],
      [50, 60],
      [0, 0],
      [10, 200],
    ]) {
      expect(circulation({ mapMmHg: map, cvpMmHg: cvp, cardiacOutputLmin: 5 }).ok).toBe(false);
    }
  });
});
