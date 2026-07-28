// Adversarial pass over the pharmacokinetics engine.
//
// The oracle tests ask whether the PK is right for a normal drug. This file
// assumes hostile input and asks the two questions they cannot:
//
//   1. DOES IT TERMINATE, fast? The multiple-dose curve is a double loop over
//      doses and sample points, and the NCA terminal-window search is a loop
//      over every window. All of it runs on every keystroke in a task pane,
//      where a loop that does not return is a frozen Word.
//   2. DOES IT REFUSE RATHER THAN INVENT? A concentration profile that never
//      falls, a study with no measurable tail, or an oral dataset with no IV
//      reference must be reported honestly rather than given a confident
//      clearance.
//
// The physiologically extreme cases here are not hypothetical: a half-life of
// minutes (adenosine) and one of weeks (amiodarone) are both real drugs, and
// they differ by five orders of magnitude in exactly the quantity every loop
// bound here depends on.

import {
  singleDoseCurve,
  steadyState,
  multipleDoseCurve,
  nca,
  parseConcentrationData,
  PkParams,
} from "../pk";

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

function nonFinite(o: unknown, path = "result"): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(`${p} = ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${p}.${k}`);
    }
  };
  walk(o, path);
  return bad;
}

const BASE: PkParams = { dose: 500, vd: 35, cl: 3.5, f: 1 };
const HOSTILE = [NaN, Infinity, -Infinity];

