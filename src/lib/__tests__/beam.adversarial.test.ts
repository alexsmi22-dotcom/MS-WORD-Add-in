// Adversarial pass on the beam engine — the separate half required before
// anything ships, and deliberately NOT written from the same cases as
// beam.test.ts.
//
// beam.test.ts checks the answers I already knew. This file checks PROPERTIES
// that must hold for every beam, on inputs chosen to be awkward: loads landing
// exactly on supports, zero-magnitude loads, overhangs, loads at the very ends,
// supports in the interior, extreme magnitudes, and a few hundred random beams.
//
// The strongest checks here do not reuse the solver's own reasoning:
//   - EQUILIBRIUM is recomputed from the reactions and the applied loads by
//     hand, in exact rationals, and must be exactly zero — not nearly zero.
//   - SUPERPOSITION: linear elasticity means the response to A+B is the sum of
//     the responses. The solver never assumes this, so it is a real check on it.
//   - V = dM/dx by central difference against the independently returned shear.
//   - Boundary conditions are re-checked on the returned deflection function.
//
// Time is asserted as well as value: in a task pane a solver that does not
// return is a frozen Word, not an error message.

import { analyzeBeam, BeamInput, BeamResult, Load, Support } from "../beam";
import { Rat, ratInt, ratDiv, ratAdd, ratMul, ratSub, ratIsZero, ratToNumber } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

