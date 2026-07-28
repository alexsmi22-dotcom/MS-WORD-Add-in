// Adversarial pass over the fatigue engine.
//
// This module gets a stricter adversarial pass than most, because its output is
// used to decide whether a part will break. The questions are:
//
//   1. DOES IT REFUSE RATHER THAN INVENT? A factor of safety returned for
//      impossible material data, a life returned for a stress the method does
//      not cover, or an "infinite life" for a material that has no endurance
//      limit are each worse than an error message, because they are acted on.
//   2. ARE THE MONOTONIC PROPERTIES ACTUALLY MONOTONIC? Higher stress must
//      always mean shorter life; higher reliability must always mean a lower
//      endurance limit; more damage must always mean fewer repeats. These are
//      properties of the physics, not of any particular formula, and a sign
//      error or a mis-bracketed exponent breaks them somewhere even when the
//      textbook case still passes.
//   3. DOES IT TERMINATE? The reliability inversion is a bisection.

import {
  normalVariate,
  enduranceLimit,
  notchFactor,
  meanStressAnalysis,
  finiteLife,
  minerDamage,
  EnduranceInput,
  Criterion,
} from "../fatigue";

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

const HOSTILE = [NaN, Infinity, -Infinity];
const BASE: EnduranceInput = {
  sut: 700,
  materialClass: "steel",
  surface: "machined",
  diameter: 25,
  load: "bending",
  tempC: 20,
  reliability: 0.9,
};