// ---------------------------------------------------------------------------
describe("every non-finite or non-physical parameter is refused", () => {
  test("core parameters", () => {
    for (const key of ["dose", "vd", "cl", "f"] as const) {
      for (const v of [...HOSTILE, 0, -1]) {
        const p = { ...BASE, [key]: v };
        expect({ key, v, ok: singleDoseCurve("iv-bolus", p, 24).ok }).toEqual({ key, v, ok: false });
        expect({ key, v, ok: steadyState(p, 12).ok }).toEqual({ key, v, ok: false });
      }
    }
  });

  test("bioavailability above 1 is refused rather than clamped", () => {
    // F > 1 is not a rounding problem, it is more drug absorbed than given.
    expect(singleDoseCurve("oral", { ...BASE, f: 1.5, ka: 1 }, 24).ok).toBe(false);
    expect(steadyState({ ...BASE, f: 2 }, 12).ok).toBe(false);
  });

  test("end time and interval", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(singleDoseCurve("iv-bolus", BASE, v).ok).toBe(false);
      expect(steadyState(BASE, v).ok).toBe(false);
    }
  });

  test("route-specific parameters", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(singleDoseCurve("infusion", { ...BASE, tInf: v }, 24).ok).toBe(false);
      expect(singleDoseCurve("oral", { ...BASE, ka: v }, 24).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("physiologically extreme drugs stay finite and fast", () => {
  // Adenosine's half-life is seconds; amiodarone's is around 50 days. Both are
  // real, and they bracket every loop bound in this module.
  const EXTREMES: [string, PkParams][] = [
    ["ultra-short (t1/2 ~ seconds)", { dose: 6, vd: 5, cl: 3000, f: 1 }],
    ["very long (t1/2 ~ weeks)", { dose: 200, vd: 5000, cl: 0.3, f: 1 }],
    ["tiny volume", { dose: 500, vd: 1e-6, cl: 3.5, f: 1 }],
    ["huge volume", { dose: 500, vd: 1e9, cl: 3.5, f: 1 }],
    ["tiny clearance", { dose: 500, vd: 35, cl: 1e-9, f: 1 }],
    ["huge clearance", { dose: 500, vd: 35, cl: 1e9, f: 1 }],
  ];

  test.each(EXTREMES)("%s: single dose", (_label, p) => {
    within(200, () => {
      for (const route of ["iv-bolus", "infusion", "oral"] as const) {
        const r = singleDoseCurve(route, { ...p, ka: 1, tInf: 1 }, 24, 400);
        if (r.ok) {
          expect(nonFinite({ c: r.c, k: r.k, cmax: r.cmax, auc: r.auc })).toEqual([]);
          // Concentration is a physical quantity; it cannot be negative.
          expect(r.c.every((v) => v >= -1e-12)).toBe(true);
        }
      }
    });
  });

  test.each(EXTREMES)("%s: steady state", (_label, p) => {
    within(200, () => {
      const r = steadyState(p, 12);
      if (r.ok) {
        expect(nonFinite({ ...r, notes: 0 })).toEqual([]);
        // A trough can never exceed a peak, whatever the numbers.
        expect(r.cMinSs).toBeLessThanOrEqual(r.cMaxSs * (1 + 1e-9));
        expect(r.accumulation).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    });
  });

  test("a dosing interval far shorter than the half-life does not overflow", () => {
    // Accumulation ratio goes to infinity as tau goes to zero; it must be
    // refused or finite, never Infinity reported as a concentration.
    for (const tau of [1e-12, 1e-9, 1e-6]) {
      const r = steadyState({ dose: 200, vd: 5000, cl: 0.3, f: 1 }, tau);
      if (r.ok) expect(nonFinite({ ...r, notes: 0 })).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe("multiple dosing is bounded in both loops", () => {
  test("a large dose count terminates inside the pane budget", () => {
    within(1500, () => {
      const r = multipleDoseCurve(BASE, 12, 1000, 2000);
      if (r.ok) {
        expect(r.c.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
        // The dose cap must actually bind rather than being attempted.
        expect(r.t.length).toBeLessThanOrEqual(2000);
      }
    });
  });

  test("absurd point counts are clamped", () => {
    within(1500, () => {
      for (const pts of [1e7, -5, 0, NaN]) {
        const r = multipleDoseCurve(BASE, 12, 10, pts as number);
        if (r.ok) expect(r.t.length).toBeLessThanOrEqual(2000);
      }
    });
  });

  test("concentration never goes negative or non-finite over many doses", () => {
    const r = multipleDoseCurve({ dose: 1e6, vd: 1e-3, cl: 1e-6, f: 1 }, 0.001, 200, 1000);
    if (r.ok) expect(nonFinite(r.c)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("NCA refuses rather than reporting a confident wrong parameter", () => {
  test("a flat profile has no terminal slope and is refused", () => {
    expect(nca([1, 2, 3, 4, 5], [5, 5, 5, 5, 5], 100, "iv").ok).toBe(false);
  });

  test("a rising profile is refused", () => {
    expect(nca([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 100, "iv").ok).toBe(false);
  });

  test("zeros in the tail do not produce log(0)", () => {
    const r = nca([0.5, 1, 2, 4, 8, 12, 24], [10, 9, 7, 4, 2, 1, 0], 100, "iv");
    if (r.ok) {
      expect(nonFinite({ l: r.lambdaZ, h: r.halfLife, a: r.aucInf, c: r.clearance, v: r.volume, m: r.mrt })).toEqual([]);
    }
  });

  test("every concentration zero is refused rather than divided by", () => {
    expect(nca([1, 2, 3], [0, 0, 0], 100, "iv").ok).toBe(false);
  });

  test("noisy real-world data still yields finite parameters or a refusal", () => {
    let seed = 24680;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    within(3000, () => {
      for (let trial = 0; trial < 200; trial++) {
        const times = [0.25, 0.5, 1, 2, 4, 6, 8, 12, 18, 24];
        const k = 0.05 + rnd() * 0.5;
        const conc = times.map((t) => {
          const clean = 10 * Math.exp(-k * t);
          // +-30% multiplicative noise, which is worse than a real assay.
          return Math.max(0, clean * (0.7 + 0.6 * rnd()));
        });
        const r = nca(times, conc, 500, "iv");
        if (r.ok) {
          expect(nonFinite({ l: r.lambdaZ, h: r.halfLife, a: r.aucInf, c: r.clearance, v: r.volume })).toEqual([]);
          expect(r.lambdaZ).toBeGreaterThan(0);
          expect(r.aucInf).toBeGreaterThanOrEqual(r.aucLast);
          expect(r.percentExtrapolated).toBeGreaterThanOrEqual(0);
          expect(r.percentExtrapolated).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  test("the extrapolated fraction is always a real percentage", () => {
    // A very early cut-off makes the tail dominate; it must still be 0-100.
    const r = nca([0.1, 0.2, 0.3], [10, 9.9, 9.8], 500, "iv");
    if (r.ok) {
      expect(r.percentExtrapolated).toBeGreaterThan(0);
      expect(r.percentExtrapolated).toBeLessThanOrEqual(100);
      expect(r.notes.join(" ")).toMatch(/EXTRAPOLATION/);
    }
  });

  test("a very large dataset terminates", () => {
    const times: number[] = [];
    const conc: number[] = [];
    for (let i = 1; i <= 1500; i++) {
      times.push(i * 0.05);
      conc.push(20 * Math.exp(-0.1 * i * 0.05));
    }
    within(4000, () => {
      const r = nca(times, conc, 500, "iv");
      if (r.ok) expect(Math.abs(r.lambdaZ - 0.1) / 0.1).toBeLessThan(0.02);
    });
  });

  test("more points than the cap are refused rather than attempted", () => {
    const times = Array.from({ length: 5000 }, (_, i) => i + 1);
    const conc = times.map((t) => Math.exp(-0.01 * t));
    expect(nca(times, conc, 500, "iv").ok).toBe(false);
  });

  test("oral data never claims true clearance", () => {
    const r = nca([0.5, 1, 2, 4, 8, 12, 24], [2, 9, 8, 5, 2, 1, 0.2], 100, "oral");
    if (r.ok) {
      expect(r.notes.join(" ")).toMatch(/CL\/F/);
      expect(r.notes.join(" ")).not.toMatch(/Vss = CL x MRT/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the parser never throws", () => {
  test("junk of every shape is handled", () => {
    const junk = [
      "",
      "   ",
      "\n\n\n",
      "1",
      "1 2 3",
      "a b",
      "1 NaN",
      "NaN 1",
      "Infinity 1",
      "1,2\n3,4\n",
      "-1 -2",
      "#".repeat(5000),
      "1 2\r\n3 4\r\n",
      "1\t2",
      "x".repeat(50000),
    ];
    within(2000, () => {
      for (const j of junk) {
        const p = parseConcentrationData(j);
        expect(Array.isArray(p.errors)).toBe(true);
        expect(p.times.length).toBe(p.concentrations.length);
        // Whatever came out must be safe to hand straight to the analyser.
        nca(p.times, p.concentrations, 100, "iv");
      }
    });
  });

  test("a huge but well-formed dataset parses in time", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `${i + 1} ${(100 * Math.exp(-0.01 * i)).toFixed(4)}`).join("\n");
    within(2000, () => {
      const p = parseConcentrationData(text);
      expect(p.errors).toEqual([]);
      expect(p.times).toHaveLength(5000);
    });
  });
});

// ---------------------------------------------------------------------------
describe("internal consistency across the module", () => {
  // Independent routes to the same quantity must agree.
  test("AUC from the model equals Dose/CL for every route", () => {
    for (const [route, extra] of [
      ["iv-bolus", {}],
      ["infusion", { tInf: 2 }],
      ["oral", { ka: 1.2 }],
    ] as const) {
      const p = { ...BASE, f: route === "oral" ? 0.7 : 1, ...extra };
      const r = singleDoseCurve(route, p, 500, 400);
      if (!r.ok) throw new Error(r.error);
      const expected = (p.f * p.dose) / p.cl;
      expect({ route, close: Math.abs(r.auc - expected) < 1e-9 * expected }).toEqual({ route, close: true });
    }
  });

  test("the steady-state average equals the single-dose AUC divided by the interval", () => {
    // Cavg,ss = AUC_single / tau is an identity for a linear system.
    for (const tau of [4, 8, 12, 24, 48]) {
      const ss = steadyState(BASE, tau);
      const single = singleDoseCurve("iv-bolus", BASE, 1000);
      if (!ss.ok || !single.ok) throw new Error("setup");
      expect(Math.abs(ss.cAvgSs - single.auc / tau)).toBeLessThan(1e-9 * ss.cAvgSs);
    }
  });

  test("the simulated multiple-dose peak approaches the predicted steady-state peak", () => {
    const tau = 8;
    const ss = steadyState(BASE, tau);
    const trace = multipleDoseCurve(BASE, tau, 40, 4000);
    if (!ss.ok || !trace.ok) throw new Error("setup");
    const late = trace.c.slice(Math.floor(trace.c.length * 0.9));
    const peak = Math.max(...late);
    expect(Math.abs(peak - ss.cMaxSs) / ss.cMaxSs).toBeLessThan(0.02);
  });
});