function ok(input: BeamInput): BeamResult {
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

/** Deterministic PRNG — a failing seed must be reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Independent equilibrium, in exact arithmetic
// ---------------------------------------------------------------------------

/** Σ(upward reactions) − Σ(downward loads), computed WITHOUT the solver's terms. */
function residualForce(r: BeamResult, loads: Load[]): Rat {
  let sum = R(0);
  for (const re of r.reactions) sum = ratAdd(sum, re.forceExact);
  for (const l of loads) {
    if (l.kind === "point") sum = ratSub(sum, l.p);
    else if (l.kind === "udl") sum = ratSub(sum, ratMul(l.w, ratSub(l.b, l.a)));
    else if (l.kind === "ramp")
      sum = ratSub(sum, ratMul(ratDiv(ratAdd(l.w1, l.w2), R(2)), ratSub(l.b, l.a)));
  }
  return sum;
}

/** Moment of everything about x = 0. Counterclockwise positive, matching the engine. */
function residualMoment(r: BeamResult, supports: Support[], loads: Load[]): Rat {
  let sum = R(0);
  // The COUPLE is what belongs in a free-body moment sum, not the internal
  // bending moment — see the note on ReactionResult. Using `momentExact` here
  // is what surfaced the reporting bug in the first place.
  r.reactions.forEach((re, i) => {
    sum = ratAdd(sum, ratMul(re.forceExact, supports[i].x));
    if (re.coupleExact) sum = ratAdd(sum, re.coupleExact);
  });
  for (const l of loads) {
    if (l.kind === "point") sum = ratSub(sum, ratMul(l.p, l.x));
    else if (l.kind === "udl") {
      const W = ratMul(l.w, ratSub(l.b, l.a));
      const xc = ratDiv(ratAdd(l.a, l.b), R(2));
      sum = ratSub(sum, ratMul(W, xc));
    } else if (l.kind === "ramp") {
      // Split the trapezoid into a uniform block and a triangle, each with its
      // own centroid — derived here rather than taken from the engine.
      const d = ratSub(l.b, l.a);
      const Wu = ratMul(l.w1, d);
      const xu = ratDiv(ratAdd(l.a, l.b), R(2));
      sum = ratSub(sum, ratMul(Wu, xu));
      const Wt = ratDiv(ratMul(ratSub(l.w2, l.w1), d), R(2));
      const xt = ratAdd(l.a, ratMul(ratDiv(R(2), R(3)), d));
      sum = ratSub(sum, ratMul(Wt, xt));
    } else if (l.kind === "moment") {
      // Counterclockwise positive, so it ADDS to a counterclockwise moment sum.
      sum = ratAdd(sum, l.m);
    }
  }
  return sum;
}

function expectEquilibrium(r: BeamResult, supports: Support[], loads: Load[], label: string): void {
  const f = residualForce(r, loads);
  const m = residualMoment(r, supports, loads);
  expect(`${label} ΣF = ${f.n}/${f.d}`).toBe(`${label} ΣF = 0/1`);
  expect(`${label} ΣM = ${m.n}/${m.d}`).toBe(`${label} ΣM = 0/1`);
}

// ---------------------------------------------------------------------------

describe("equilibrium holds exactly on awkward inputs", () => {
  const beams: [string, BeamInput][] = [
    [
      "load exactly on a support",
      {
        length: R(6),
        supports: [
          { kind: "pin", x: R(0) },
          { kind: "roller", x: R(6) },
        ],
        loads: [{ kind: "point", x: R(0), p: R(50) }],
      },
    ],
    [
      "overhang both ends",
      {
        length: R(10),
        supports: [
          { kind: "pin", x: R(2) },
          { kind: "roller", x: R(7) },
        ],
        loads: [
          { kind: "point", x: R(0), p: R(20) },
          { kind: "point", x: R(10), p: R(35) },
          { kind: "udl", a: R(2), b: R(7), w: R(4) },
        ],
      },
    ],
    [
      "zero-magnitude load changes nothing but must not divide by zero",
      {
        length: R(5),
        supports: [
          { kind: "pin", x: R(0) },
          { kind: "roller", x: R(5) },
        ],
        loads: [
          { kind: "udl", a: R(1), b: R(3), w: R(0) },
          { kind: "ramp", a: R(0), b: R(5), w1: R(0), w2: R(0) },
          { kind: "point", x: R(2), p: R(11) },
        ],
      },
    ],
    [
      "three supports — indeterminate to degree 1",
      {
        length: R(12),
        supports: [
          { kind: "pin", x: R(0) },
          { kind: "roller", x: R(6) },
          { kind: "roller", x: R(12) },
        ],
        loads: [{ kind: "udl", a: R(0), b: R(12), w: R(7) }],
      },
    ],
    [
      "fixed both ends with an applied couple",
      {
        length: R(8),
        supports: [
          { kind: "fixed", x: R(0) },
          { kind: "fixed", x: R(8) },
        ],
        loads: [
          { kind: "moment", x: R(3), m: R(90) },
          { kind: "point", x: R(5), p: R(25) },
        ],
      },
    ],
    [
      "trapezoid that does not start at the end",
      {
        length: R(9),
        supports: [
          { kind: "pin", x: R(1) },
          { kind: "roller", x: R(8) },
        ],
        loads: [{ kind: "ramp", a: R(2), b: R(7), w1: R(3), w2: R(11) }],
      },
    ],
    [
      "fixed at the RIGHT end, cantilever pointing left",
      {
        length: R(4),
        supports: [{ kind: "fixed", x: R(4) }],
        loads: [{ kind: "udl", a: R(0), b: R(4), w: R(6) }],
      },
    ],
  ];

  for (const [name, input] of beams) {
    test(name, () => {
      const r = ok(input);
      expectEquilibrium(r, input.supports, input.loads, name);
    });
  }
});

describe("superposition — the property the solver never assumes", () => {
  const supports: Support[] = [
    { kind: "fixed", x: R(0) },
    { kind: "roller", x: R(10) },
  ];
  const A: Load[] = [{ kind: "point", x: R(3), p: R(40) }];
  const B: Load[] = [{ kind: "udl", a: R(4), b: R(10), w: R(9) }];

  test("reactions, shear, moment and deflection all add", () => {
    const ra = ok({ length: R(10), supports, loads: A });
    const rb = ok({ length: R(10), supports, loads: B });
    const rab = ok({ length: R(10), supports, loads: [...A, ...B] });

    // Reactions add EXACTLY — these are rationals, not floats.
    for (let i = 0; i < supports.length; i++) {
      const sum = ratAdd(ra.reactions[i].forceExact, rb.reactions[i].forceExact);
      expect(ratIsZero(ratSub(sum, rab.reactions[i].forceExact))).toBe(true);
    }
    for (let x = 0; x <= 10; x += 0.25) {
      expect(ra.momentAt(x) + rb.momentAt(x)).toBeCloseTo(rab.momentAt(x), 8);
      expect(ra.shearAt(x) + rb.shearAt(x)).toBeCloseTo(rab.shearAt(x), 8);
      expect(ra.eiDeflectionAt(x) + rb.eiDeflectionAt(x)).toBeCloseTo(rab.eiDeflectionAt(x), 6);
    }
  });

  test("scaling every load by k scales every result by k", () => {
    const k = 7;
    const base = ok({ length: R(10), supports, loads: [...A, ...B] });
    const scaled = ok({
      length: R(10),
      supports,
      loads: [
        { kind: "point", x: R(3), p: R(40 * k) },
        { kind: "udl", a: R(4), b: R(10), w: R(9 * k) },
      ],
    });
    for (let i = 0; i < supports.length; i++) {
      const want = ratMul(base.reactions[i].forceExact, R(k));
      expect(ratIsZero(ratSub(want, scaled.reactions[i].forceExact))).toBe(true);
    }
    for (let x = 0; x <= 10; x += 0.5) expect(k * base.momentAt(x)).toBeCloseTo(scaled.momentAt(x), 6);
  });
});

describe("V = dM/dx", () => {
  test("central differences of the moment reproduce the shear away from breakpoints", () => {
    const input: BeamInput = {
      length: R(10),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(10) },
      ],
      loads: [
        { kind: "udl", a: R(0), b: R(6), w: R(5) },
        { kind: "point", x: R(7), p: R(30) },
        { kind: "ramp", a: R(6), b: R(10), w1: R(2), w2: R(8) },
      ],
    };
    const r = ok(input);
    const h = 1e-5;
    let checked = 0;
    for (let x = 0.2; x < 9.8; x += 0.13) {
      // Skip the neighbourhood of a discontinuity, where dM/dx is genuinely undefined.
      if (r.breakpoints.some((b) => Math.abs(b - x) < 0.01)) continue;
      const dM = (r.momentAt(x + h) - r.momentAt(x - h)) / (2 * h);
      expect(Math.abs(dM - r.shearAt(x))).toBeLessThan(1e-4 * Math.max(1, Math.abs(r.shearAt(x))));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("boundary conditions are actually satisfied by the returned functions", () => {
  test("deflection vanishes at every support and slope vanishes at fixed ones", () => {
    const input: BeamInput = {
      length: R(14),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(6) },
        { kind: "roller", x: R(14) },
      ],
      loads: [
        { kind: "udl", a: R(0), b: R(14), w: R(3) },
        { kind: "point", x: R(9), p: R(45) },
      ],
    };
    const r = ok(input);
    const scale = Math.max(Math.abs(r.maxEiDeflection.value), 1);
    input.supports.forEach((s) => {
      const x = ratToNumber(s.x);
      expect(Math.abs(r.eiDeflectionAt(x)) / scale).toBeLessThan(1e-9);
      if (s.kind === "fixed") expect(Math.abs(r.eiSlopeAt(x)) / scale).toBeLessThan(1e-9);
    });
  });

  test("a simply supported end carries no moment", () => {
    const r = ok({
      length: R(7),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(7) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(7), w: R(4) }],
    });
    expect(Math.abs(r.momentAt(0))).toBeLessThan(1e-9);
    expect(Math.abs(r.momentAt(7))).toBeLessThan(1e-9);
  });
});

