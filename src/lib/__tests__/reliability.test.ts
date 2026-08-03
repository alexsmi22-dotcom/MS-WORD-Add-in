// Reliability, checked against independent computations rather than against
// itself. Every closed form here has a second path - a grid search, a brute
// enumeration, a numerical integral - and the test compares the two.
//
// The two defects found while building it are pinned at the bottom, because
// both were reachable from ordinary inputs and neither was visible in a result
// that looked right.

import {
  weibullFit,
  reliabilityBlock,
  kOutOfN,
  redundancy,
  availability,
  parseLifeData,
  parseComponentList,
} from "../reliability";

/** A fixed generator, so any failure is reproducible from the report. */
const gen = (seedIn: number): (() => number) => {
  let seed = seedIn;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed + 0.5) / 0x7fffffff;
  };
};

const weibullSample = (n: number, beta: number, eta: number, seed: number): number[] => {
  const rnd = gen(seed);
  return Array.from({ length: n }, () => eta * Math.pow(-Math.log(rnd()), 1 / beta));
};

describe("Weibull fit against a brute-force maximum of the likelihood", () => {
  const times = weibullSample(40, 2.5, 1000, 20260802);
  const events = times.map(() => 1);

  const loglik = (t: number[], e: number[], b: number, eta: number): number => {
    let L = 0;
    for (let i = 0; i < t.length; i++) {
      const z = t[i] / eta;
      L += e[i] === 1 ? Math.log(b / eta) + (b - 1) * Math.log(z) - Math.pow(z, b) : -Math.pow(z, b);
    }
    return L;
  };
  // A 2-D grid over (beta, eta), which shares NO algebra with the fitter: the
  // fitter profiles eta out and root-finds, this just evaluates the likelihood
  // everywhere and keeps the best. The agreement is asserted against the GRID'S
  // OWN STEP rather than a fixed number of decimals, because "within one grid
  // cell" is the most a grid can prove and a tighter claim would be theatre.
  const B_LO = 0.5;
  const B_HI = 6;
  const E_LO = 500;
  const E_HI = 2000;
  const STEPS = 600;
  const bStep = (B_HI - B_LO) / STEPS;
  const eStep = (E_HI - E_LO) / STEPS;
  const gridMax = (t: number[], e: number[]): { beta: number; eta: number } => {
    let bb = 0;
    let be = 0;
    let bl = -Infinity;
    for (let i = 0; i <= STEPS; i++) {
      const b = B_LO + i * bStep;
      for (let j = 0; j <= STEPS; j++) {
        const eta = E_LO + j * eStep;
        const L = loglik(t, e, b, eta);
        if (L > bl) {
          bl = L;
          bb = b;
          be = eta;
        }
      }
    }
    return { beta: bb, eta: be };
  };

  it("recovers the SAME parameters a grid search finds", () => {
    const fit = weibullFit({ times, events });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const grid = gridMax(times, events);
    expect(Math.abs(fit.beta - grid.beta)).toBeLessThanOrEqual(bStep);
    expect(Math.abs(fit.eta - grid.eta)).toBeLessThanOrEqual(eStep);
    // And the grid must not have been pinned at an edge, or it proves nothing.
    expect(grid.beta).toBeGreaterThan(B_LO + bStep);
    expect(grid.beta).toBeLessThan(B_HI - bStep);
    expect(grid.eta).toBeGreaterThan(E_LO + eStep);
    expect(grid.eta).toBeLessThan(E_HI - eStep);
  });

  it("USES THE CENSORED UNITS rather than dropping them", () => {
    // Censoring at 900 h hides the long lives. A fit that discarded the
    // survivors would come out far too short; one that uses them agrees with
    // the censored likelihood's own maximum.
    const ct = times.map((t) => Math.min(t, 900));
    const ce = times.map((t) => (t <= 900 ? 1 : 0));
    const fit = weibullFit({ times: ct, events: ce });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const grid = gridMax(ct, ce);
    expect(Math.abs(fit.beta - grid.beta)).toBeLessThanOrEqual(bStep);
    expect(Math.abs(fit.eta - grid.eta)).toBeLessThanOrEqual(eStep);
    expect(fit.censored).toBeGreaterThan(0);

    // And the concrete demonstration: throwing the survivors away is worse.
    const dropped = weibullFit({ times: ct.filter((_, i) => ce[i] === 1), events: ce.filter((e) => e === 1) });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.eta).toBeLessThan(fit.eta);
  });

  it("puts eta at the 63.2 % life and B10 at the tenth, exactly", () => {
    const fit = weibullFit({ times, events });
    if (!fit.ok) throw new Error("refused");
    const F = (t: number): number => 1 - Math.exp(-Math.pow(t / fit.eta, fit.beta));
    expect(F(fit.eta)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(F(fit.b10)).toBeCloseTo(0.1, 12);
    expect(F(fit.medianLife)).toBeCloseTo(0.5, 12);
  });

  it("MTTF equals the integral of the survival function", () => {
    const fit = weibullFit({ times, events });
    if (!fit.ok) throw new Error("refused");
    let integral = 0;
    const n = 400000;
    const step = (fit.eta * 8) / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * step;
      integral += Math.exp(-Math.pow(t / fit.eta, fit.beta)) * step;
    }
    expect(fit.mttf).not.toBeNull();
    expect(fit.mttf! / integral).toBeCloseTo(1, 5);
  });

  it("reads the hazard regime from the INTERVAL, not the point estimate", () => {
    // Two units, a fitted beta well above 1, and no business calling that
    // wear-out: the interval is enormous.
    const two = weibullFit({ times: [100, 250], events: [1, 1] });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.beta).toBeGreaterThan(1);
    expect(two.regime).toBe("constant hazard");
    expect(two.betaLow!).toBeLessThan(1);
    expect(two.betaHigh!).toBeGreaterThan(1);

    // A large clean wear-out sample does resolve.
    const many = weibullSample(300, 3.5, 800, 4242);
    const wear = weibullFit({ times: many, events: many.map(() => 1) });
    expect(wear.ok).toBe(true);
    if (!wear.ok) return;
    expect(wear.regime).toBe("wear-out");
    expect(wear.betaLow!).toBeGreaterThan(1);
    expect(wear.beta).toBeGreaterThan(3);
    expect(wear.beta).toBeLessThan(4);
  });

  it("refuses what cannot be fitted, by name", () => {
    expect(weibullFit({ times: [100, 200, 300], events: [0, 0, 0] })).toEqual({
      ok: false,
      error: expect.stringContaining("Nothing has failed"),
    });
    expect(weibullFit({ times: [100, 200, 300], events: [1, 0, 0] })).toEqual({
      ok: false,
      error: expect.stringContaining("One failure cannot fix both"),
    });
    expect(weibullFit({ times: [100, 100, 100, 100], events: [1, 1, 1, 1] })).toEqual({
      ok: false,
      error: expect.stringContaining("same time"),
    });
    expect(weibullFit({ times: [100, -5], events: [1, 1] })).toEqual({
      ok: false,
      error: expect.stringContaining("positive"),
    });
    expect(weibullFit({ times: [1, 2], events: [1, 2] })).toEqual({
      ok: false,
      error: expect.stringContaining("failed (1) or still running (0)"),
    });
  });

  it("NEVER RETURNS A NON-FINITE NUMBER, over a wide sweep of shapes and scales", () => {
    const rnd = gen(31337);
    for (let trial = 0; trial < 120; trial++) {
      const beta = Math.pow(10, rnd() * 3 - 1.5);
      const eta = Math.pow(10, rnd() * 12 - 6);
      const n = 2 + Math.floor(rnd() * 25);
      const times = weibullSample(n, beta, eta, 1000 + trial);
      const events = times.map(() => (rnd() < 0.25 ? 0 : 1));
      if (!events.some((e) => e === 1)) events[0] = 1;
      const fit = weibullFit({ times, events });
      if (!fit.ok) {
        expect(typeof fit.error).toBe("string");
        continue;
      }
      for (const key of ["beta", "eta", "b10", "medianLife"] as const) {
        expect({ key, value: Number.isFinite(fit[key]) }).toEqual({ key, value: true });
      }
      expect(fit.mttf === null || Number.isFinite(fit.mttf)).toBe(true);
      expect(fit.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(fit.fitLine.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(fit.notes.join(" ")).not.toMatch(/NaN|Infinity|undefined|not finite/);
    }
  });
});