// ---------------------------------------------------------------------------
describe("the reliability inversion is bounded and correct", () => {
  test("it terminates over the whole usable range", () => {
    const bad: string[] = [];
    within(1000, () => {
      for (let p = 0.001; p < 0.9999; p += 0.001) {
        const z = normalVariate(p);
        if (z === null || !Number.isFinite(z)) bad.push(`p=${p}`);
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("it is monotonic in the reliability", () => {
    const bad: string[] = [];
    let prev = -Infinity;
    for (let p = 0.01; p < 0.99; p += 0.01) {
      const z = normalVariate(p) as number;
      if (z <= prev) bad.push(`p=${p}: ${z} <= ${prev}`);
      prev = z;
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("extreme reliabilities are handled or refused, never hung", () => {
    within(200, () => {
      for (const p of [1e-12, 1 - 1e-12, 0.5]) {
        const z = normalVariate(p);
        if (z !== null) expect(Number.isFinite(z)).toBe(true);
      }
    });
    for (const p of [...HOSTILE, 0, 1, -1, 2]) expect(normalVariate(p)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("endurance limit: refusals and monotonicity", () => {
  test("every non-finite or non-physical input is refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(enduranceLimit({ ...BASE, sut: v }).ok).toBe(false);
      expect(enduranceLimit({ ...BASE, diameter: v }).ok).toBe(false);
    }
    for (const v of [...HOSTILE, 0, 1, -0.5, 1.5]) {
      expect(enduranceLimit({ ...BASE, reliability: v }).ok).toBe(false);
    }
    for (const v of HOSTILE) expect(enduranceLimit({ ...BASE, tempC: v }).ok).toBe(false);
  });

  test("the corrected limit is always positive and never exceeds the uncorrected one", () => {
    const bad: string[] = [];
    within(2000, () => {
      for (const sut of [200, 500, 700, 1000, 1400, 2000]) {
        for (const surface of ["ground", "machined", "hot-rolled", "as-forged"] as const) {
          for (const load of ["bending", "axial", "torsion"] as const) {
            for (const diameter of [3, 25, 100, 400]) {
              for (const reliability of [0.5, 0.9, 0.99, 0.999]) {
                const r = enduranceLimit({ ...BASE, sut, surface, load, diameter, reliability });
                if (!r.ok) continue;
                if (!(r.se > 0)) bad.push(`se ${r.se} for sut=${sut} ${surface} ${load}`);
                // se CAN exceed Se' — but only via the size factor, which is
                // normalised at the 7.62 mm test specimen and so exceeds 1 for
                // smaller sections. Every OTHER factor must be at most 1.
                if (r.se > r.sePrime * 1.000001 && r.kb <= 1) {
                  bad.push(`se > sePrime with kb=${r.kb} for sut=${sut}`);
                }
                for (const [name, f] of [["ka", r.ka], ["kc", r.kc], ["kd", r.kd]] as [string, number][]) {
                  if (f > 1.000001) bad.push(`${name} = ${f} exceeds 1`);
                }
                for (const f of [r.ka, r.kb, r.kc, r.kd, r.ke]) {
                  if (!Number.isFinite(f) || f <= 0) bad.push(`bad factor ${f}`);
                }
              }
            }
          }
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("higher reliability always gives a lower endurance limit", () => {
    const bad: string[] = [];
    let prev = Infinity;
    for (const rel of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 0.999, 0.9999]) {
      const r = enduranceLimit({ ...BASE, reliability: rel });
      if (!r.ok) continue;
      if (r.se >= prev) bad.push(`rel=${rel}: ${r.se} >= ${prev}`);
      prev = r.se;
    }
    expect(bad).toEqual([]);
  });

  test("a rougher surface always gives a lower endurance limit", () => {
    const order = ["ground", "machined", "hot-rolled", "as-forged"] as const;
    let prev = Infinity;
    const bad: string[] = [];
    for (const surface of order) {
      const r = enduranceLimit({ ...BASE, surface });
      if (!r.ok) continue;
      if (r.se >= prev) bad.push(`${surface}: ${r.se} >= ${prev}`);
      prev = r.se;
    }
    expect(bad).toEqual([]);
  });

  test("a bigger section never gives a higher endurance limit in bending", () => {
    const bad: string[] = [];
    let prev = Infinity;
    for (const d of [3, 10, 25, 51, 100, 254]) {
      const r = enduranceLimit({ ...BASE, diameter: d });
      if (!r.ok) continue;
      if (r.se > prev * 1.000001) bad.push(`d=${d}: ${r.se} > ${prev}`);
      prev = r.se;
    }
    expect(bad).toEqual([]);
  });

  test("creep temperature is refused at every value above the limit", () => {
    for (const t of [451, 600, 1000, 5000]) {
      expect(enduranceLimit({ ...BASE, tempC: t }).ok).toBe(false);
    }
    // Just below is still allowed, and derated.
    const r = enduranceLimit({ ...BASE, tempC: 449 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kd).toBeLessThan(1);
  });

  test("a non-ferrous material never claims an endurance limit", () => {
    const r = enduranceLimit({ ...BASE, materialClass: "non-ferrous" });
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/NO TRUE ENDURANCE LIMIT/);
  });
});

// ---------------------------------------------------------------------------
describe("notch factor", () => {
  test("Kf is always between 1 and Kt", () => {
    const bad: string[] = [];
    for (let kt = 1; kt <= 10; kt += 0.25) {
      for (let q = 0; q <= 1; q += 0.05) {
        const r = notchFactor(kt, q);
        if (!r.ok) continue;
        if (r.kf < 1 - 1e-12 || r.kf > kt + 1e-12) bad.push(`kt=${kt} q=${q}: kf=${r.kf}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("out-of-range arguments are refused", () => {
    for (const v of [...HOSTILE, 0, 0.5, -1]) expect(notchFactor(v).ok).toBe(false);
    for (const v of [...HOSTILE, -0.01, 1.01, 2]) expect(notchFactor(2, v).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("mean stress: the governing factor is never overstated", () => {
  test("the governing factor is always the smaller of fatigue and yield", () => {
    const bad: string[] = [];
    within(3000, () => {
      for (let sa = 0; sa <= 400; sa += 25) {
        for (let sm = -200; sm <= 480; sm += 40) {
          for (const crit of ["goodman", "soderberg", "gerber", "asme-elliptic"] as Criterion[]) {
            const r = meanStressAnalysis(sa, sm, 250, 700, 500, crit);
            if (!r.ok) continue;
            const expected = Math.min(r.nFatigue, r.nYield);
            if (Math.abs(r.nGoverning - expected) > 1e-12 * Math.max(1, expected)) {
              bad.push(`sa=${sa} sm=${sm} ${crit}: ${r.nGoverning} vs ${expected}`);
            }
            // An infinite fatigue factor is legitimate and only in one place:
            // no alternating stress AND no tensile mean stress means nothing can
            // drive a crack. It must still be explained rather than printed as
            // a number, and the GOVERNING factor must fall back to the finite
            // yield check.
            if (!Number.isFinite(r.nFatigue)) {
              if (!(sa === 0 && sm <= 0)) bad.push(`sa=${sa} sm=${sm} ${crit}: unexpected infinite n`);
              if (!Number.isFinite(r.nGoverning)) bad.push(`sa=${sa} sm=${sm} ${crit}: governing not finite`);
              if (!r.notes.join(" ").match(/NO FATIGUE LOADING/)) bad.push(`sa=${sa} sm=${sm}: unexplained infinity`);
            } else if (r.nFatigue <= 0) {
              bad.push(`sa=${sa} sm=${sm} ${crit}: n=${r.nFatigue}`);
            }
          }
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("the criteria keep their ordering everywhere: Soderberg <= Goodman <= Gerber", () => {
    const bad: string[] = [];
    for (let sa = 10; sa <= 200; sa += 10) {
      for (let sm = 0; sm <= 400; sm += 25) {
        const r = meanStressAnalysis(sa, sm, 250, 700, 500);
        if (!r.ok) continue;
        const get = (c: Criterion) => r.comparison.find((x) => x.criterion === c)!.n;
        if (get("soderberg") > get("goodman") + 1e-9) bad.push(`sa=${sa} sm=${sm}: sod > good`);
        if (get("goodman") > get("gerber") + 1e-9) bad.push(`sa=${sa} sm=${sm}: good > gerber`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("raising either stress never raises the factor of safety", () => {
    const bad: string[] = [];
    for (let sm = 0; sm <= 300; sm += 50) {
      let prev = Infinity;
      for (let sa = 10; sa <= 250; sa += 20) {
        const r = meanStressAnalysis(sa, sm, 250, 700, 500);
        if (!r.ok) continue;
        if (r.nGoverning > prev + 1e-9) bad.push(`sm=${sm} sa=${sa}: ${r.nGoverning} > ${prev}`);
        prev = r.nGoverning;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("a compressive mean stress never beats a zero mean stress", () => {
    // Treating it as zero is conservative; it must not come out BETTER.
    const zero = meanStressAnalysis(100, 0, 250, 700, 500);
    const comp = meanStressAnalysis(100, -300, 250, 700, 500);
    if (!zero.ok || !comp.ok) throw new Error("setup");
    expect(comp.nFatigue).toBeLessThanOrEqual(zero.nFatigue + 1e-12);
  });

  test("impossible material data is refused", () => {
    expect(meanStressAnalysis(100, 100, 250, 500, 700).ok).toBe(false);
    for (const v of HOSTILE) {
      expect(meanStressAnalysis(v, 100, 250, 700, 500).ok).toBe(false);
      expect(meanStressAnalysis(100, v, 250, 700, 500).ok).toBe(false);
      expect(meanStressAnalysis(100, 100, v, 700, 500).ok).toBe(false);
    }
    for (const v of [0, -1]) {
      expect(meanStressAnalysis(100, 100, v, 700, 500).ok).toBe(false);
      expect(meanStressAnalysis(100, 100, 250, v, 500).ok).toBe(false);
      expect(meanStressAnalysis(100, 100, 250, 700, v).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("finite life is monotonic and honest at its boundaries", () => {
  test("higher stress always gives shorter life", () => {
    const bad: string[] = [];
    let prev = Infinity;
    for (let sa = 251; sa <= 630; sa += 10) {
      const r = finiteLife(sa, 250, 700);
      if (!r.ok) continue;
      if (r.cycles > prev) bad.push(`sa=${sa}: ${r.cycles} > ${prev}`);
      prev = r.cycles;
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("the returned life always satisfies the S-N line it reports", () => {
    // Substituting back is the independent check on the exponent algebra.
    const bad: string[] = [];
    for (const sut of [400, 700, 1200]) {
      for (const se of [0.2 * sut, 0.35 * sut]) {
        for (const sa of [se * 1.2, se * 2, 0.85 * sut]) {
          const r = finiteLife(sa, se, sut);
          if (!r.ok || r.infiniteLife) continue;
          const back = r.a * Math.pow(r.cycles, r.b);
          if (Math.abs(back - sa) > 1e-6 * sa) bad.push(`sut=${sut} se=${se} sa=${sa}: ${back} vs ${sa}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("life is always positive and finite for a stress above the endurance limit", () => {
    const bad: string[] = [];
    within(1000, () => {
      for (let sa = 251; sa <= 1000; sa += 7) {
        const r = finiteLife(sa, 250, 700);
        if (!r.ok) continue;
        if (!(r.cycles > 0) || !Number.isFinite(r.cycles)) bad.push(`sa=${sa}: ${r.cycles}`);
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  // The distinction that matters most.
  test("only steel ever returns infinite life", () => {
    const steel = finiteLife(100, 250, 700, "steel");
    const alu = finiteLife(100, 250, 700, "non-ferrous");
    if (!steel.ok || !alu.ok) throw new Error("setup");
    expect(steel.cycles).toBe(Infinity);
    expect(alu.cycles).not.toBe(Infinity);
    expect(Number.isFinite(alu.cycles)).toBe(true);
  });

  test("a degenerate S-N line is refused rather than producing a divide by zero", () => {
    expect(finiteLife(400, 630, 700).ok).toBe(false); // Se = 0.9*Sut
    expect(finiteLife(400, 700, 700).ok).toBe(false);
    expect(finiteLife(400, 800, 700).ok).toBe(false);
  });

  test("bad inputs are refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(finiteLife(v, 250, 700).ok).toBe(false);
      expect(finiteLife(400, v, 700).ok).toBe(false);
      expect(finiteLife(400, 250, v).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Miner damage", () => {
  test("damage is additive and repeats is its reciprocal", () => {
    const bad: string[] = [];
    within(2000, () => {
      for (let n = 100; n <= 100000; n *= 3) {
        const one = minerDamage([{ sigmaA: 400, cycles: n }], 250, 700);
        const two = minerDamage([{ sigmaA: 400, cycles: 2 * n }], 250, 700);
        if (!one.ok || !two.ok) continue;
        if (Math.abs(two.damage - 2 * one.damage) > 1e-9 * two.damage) bad.push(`n=${n} not additive`);
        if (Math.abs(one.repeats - 1 / one.damage) > 1e-9 * one.repeats) bad.push(`n=${n} repeats`);
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("splitting a block in two gives the same total damage", () => {
    const whole = minerDamage([{ sigmaA: 400, cycles: 10000 }], 250, 700);
    const split = minerDamage(
      [
        { sigmaA: 400, cycles: 4000 },
        { sigmaA: 400, cycles: 6000 },
      ],
      250,
      700,
    );
    if (!whole.ok || !split.ok) throw new Error("setup");
    expect(Math.abs(whole.damage - split.damage)).toBeLessThan(1e-12 * whole.damage);
  });

  test("damage is never negative and never non-finite", () => {
    const bad: string[] = [];
    within(2000, () => {
      for (const sa of [100, 260, 400, 600]) {
        for (const n of [0, 1, 1e3, 1e9]) {
          const r = minerDamage([{ sigmaA: sa, cycles: n }], 250, 700);
          if (!r.ok) continue;
          if (!(r.damage >= 0) || !Number.isFinite(r.damage)) bad.push(`sa=${sa} n=${n}: ${r.damage}`);
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("a spectrum entirely below the endurance limit gives zero damage and infinite repeats", () => {
    const r = minerDamage(
      [
        { sigmaA: 100, cycles: 1e9 },
        { sigmaA: 200, cycles: 1e9 },
      ],
      250,
      700,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.damage).toBe(0);
    expect(r.repeats).toBe(Infinity);
    expect(r.notes.join(" ")).toMatch(/not free/i);
  });

  test("a large spectrum terminates inside the pane budget", () => {
    const blocks = Array.from({ length: 200 }, (_, i) => ({ sigmaA: 260 + i, cycles: 1000 }));
    within(1000, () => {
      const r = minerDamage(blocks, 250, 700);
      if (r.ok) expect(Number.isFinite(r.damage)).toBe(true);
    });
  });

  test("bad blocks are refused rather than skipped", () => {
    expect(minerDamage([], 250, 700).ok).toBe(false);
    for (const v of [...HOSTILE, 0, -1]) {
      expect(minerDamage([{ sigmaA: v, cycles: 100 }], 250, 700).ok).toBe(false);
    }
    for (const v of [...HOSTILE, -1]) {
      expect(minerDamage([{ sigmaA: 400, cycles: v }], 250, 700).ok).toBe(false);
    }
    expect(minerDamage(new Array(500).fill({ sigmaA: 400, cycles: 1 }), 250, 700).ok).toBe(false);
  });
});