describe("random beams", () => {
  test("300 random beams satisfy equilibrium exactly and return promptly", () => {
    const rand = rng(20260727);
    // ENGINE TIME ONLY, not wall-clock across the loop. The budget below is
    // meant to catch a performance regression in analyzeBeam, but the loop also
    // runs several thousand Jest expect() calls, which cost far more than the
    // solves do — so the original measurement was dominated by the harness and
    // flaked under parallel load without anything having got slower. Timing
    // just the engine measures the thing the test is actually about.
    //
    // IT STILL DOES NOT ISOLATE THE ENGINE, and the budget is set accordingly.
    // A Date.now() delta around the call counts every millisecond the thread
    // spent DESCHEDULED, so under a full parallel run this figure rises with the
    // number of other suites rather than with anything analyzeBeam does. That
    // was demonstrated rather than assumed: the same 300 beams were timed on
    // this engine and on the previous one, three runs each, at ~4.9 s and ~5.2 s
    // — indistinguishable — while the full-suite run of the SAME code both
    // failed and passed on consecutive attempts. So this is a HANG DETECTOR with
    // a wide margin, not a performance gate; a real regression in a rational
    // Gauss-Jordan solve is orders of magnitude, not a factor of two. Tightening
    // it back down buys nothing and returns an intermittent red build.
    let engineMs = 0;
    let solved = 0;
    for (let iter = 0; iter < 300; iter++) {
      const L = 1 + Math.floor(rand() * 20);
      // Support layouts that are always stable, so a refusal here would be a bug.
      const layout = Math.floor(rand() * 4);
      let supports: Support[];
      if (layout === 0) supports = [{ kind: "fixed", x: R(0) }];
      else if (layout === 1)
        supports = [
          { kind: "pin", x: R(0) },
          { kind: "roller", x: R(L) },
        ];
      else if (layout === 2)
        supports = [
          { kind: "fixed", x: R(0) },
          { kind: "roller", x: R(L) },
        ];
      else
        supports = [
          { kind: "fixed", x: R(0) },
          { kind: "fixed", x: R(L) },
        ];

      const loads: Load[] = [];
      const n = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const pick = Math.floor(rand() * 4);
        if (pick === 0) loads.push({ kind: "point", x: R(Math.floor(rand() * (L + 1))), p: R(1 + Math.floor(rand() * 99)) });
        else if (pick === 1) {
          const a = Math.floor(rand() * L);
          const b = a + 1 + Math.floor(rand() * (L - a));
          loads.push({ kind: "udl", a: R(a), b: R(b), w: R(1 + Math.floor(rand() * 20)) });
        } else if (pick === 2) {
          const a = Math.floor(rand() * L);
          const b = a + 1 + Math.floor(rand() * (L - a));
          loads.push({ kind: "ramp", a: R(a), b: R(b), w1: R(Math.floor(rand() * 10)), w2: R(Math.floor(rand() * 20)) });
        } else loads.push({ kind: "moment", x: R(Math.floor(rand() * (L + 1))), m: R(1 + Math.floor(rand() * 60)) });
      }

      const input: BeamInput = { length: R(L), supports, loads };
      const t0 = Date.now();
      const r = analyzeBeam(input);
      engineMs += Date.now() - t0;
      if (!r.ok) throw new Error(`stable layout refused at iter ${iter}: ${r.error}`);
      expectEquilibrium(r, supports, loads, `iter ${iter}`);
      // Deflection must still vanish at the supports on a random beam.
      const scale = Math.max(Math.abs(r.maxEiDeflection.value), 1);
      for (const s of supports) expect(Math.abs(r.eiDeflectionAt(ratToNumber(s.x))) / scale).toBeLessThan(1e-7);
      solved++;
    }
    expect(solved).toBe(300);
    expect(engineMs).toBeLessThan(60000);
  });
});

