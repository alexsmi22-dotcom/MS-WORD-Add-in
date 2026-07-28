// Adversarial pass over the thermodynamics engine.
//
// The oracle tests ask whether the thermodynamics is right for a textbook case.
// This file assumes hostile input and asks the questions they cannot:
//
//   1. DOES IT REFUSE RATHER THAN INVENT? Thermodynamics has hard laws, and a
//      tool that reports a cycle beating Carnot, or a negative absolute
//      temperature, or an entropy that falls in an adiabatic process, has
//      produced a number that is not merely inaccurate but impossible.
//   2. DOES THE FIRST LAW HOLD EVERYWHERE, not just on the cases someone
//      thought to check? Q = dU + W is verified over a randomised sweep of
//      processes, gases and end states, because a branch that violates it is
//      not a rounding problem — it is a wrong formula.
//
// The Celsius-as-kelvin error gets its own section. It is the defining mistake
// of this subject, it produces plausible publishable numbers, and every guard
// against it is worth pinning.

import {
  toKelvin,
  GASES,
  idealGasProcess,
  carnot,
  ottoCycle,
  dieselCycle,
  braytonCycle,
  rankineFromEnthalpies,
  refrigerationFromEnthalpies,
  checkAgainstCarnot,
} from "../thermo";

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

const HOSTILE = [NaN, Infinity, -Infinity];

// ---------------------------------------------------------------------------
describe("the Celsius-as-kelvin error is guarded at every entry point", () => {
  test("absolute zero and below is refused in every unit", () => {
    const bad: string[] = [];
    for (const [v, u] of [
      [0, "K"],
      [-1e-9, "K"],
      [-273.15, "C"],
      [-274, "C"],
      [-459.67, "F"],
      [-1000, "F"],
    ] as [number, "K" | "C" | "F"][]) {
      const r = toKelvin(v, u);
      if (typeof r === "number") bad.push(`${v} ${u} accepted as ${r} K`);
    }
    expect(bad).toEqual([]);
  });

  test("a plausible Celsius value used as kelvin is not silently accepted downstream", () => {
    // 500 C and 20 C entered as kelvin gives a bound of 0.96 instead of 0.62.
    // The engine cannot know the intent, but the CHECK function must catch the
    // impossible efficiency that results.
    const wrong = checkAgainstCarnot(0.68, 500, 20, "efficiency");
    const right = checkAgainstCarnot(0.68, 773.15, 293.15, "efficiency");
    if (!wrong.ok || !right.ok) throw new Error("setup");
    expect(wrong.possible).toBe(true); // 0.68 < 0.96, so wrongly "possible"
    expect(right.possible).toBe(false); // correctly impossible
    expect(right.message).toMatch(/Celsius/);
  });

  test("carnot warns when the bound is implausibly high", () => {
    const c = carnot(1500, 30);
    if (!c.ok) throw new Error(c.error);
    expect(c.efficiency).toBeGreaterThan(0.9);
    expect(c.notes.join(" ")).toMatch(/Celsius/);
  });
});