describe("series and parallel block diagrams", () => {
  it("adds the rates in series and matches exp(-sum lambda t)", () => {
    const res = reliabilityBlock({
      components: [
        { name: "pump", lambda: 1e-4, quantity: 2 },
        { name: "valve", lambda: 5e-5, quantity: 3 },
      ],
      configuration: "series",
      timeH: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.systemLambda).toBeCloseTo(3.5e-4, 15);
    expect(res.reliability).toBeCloseTo(Math.exp(-0.35), 12);
    expect(res.mttf).toBeCloseTo(1 / 3.5e-4, 8);
    expect(res.totalUnits).toBe(5);
    // The dominant component is named, and it is the one that dominates.
    expect(res.contributions[0].name).toBe("pump");
  });

  it("parallel MTTF matches the integral of the system survival function", () => {
    const lams = [1e-3, 4e-3, 2.5e-3];
    const res = reliabilityBlock({
      components: lams.map((l, i) => ({ name: `c${i}`, lambda: l, quantity: 1 })),
      configuration: "parallel",
      timeH: 100,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let integral = 0;
    const n = 400000;
    const step = 40000 / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * step;
      let F = 1;
      for (const l of lams) F *= 1 - Math.exp(-l * t);
      integral += (1 - F) * step;
    }
    expect(res.mttf! / integral).toBeCloseTo(1, 4);
  });

  it("identical units in parallel give the harmonic mean life", () => {
    const res = reliabilityBlock({
      components: [{ name: "a", lambda: 1e-3, quantity: 3 }],
      configuration: "parallel",
      timeH: 500,
    });
    if (!res.ok) throw new Error("refused");
    expect(res.reliability).toBeCloseTo(1 - Math.pow(1 - Math.exp(-0.5), 3), 12);
    expect(res.mttf).toBeCloseTo((1 + 1 / 2 + 1 / 3) / 1e-3, 9);
  });

  it("SAYS SO when it cannot report a parallel mean life, instead of inventing one", () => {
    const res = reliabilityBlock({
      components: Array.from({ length: 13 }, (_, i) => ({ name: `c${i}`, lambda: 1e-3 * (i + 1), quantity: 1 })),
      configuration: "parallel",
      timeH: 100,
    });
    if (!res.ok) throw new Error("refused");
    expect(res.mttf).toBeNull();
    expect(res.notes.join(" ")).toMatch(/not reported/);
    // The reliability is still exact, and that is what the note claims.
    let F = 1;
    for (let i = 0; i < 13; i++) F *= 1 - Math.exp(-1e-3 * (i + 1) * 100);
    expect(res.reliability).toBeCloseTo(1 - F, 12);
  });

  it("carries the independence warning wherever redundancy is claimed", () => {
    const res = reliabilityBlock({
      components: [{ name: "a", lambda: 1e-3, quantity: 2 }],
      configuration: "parallel",
      timeH: 100,
    });
    if (!res.ok) throw new Error("refused");
    expect(res.notes.join(" ")).toMatch(/common cause/i);
  });

  it("A LARGE SYSTEM DOES NOT BLOW THE STACK", () => {
    // Sixty types at ten thousand each. Quantities are multipliers, not six
    // hundred thousand array entries, and every reduction is a loop rather
    // than a spread - Math.max(...xs) throws past about sixty thousand
    // arguments, and in a task pane an uncaught throw is a dead pane.
    const res = reliabilityBlock({
      components: Array.from({ length: 60 }, (_, i) => ({ name: `c${i}`, lambda: 1e-6, quantity: 10000 })),
      configuration: "series",
      timeH: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalUnits).toBe(600000);
    expect(res.systemLambda).toBeCloseTo(0.6, 9);
    expect(res.curve.every((c) => Number.isFinite(c.R))).toBe(true);
  });

  it("stays finite at the edges of what can be typed", () => {
    const cases: { components: { name: string; lambda: number; quantity: number }[]; cfg: "series" | "parallel"; t: number }[] = [
      { components: [{ name: "a", lambda: 0, quantity: 2 }], cfg: "series", t: 100 },
      { components: [{ name: "a", lambda: 0, quantity: 5000 }], cfg: "parallel", t: 100 },
      { components: [{ name: "a", lambda: 1e-3, quantity: 2 }], cfg: "parallel", t: 0 },
      { components: [{ name: "a", lambda: 1e-3, quantity: 1 }], cfg: "series", t: 1e12 },
      {
        components: [{ name: "a", lambda: 0, quantity: 1 }, { name: "b", lambda: 1e-3, quantity: 1 }],
        cfg: "parallel",
        t: 100,
      },
    ];
    for (const c of cases) {
      const res = reliabilityBlock({ components: c.components, configuration: c.cfg, timeH: c.t });
      if (!res.ok) continue;
      expect(Number.isFinite(res.reliability)).toBe(true);
      expect(res.reliability).toBeGreaterThanOrEqual(0);
      expect(res.reliability).toBeLessThanOrEqual(1);
      expect(res.mttf === null || Number.isFinite(res.mttf)).toBe(true);
      expect(res.curve.every((p) => Number.isFinite(p.t) && Number.isFinite(p.R))).toBe(true);
      expect(res.notes.join(" ")).not.toMatch(/NaN|Infinity|undefined|not finite/);
    }
  });
});

describe("k-out-of-n", () => {
  it("matches an exhaustive enumeration of every up/down combination", () => {
    for (const n of [1, 3, 5, 8]) {
      for (let k = 1; k <= n; k++) {
        for (const p of [0.05, 0.5, 0.9, 0.999]) {
          let brute = 0;
          for (let mask = 0; mask < 1 << n; mask++) {
            let up = 0;
            for (let i = 0; i < n; i++) if (mask & (1 << i)) up++;
            if (up >= k) brute += Math.pow(p, up) * Math.pow(1 - p, n - up);
          }
          const res = kOutOfN({ n, k, unitReliability: p });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          expect(res.systemReliability).toBeCloseTo(brute, 12);
        }
      }
    }
  });

  it("collapses to the two arrangements it sits between", () => {
    const p = 0.9;
    const all = kOutOfN({ n: 5, k: 5, unitReliability: p });
    const any = kOutOfN({ n: 5, k: 1, unitReliability: p });
    if (!all.ok || !any.ok) throw new Error("refused");
    expect(all.systemReliability).toBeCloseTo(Math.pow(p, 5), 13);
    expect(any.systemReliability).toBeCloseTo(1 - Math.pow(1 - p, 5), 13);
    // And it says that k = n is not redundancy at all.
    expect(all.notes.join(" ")).toMatch(/SERIES system/);
  });

  it("DOES NOT OVERFLOW THE BINOMIAL at n = 500", () => {
    // C(500, 250) is about 1e149 and the naive factorial is Infinity long
    // before that; the log-gamma form is what keeps this finite.
    const res = kOutOfN({ n: 500, k: 250, unitReliability: 0.6 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Number.isFinite(res.systemReliability)).toBe(true);
    expect(res.systemReliability).toBeGreaterThan(0.9999);
    expect(res.systemReliability).toBeLessThanOrEqual(1);
  });

  it("gives the harmonic-tail mean life", () => {
    const res = kOutOfN({ n: 5, k: 3, unitReliability: 0.9, lambda: 1e-4 });
    if (!res.ok) throw new Error("refused");
    expect(res.mttfFactor).toBeCloseTo(1 / 3 + 1 / 4 + 1 / 5, 15);
    expect(res.mttf).toBeCloseTo((1 / 3 + 1 / 4 + 1 / 5) / 1e-4, 8);
  });

  it("refuses the impossible arrangement rather than answering it", () => {
    expect(kOutOfN({ n: 3, k: 5, unitReliability: 0.9 })).toEqual({
      ok: false,
      error: expect.stringContaining("cannot need more units than you have"),
    });
    expect(kOutOfN({ n: 3, k: 2, unitReliability: 1.2 })).toEqual({
      ok: false,
      error: expect.stringContaining("between 0 and 1"),
    });
    expect(kOutOfN({ n: 3.5, k: 2, unitReliability: 0.9 })).toEqual({
      ok: false,
      error: expect.stringContaining("whole number"),
    });
  });

  it("PRINTS NO RATIO WHERE THE ARITHMETIC RAN OUT", () => {
    // At p = 0.999999999999 the system unreliability underflows to zero and the
    // gain ratio was rendering as "not finitex" inside the note.
    for (const p of [1, 1 - 1e-16, 1 - 1e-12, 0.999999999999, 0, 1e-300, 0.5]) {
      const res = kOutOfN({ n: 5, k: 3, unitReliability: p });
      if (!res.ok) continue;
      expect(res.notes.join(" ")).not.toMatch(/NaN|Infinity|undefined|not finite/);
    }
  });
});

describe("active against standby redundancy", () => {
  it("standby matches the truncated Poisson sum term by term", () => {
    const res = redundancy({ lambda: 1e-3, n: 3, timeH: 500 });
    if (!res.ok) throw new Error("refused");
    const x = 0.5;
    expect(res.standbyR).toBeCloseTo(Math.exp(-x) * (1 + x + (x * x) / 2), 14);
    expect(res.activeR).toBeCloseTo(1 - Math.pow(1 - Math.exp(-x), 3), 14);
  });

  it("mean life grows linearly with spares and harmonically with actives", () => {
    const res = redundancy({ lambda: 1e-3, n: 4, timeH: 500 });
    if (!res.ok) throw new Error("refused");
    expect(res.standbyMttf).toBeCloseTo(4 / 1e-3, 9);
    expect(res.activeMttf).toBeCloseTo((1 + 1 / 2 + 1 / 3 + 1 / 4) / 1e-3, 9);
    expect(res.standbyMttf!).toBeGreaterThan(res.activeMttf!);
  });

  it("NAMES THE TWO ASSUMPTIONS that make standby look better", () => {
    const res = redundancy({ lambda: 1e-4, n: 3, timeH: 1000 });
    if (!res.ok) throw new Error("refused");
    const text = res.notes.join(" ");
    expect(text).toMatch(/not to age/);
    expect(text).toMatch(/switch/);
  });

  it("does not overflow the Poisson terms on a long mission", () => {
    // lambda*t = 800 puts x^i/i! past what a double holds directly; the log
    // form is what keeps this a number instead of NaN.
    const res = redundancy({ lambda: 1, n: 60, timeH: 800 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Number.isFinite(res.standbyR)).toBe(true);
    expect(res.standbyR).toBeGreaterThanOrEqual(0);
    expect(res.standbyR).toBeLessThanOrEqual(1);
  });

  it("with one unit all three schemes agree, and it says so", () => {
    const res = redundancy({ lambda: 1e-3, n: 1, timeH: 500 });
    if (!res.ok) throw new Error("refused");
    expect(res.activeR).toBeCloseTo(res.singleR, 14);
    expect(res.standbyR).toBeCloseTo(res.singleR, 14);
    expect(res.notes.join(" ")).toMatch(/no spare/);
  });

  it("stays finite across extreme rates and missions", () => {
    const cases: [number, number, number][] = [
      [1e-300, 3, 1],
      [1, 200, 1e6],
      [1e-12, 200, 1],
      [0, 1, 0],
      [1e-3, 200, 1e9],
      [0, 3, 500],
    ];
    for (const [lambda, n, timeH] of cases) {
      const res = redundancy({ lambda, n, timeH });
      if (!res.ok) continue;
      for (const v of [res.singleR, res.activeR, res.standbyR]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(res.notes.join(" ")).not.toMatch(/NaN|Infinity|undefined|not finite/);
    }
  });
});

describe("availability", () => {
  it("is MTBF over MTBF plus MTTR, and the downtime follows from it", () => {
    const res = availability({ mtbfH: 2000, mttrH: 8, windowH: 8760, unitsInSeries: 5 });
    if (!res.ok) throw new Error("refused");
    expect(res.availability).toBeCloseTo(2000 / 2008, 15);
    expect(res.downtimeH).toBeCloseTo((8 / 2008) * 8760, 10);
    expect(res.uptimeH + res.downtimeH).toBeCloseTo(8760, 9);
    expect(res.failuresInWindow).toBeCloseTo(8760 / 2008, 10);
    expect(res.systemAvailability).toBeCloseTo(Math.pow(2000 / 2008, 5), 13);
  });

  it("SAYS IT IS THE INHERENT FIGURE, not the operational one", () => {
    const res = availability({ mtbfH: 1000, mttrH: 4, windowH: 8760 });
    if (!res.ok) throw new Error("refused");
    const text = res.notes.join(" ");
    expect(text).toMatch(/INHERENT/);
    expect(text).toMatch(/[Oo]perational availability is always the lower/);
    // And it keeps MTBF and MTTF apart, which is the definition people conflate.
    expect(text).toMatch(/BETWEEN failures/);
  });

  it("a repair of zero hours is called what it is", () => {
    const res = availability({ mtbfH: 1000, mttrH: 0, windowH: 8760 });
    if (!res.ok) throw new Error("refused");
    expect(res.availability).toBe(1);
    expect(res.downtimeH).toBe(0);
    expect(res.notes.join(" ")).toMatch(/by construction/);
    expect(res.notes.join(" ")).not.toMatch(/NaN|Infinity|not finite/);
  });

  it("refuses a zero mean time between failures", () => {
    expect(availability({ mtbfH: 0, mttrH: 5, windowH: 8760 })).toEqual({
      ok: false,
      error: expect.stringContaining("greater than zero"),
    });
    expect(availability({ mtbfH: 100, mttrH: -1, windowH: 8760 })).toEqual({
      ok: false,
      error: expect.stringContaining("zero or more"),
    });
  });

  it("stays finite at the representable extremes", () => {
    const cases: [number, number, number, number][] = [
      [1e-300, 1e-300, 1, 1],
      [1e300, 1e300, 1e300, 10000],
      [1000, 0, 8760, 10000],
      [1e-12, 1e12, 8760, 1],
      [1000, 1e300, 8760, 1],
    ];
    for (const [mtbfH, mttrH, windowH, unitsInSeries] of cases) {
      const res = availability({ mtbfH, mttrH, windowH, unitsInSeries });
      if (!res.ok) continue;
      for (const v of [res.availability, res.downtimeH, res.uptimeH, res.failuresInWindow]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(res.curve.every((c) => Number.isFinite(c.mttr) && Number.isFinite(c.A))).toBe(true);
      expect(res.notes.join(" ")).not.toMatch(/NaN|Infinity|undefined|not finite/);
    }
  });
});

describe("the parsers, which live here so that they can be tested at all", () => {
  it("reads the suspension notations people actually paste", () => {
    // NOT a bare "S" — that is ambiguous with seconds and is refused by name;
    // see the adversarial block below.
    const r = parseLifeData("412 F\n598\n742, 1\n900 +\n1000 susp\n1200 running\n1500 0");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.times).toEqual([412, 598, 742, 900, 1000, 1200, 1500]);
    expect(r.events).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });

  it("REFUSES A STATUS IT DOES NOT UNDERSTAND rather than assuming a failure", () => {
    // Reading a suspension as a failure biases the fitted life short and does
    // it silently, which is exactly the kind of wrong this bench refuses.
    const r = parseLifeData("412 F\n900 maybe");
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/"maybe"/);
    expect(r.error).toMatch(/1 or F for a failure/);
  });

  it("refuses a non-numeric or non-positive time by name", () => {
    expect(parseLifeData("abc")).toEqual({ error: expect.stringContaining('"abc"') });
    expect(parseLifeData("100\n-5")).toEqual({ error: expect.stringContaining("greater than zero") });
    expect(parseLifeData("   ")).toEqual({ error: expect.stringContaining("one unit per line") });
  });

  it("reads a component list with and without commas, with and without a quantity", () => {
    const a = parseComponentList("Pump, 1.2e-4, 2\nControl valve, 5e-5, 3");
    expect("error" in a).toBe(false);
    if ("error" in a) return;
    expect(a).toEqual([
      { name: "Pump", lambda: 1.2e-4, quantity: 2 },
      { name: "Control valve", lambda: 5e-5, quantity: 3 },
    ]);
    const b = parseComponentList("Pump 1.2e-4 2\nSensor 3e-5");
    if ("error" in b) throw new Error(b.error);
    expect(b).toEqual([
      { name: "Pump", lambda: 1.2e-4, quantity: 2 },
      { name: "Sensor", lambda: 3e-5, quantity: 1 },
    ]);
  });

  it("refuses a bad rate or a fractional quantity by name", () => {
    expect(parseComponentList("Pump, banana, 2")).toEqual({ error: expect.stringContaining('"banana"') });
    expect(parseComponentList("Pump, 1e-4, 2.5")).toEqual({ error: expect.stringContaining("whole quantity") });
    expect(parseComponentList("Pump, -1e-4, 2")).toEqual({ error: expect.stringContaining("negative") });
    expect(parseComponentList("Pump")).toEqual({ error: expect.stringContaining("at least a name and a failure rate") });
  });
});

// ---------------------------------------------------------------------------
// What the independent adversarial pass found. Every one of these was reachable
// from an ordinary input and none was visible in a result that looked right.
// ---------------------------------------------------------------------------

describe("the defects the adversarial pass found", () => {
  it("REFUSES THE TWO AMBIGUOUS LETTERS instead of guessing which meaning was meant", () => {
    // "s" is seconds and it is also "suspended"; "d" is days and it is also
    // "dead". Before this, "412 s" was read as 412 HOURS suspended and "412 d"
    // as 412 hours failed - a factor of 3600 and of 24, silently, in the one
    // field of this discipline that does not go through the shared unit layer.
    for (const [line, both] of [["412 s", "seconds"], ["412 d", "days"]] as [string, string][]) {
      const r = parseLifeData(line);
      expect("error" in r).toBe(true);
      if (!("error" in r)) return;
      expect(r.error).toMatch(/ambiguous/);
      expect(r.error).toContain(both);
    }
  });

  it("converts the duration units it says it converts", () => {
    const cases: [string, number][] = [
      ["412 h", 412],
      ["3 day", 72],
      ["3day", 72],
      ["412 sec", 412 / 3600],
      ["30 min", 0.5],
      ["412", 412],
    ];
    for (const [line, hours] of cases) {
      const r = parseLifeData(line);
      expect({ line, ok: !("error" in r) }).toEqual({ line, ok: true });
      if ("error" in r) continue;
      expect(r.times[0]).toBeCloseTo(hours, 9);
    }
  });

  it("refuses a life Number() would have accepted", () => {
    // Number("0x10") is 16 and Number("Infinity") is Infinity. Neither is a life.
    expect(parseLifeData("0x10 F")).toEqual({ error: expect.stringContaining("not a number of hours") });
    expect(parseLifeData("Infinity")).toEqual({ error: expect.stringContaining("not a number of hours") });
    expect(parseComponentList("Pump, 0x10, 2")).toEqual({ error: expect.stringContaining("not a failure rate") });
  });

  it("refuses a thousands separator rather than splitting on it", () => {
    // "Motor, 1,200, 2" became a component called "Motor 1" failing 200 times
    // an hour. Both readings are possible from the text, so it refuses.
    const r = parseComponentList("Motor, 1,200, 2");
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/comma-separated fields/);
    expect(r.error).toMatch(/1,200 must be written 1200/);
  });

  it("reads a part number in the name, and does not blame the rate for it", () => {
    const r = parseComponentList("Bearing 6205 1.5e-5");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r).toEqual([{ name: "Bearing 6205", lambda: 1.5e-5, quantity: 1 }]);
  });

  it("GIVES THE RIGHT REASON for a missing parallel mean life", () => {
    // A never-failing branch AND more than twelve units was told its mean life
    // was unreportable because "the alternating sum loses accuracy" - three
    // lines under a reliability of 100.0000 %. Both halves false together.
    const res = reliabilityBlock({
      components: [{ name: "a", lambda: 0, quantity: 1 }, { name: "b", lambda: 2e-4, quantity: 20 }],
      configuration: "parallel",
      timeH: 8760,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reliability).toBe(1);
    expect(res.mttf).toBeNull();
    const text = res.notes.join(" ");
    expect(text).toMatch(/never fail/);
    expect(text).not.toMatch(/alternating sum/);
  });

  it("THE SHORT-MISSION NOTE DOES NOT PRINT ZERO for the numbers it is comparing", () => {
    // 1 - R is exactly 0 once R rounds to 1, so the sentence that says "compare
    // the FAILURE probabilities, that is where the difference lives" was
    // printing "0 active, 0 standby". The true values are around 1e-30, which a
    // double holds perfectly well; only the subtraction destroyed them.
    for (const [lambda, n, timeH] of [[1e-7, 10, 10000], [1e-6, 6, 1000], [1e-9, 20, 1e6]] as [number, number, number][]) {
      const res = redundancy({ lambda, n, timeH });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      const note = res.notes.find((s) => s.includes("FAILURE probabilities"));
      expect({ lambda, hasNote: note !== undefined }).toEqual({ lambda, hasNote: true });
      // The three probabilities the sentence points at, read back out of it.
      // None of them may be zero — a bare "0" is exactly the defect.
      const quoted = [...note!.matchAll(/([\d.e+-]+) (single|active|standby)/g)].map((m) => Number(m[1]));
      expect({ lambda, count: quoted.length }).toEqual({ lambda, count: 3 });
      for (const v of quoted) expect(v).toBeGreaterThan(0);
      // And each is smaller than the last: one unit, then n active, then n cold.
      expect(quoted[1]).toBeLessThan(quoted[0]);
      expect(quoted[2]).toBeLessThan(quoted[1]);
    }
    // And the tail sum agrees with the direct subtraction where the direct one
    // still works, so the new path is not merely non-zero but right.
    const mid = redundancy({ lambda: 1e-3, n: 3, timeH: 500 });
    if (!mid.ok) throw new Error("refused");
    const x = 0.5;
    expect(1 - mid.standbyR).toBeCloseTo(1 - Math.exp(-x) * (1 + x + (x * x) / 2), 14);
  });

  it("the redundancy figure reaches the n the user asked about", () => {
    // The sweep was capped at 20 while n may be 200, so a 200-unit answer was
    // reported in the text and left off the figure whose caption claims to show
    // mean life against the number of units.
    for (const n of [3, 8, 60, 200]) {
      const res = redundancy({ lambda: 1e-4, n, timeH: 5000 });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.activeSweep[res.activeSweep.length - 1].n).toBeGreaterThanOrEqual(n);
      expect(res.standbySweep[res.standbySweep.length - 1].n).toBeGreaterThanOrEqual(n);
    }
  });

  it("COMPARES AGAINST THE PART THAT TESTS THE CLAIM, not the easy one", () => {
    // In series the point is that the system is worse than its WORST part. In
    // parallel the point is that it outlives EVERY part, and only the BEST part
    // demonstrates that; drawing the worst there proves the easy half.
    const components = [
      { name: "weak", lambda: 1e-3, quantity: 1 },
      { name: "strong", lambda: 1e-6, quantity: 1 },
    ];
    const ser = reliabilityBlock({ components, configuration: "series", timeH: 1000 });
    const par = reliabilityBlock({ components, configuration: "parallel", timeH: 1000 });
    expect(ser.ok && par.ok).toBe(true);
    if (!ser.ok || !par.ok) return;
    expect(ser.unitCurveLabel).toBe("worst single unit");
    expect(par.unitCurveLabel).toBe("best single unit");
    const end = (r: typeof ser): [number, number] => [
      r.curve[r.curve.length - 1].R,
      r.unitCurve[r.unitCurve.length - 1].R,
    ];
    const [sSys, sUnit] = end(ser);
    const [pSys, pUnit] = end(par);
    expect(sSys).toBeLessThan(sUnit); // series: below the worst part
    expect(pSys).toBeGreaterThan(pUnit); // parallel: above the best part
  });
});