describe("does not hang or blow up", () => {
  test("the maximum number of loads still solves quickly", () => {
    const loads: Load[] = [];
    for (let i = 0; i < 60; i++) loads.push({ kind: "point", x: R(i, 3), p: R(10) });
    const started = Date.now();
    const r = ok({
      length: R(20),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(20) },
      ],
      loads,
    });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(r.reactions[0].force + r.reactions[1].force).toBeCloseTo(600, 6);
  });

  test("too many loads or supports is refused rather than attempted", () => {
    const loads: Load[] = [];
    for (let i = 0; i < 200; i++) loads.push({ kind: "point", x: R(1), p: R(1) });
    const r = analyzeBeam({
      length: R(4),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(4) },
      ],
      loads,
    });
    expect(r.ok).toBe(false);
  });

  test("extreme magnitudes stay finite", () => {
    const r = ok({
      length: R(1000),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(1000) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(1000), w: R(1000000) }],
    });
    expect(Number.isFinite(r.maxMoment.value)).toBe(true);
    expect(Number.isFinite(r.maxEiDeflection.value)).toBe(true);
    expect(r.maxMoment.value).toBeCloseTo((1e6 * 1000 ** 2) / 8, -3);
  });

  test("a beam with no loads at all is a valid, boring answer", () => {
    const r = ok({
      length: R(5),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(5) },
      ],
      loads: [],
    });
    expect(r.reactions.every((x) => Math.abs(x.force) < 1e-12)).toBe(true);
    expect(Math.abs(r.maxMoment.value)).toBeLessThan(1e-12);
  });
});

describe("mirror symmetry", () => {
  test("reflecting a beam reflects its reactions", () => {
    const L = 12;
    const fwd = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "point", x: R(4), p: R(60) }],
    });
    const rev = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "point", x: R(L - 4), p: R(60) }],
    });
    expect(ratIsZero(ratSub(fwd.reactions[0].forceExact, rev.reactions[1].forceExact))).toBe(true);
    expect(ratIsZero(ratSub(fwd.reactions[1].forceExact, rev.reactions[0].forceExact))).toBe(true);
    expect(fwd.maxMoment.value).toBeCloseTo(rev.maxMoment.value, 9);
    expect(fwd.maxMoment.x).toBeCloseTo(L - rev.maxMoment.x, 9);
  });
});