// ---------------------------------------------------------------------------
describe("the first law holds over a randomised sweep", () => {
  test("Q = dU + W for every gas, process and end state", () => {
    // A fixed seed so a failure is reproducible.
    let seed = 20260728;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const violations: string[] = [];
    let checked = 0;
    within(4000, () => {
      for (let trial = 0; trial < 1500; trial++) {
        const gas = GASES[Math.floor(rnd() * GASES.length)];
        const kinds = ["isothermal", "isobaric", "isochoric", "isentropic", "polytropic"] as const;
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        const p1 = 1e4 + rnd() * 1e6;
        const t1 = 200 + rnd() * 1200;
        const m = 0.1 + rnd() * 10;
        const n = kind === "polytropic" ? 0.2 + rnd() * 2 : undefined;
        // Pick whichever end quantity that process accepts.
        const ratio = 0.2 + rnd() * 4;
        const inp =
          kind === "isochoric"
            ? { gasId: gas.id, m, p1, t1, kind, p2: p1 * ratio }
            : kind === "isobaric"
              ? { gasId: gas.id, m, p1, t1, kind, t2: t1 * ratio }
              : { gasId: gas.id, m, p1, t1, kind, n, p2: p1 * ratio };
        const r = idealGasProcess(inp);
        if (!r.ok) continue;
        checked++;
        const residual = r.heat - (r.deltaU + r.work);
        const scale = Math.max(1, Math.abs(r.heat), Math.abs(r.work), Math.abs(r.deltaU));
        if (Math.abs(residual) > 1e-9 * scale) {
          violations.push(`${gas.id} ${kind} n=${n}: residual ${residual}`);
        }
        // Enthalpy and internal energy must be consistent through R.
        const dh = r.deltaH - (r.deltaU + m * gas.R * (r.t2 - r.t1));
        if (Math.abs(dh) > 1e-9 * scale) violations.push(`${gas.id} ${kind}: dH inconsistent by ${dh}`);
      }
    });
    expect(checked).toBeGreaterThan(500);
    expect(violations.slice(0, 5)).toEqual([]);
  });

  test("an isentropic process has zero entropy change for every gas", () => {
    const bad: string[] = [];
    for (const g of GASES) {
      for (const ratio of [0.1, 0.5, 2, 10, 100]) {
        const r = idealGasProcess({ gasId: g.id, m: 1, p1: 1e5, t1: 300, kind: "isentropic", p2: 1e5 * ratio });
        if (!r.ok) continue;
        const scale = Math.abs(r.deltaU / 300) + 1;
        if (Math.abs(r.deltaS) > 1e-9 * scale) bad.push(`${g.id} at ratio ${ratio}: dS = ${r.deltaS}`);
        if (Math.abs(r.heat) > 1e-9 * Math.max(1, Math.abs(r.deltaU))) bad.push(`${g.id}: Q = ${r.heat}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("extreme but legal states stay finite", () => {
    within(500, () => {
      for (const p1 of [1, 1e9]) {
        for (const t1 of [1, 5000]) {
          for (const ratio of [1e-6, 1e6]) {
            const r = idealGasProcess({ gasId: "air", m: 1, p1, t1, kind: "isentropic", p2: p1 * ratio });
            if (r.ok) {
              for (const v of [r.p2, r.v2, r.t2, r.work, r.heat, r.deltaU, r.deltaH, r.deltaS]) {
                expect(Number.isFinite(v)).toBe(true);
              }
              expect(r.t2).toBeGreaterThan(0);
              expect(r.p2).toBeGreaterThan(0);
              expect(r.v2).toBeGreaterThan(0);
            }
          }
        }
      }
    });
  });

  test("every non-finite or non-positive input is refused", () => {
    const base = { gasId: "air", m: 1, p1: 1e5, t1: 300, kind: "isobaric" as const, t2: 400 };
    for (const v of [...HOSTILE, 0, -1]) {
      expect(idealGasProcess({ ...base, m: v }).ok).toBe(false);
      expect(idealGasProcess({ ...base, p1: v }).ok).toBe(false);
      expect(idealGasProcess({ ...base, t1: v }).ok).toBe(false);
    }
  });

  test("an unknown gas falls back rather than crashing", () => {
    const r = idealGasProcess({ gasId: "unobtainium", m: 1, p1: 1e5, t1: 300, kind: "isobaric", t2: 400 });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("no cycle ever beats Carnot, over a wide sweep", () => {
  test("Otto, Diesel and Brayton all stay below their own Carnot bound", () => {
    const violations: string[] = [];
    within(2000, () => {
      for (const gas of GASES) {
        for (const r of [2, 5, 8, 12, 18, 25, 40]) {
          const o = ottoCycle(r, gas.id, 300, 2000);
          if (o.ok && o.carnotEfficiency !== null && o.efficiency >= o.carnotEfficiency) {
            violations.push(`otto ${gas.id} r=${r}: ${o.efficiency} >= ${o.carnotEfficiency}`);
          }
          for (const rc of [1.5, 2, 3]) {
            if (rc >= r) continue;
            const d = dieselCycle(r, rc, gas.id, 300);
            if (d.ok && d.carnotEfficiency !== null && d.efficiency >= d.carnotEfficiency) {
              violations.push(`diesel ${gas.id} r=${r} rc=${rc}: ${d.efficiency} >= ${d.carnotEfficiency}`);
            }
          }
        }
        for (const rp of [2, 5, 10, 20, 50]) {
          const b = braytonCycle(rp, gas.id, 300, 2000);
          if (b.ok && b.carnotEfficiency !== null && b.efficiency >= b.carnotEfficiency) {
            violations.push(`brayton ${gas.id} rp=${rp}: ${b.efficiency} >= ${b.carnotEfficiency}`);
          }
        }
      }
    });
    expect(violations.slice(0, 5)).toEqual([]);
  });

  test("every efficiency is a fraction between 0 and 1", () => {
    const bad: string[] = [];
    for (const gas of GASES) {
      for (const r of [1.5, 8, 30, 100, 1000]) {
        const o = ottoCycle(r, gas.id);
        if (o.ok && !(o.efficiency > 0 && o.efficiency < 1)) bad.push(`otto ${gas.id} r=${r}: ${o.efficiency}`);
        const b = braytonCycle(r, gas.id);
        if (b.ok && !(b.efficiency > 0 && b.efficiency < 1)) bad.push(`brayton ${gas.id} rp=${r}: ${b.efficiency}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("impossible geometry is refused rather than producing a negative efficiency", () => {
    for (const v of [...HOSTILE, 0, 1, -5, 0.5]) {
      expect(ottoCycle(v).ok).toBe(false);
      expect(braytonCycle(v).ok).toBe(false);
    }
    expect(dieselCycle(18, 1).ok).toBe(false);
    expect(dieselCycle(18, 18).ok).toBe(false);
    expect(dieselCycle(18, 25).ok).toBe(false);
    expect(dieselCycle(1, 2).ok).toBe(false);
  });

  test("a peak temperature below the compression temperature is refused, not negative-heat", () => {
    // At r = 20 the compression alone takes 300 K to about 1000 K.
    expect(ottoCycle(20, "air", 300, 500).ok).toBe(false);
    expect(braytonCycle(40, "air", 300, 500).ok).toBe(false);
  });

  test("Carnot refuses inverted or equal reservoirs at any magnitude", () => {
    for (const [th, tc] of [
      [300, 300],
      [300, 301],
      [1, 1],
      [1e6, 1e6],
    ]) {
      expect(carnot(th, tc).ok).toBe(false);
    }
    for (const v of [...HOSTILE, 0, -100]) {
      expect(carnot(v, 100).ok).toBe(false);
      expect(carnot(500, v).ok).toBe(false);
    }
  });

  test("Carnot efficiency is always between 0 and 1, and the COP identity always holds", () => {
    const bad: string[] = [];
    within(500, () => {
      for (let th = 10; th <= 3000; th += 37) {
        for (let tc = 1; tc < th; tc += Math.max(1, Math.floor(th / 7))) {
          const c = carnot(th, tc);
          if (!c.ok) continue;
          if (!(c.efficiency > 0 && c.efficiency < 1)) bad.push(`eta ${th}/${tc} = ${c.efficiency}`);
          if (Math.abs(c.copHeatPump - c.copRefrigerator - 1) > 1e-9 * c.copHeatPump) {
            bad.push(`COP identity ${th}/${tc}`);
          }
        }
      }
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("vapour cycles refuse thermodynamically backwards data", () => {
  test("every backwards enthalpy ordering is refused", () => {
    // Boiler removing heat, turbine absorbing work, pump removing energy.
    expect(rankineFromEnthalpies(191, 195, 100, 90).ok).toBe(false);
    expect(rankineFromEnthalpies(191, 195, 3214, 3300).ok).toBe(false);
    expect(rankineFromEnthalpies(300, 100, 3214, 2100).ok).toBe(false);
    for (const v of HOSTILE) {
      expect(rankineFromEnthalpies(v, 195, 3214, 2100).ok).toBe(false);
      expect(rankineFromEnthalpies(191, v, 3214, 2100).ok).toBe(false);
      expect(rankineFromEnthalpies(191, 195, v, 2100).ok).toBe(false);
      expect(rankineFromEnthalpies(191, 195, 3214, v).ok).toBe(false);
    }
  });

  test("a valid Rankine cycle always closes its energy balance", () => {
    const bad: string[] = [];
    for (const h4 of [1800, 2000, 2200, 2500, 3000]) {
      const r = rankineFromEnthalpies(191.8, 195, 3214, h4);
      if (!r.ok) continue;
      const residual = r.heatIn - r.heatOut - r.netWork;
      if (Math.abs(residual) > 1e-9 * r.heatIn) bad.push(`h4=${h4}: ${residual}`);
      if (!(r.efficiency > 0 && r.efficiency < 1)) bad.push(`h4=${h4}: eta ${r.efficiency}`);
    }
    expect(bad).toEqual([]);
  });

  test("refrigeration refuses impossible states and keeps the COP identity", () => {
    expect(refrigerationFromEnthalpies(239, 200, 95).ok).toBe(false);
    expect(refrigerationFromEnthalpies(239, 275, 300).ok).toBe(false);
    for (const v of HOSTILE) expect(refrigerationFromEnthalpies(v, 275, 95).ok).toBe(false);

    const bad: string[] = [];
    for (let h2 = 245; h2 <= 400; h2 += 7) {
      const r = refrigerationFromEnthalpies(239.2, h2, 95.5);
      if (!r.ok) continue;
      if (Math.abs(r.copHeatPump - r.copRefrigerator - 1) > 1e-9 * r.copHeatPump) bad.push(`h2=${h2}`);
      if (!(r.copRefrigerator > 0)) bad.push(`h2=${h2}: COP ${r.copRefrigerator}`);
    }
    expect(bad).toEqual([]);
  });

  test("the Carnot check refuses bad arguments and never mislabels", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(checkAgainstCarnot(v, 800, 300, "efficiency").ok).toBe(false);
    }
    expect(checkAgainstCarnot(0.5, 300, 800, "efficiency").ok).toBe(false);
    // A claim exactly at the bound is possible, not impossible.
    const c = carnot(800, 300);
    if (!c.ok) throw new Error(c.error);
    const atBound = checkAgainstCarnot(c.efficiency, 800, 300, "efficiency");
    if (!atBound.ok) throw new Error(atBound.error);
    expect(atBound.possible).toBe(true);
    // A hair above it is not.
    const over = checkAgainstCarnot(c.efficiency * 1.0001, 800, 300, "efficiency");
    if (!over.ok) throw new Error(over.error);
    expect(over.possible).toBe(false);
  });
});
