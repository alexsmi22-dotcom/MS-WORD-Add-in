// ADVERSARIAL pass over elastic and displaced beam supports.
//
// The oracle suite in beamElastic.test.ts checks the cases I designed the code
// for. This file tries to BREAK it, because the one time this repo shipped an
// unsound result it was behind a full set of green oracle tests: the tests
// agreed with the author about which cases mattered.
//
// The attacks here are structural invariants rather than more closed forms.
// Every one of them must hold for EVERY beam, so a beam I never thought of
// still gets checked:
//
//   - EQUILIBRIUM. Sum of reactions equals total applied load, always. A term
//     leaked into the wrong row would still solve and would still look right.
//   - SUPERPOSITION. The system is linear, so the response to (load AND
//     settlement) must equal (load alone) + (settlement alone), exactly. This
//     is the check that catches a settlement term that is scaled wrongly,
//     because a wrong scale is invisible in any single case.
//   - THE SPRING'S OWN CONSTITUTIVE LAW. R = k * (downward movement of the
//     support). The solve never asserts this directly — it falls out — so it is
//     a genuine cross-check on the EI/k coefficient.
//   - RIGID-BODY MOTION. Settling every support of a determinate beam by the
//     same amount just lowers it. Nothing else may change.
//
// Plus the things that make a task pane freeze or lie: huge rationals, absurd
// stiffness ratios, and structures whose new option pushes them into a case the
// old code guarded.

import { analyzeBeam, parseSupports, BeamInput, BeamResult, Support, Load } from "../beam";
import { Rat, ratInt, ratDiv, ratToNumber, ratAdd, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const X = (s: string): Rat => {
  const q = parseRatLiteral(s);
  if (!q) throw new Error(`bad literal ${s}`);
  return q;
};

function ok(input: BeamInput): BeamResult {
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

const near = (a: number, b: number, tol = 1e-7) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

/** Total downward applied load. */
function appliedLoad(loads: Load[]): number {
  let t = 0;
  for (const l of loads) {
    if (l.kind === "point") t += ratToNumber(l.p);
    else if (l.kind === "udl") t += ratToNumber(l.w) * (ratToNumber(l.b) - ratToNumber(l.a));
    else if (l.kind === "ramp")
      t += ((ratToNumber(l.w1) + ratToNumber(l.w2)) / 2) * (ratToNumber(l.b) - ratToNumber(l.a));
  }
  return t;
}

// ---------------------------------------------------------------------------
// Equilibrium must survive every new option
// ---------------------------------------------------------------------------

describe("equilibrium is never broken by a spring or a settlement", () => {
  const LOADS: Load[] = [
    { kind: "udl", a: R(0), b: R(6), w: R(4) },
    { kind: "point", x: R(7), p: R(25) },
    { kind: "ramp", a: R(2), b: R(5), w1: R(0), w2: R(9) },
    { kind: "moment", x: R(3), m: R(40) },
  ];

  const CASES: { name: string; supports: Support[] }[] = [
    { name: "simply supported, spring at one end", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k: X("5e4") }] },
    { name: "simply supported, both on springs", supports: [{ kind: "pin", x: R(0), k: X("3e4") }, { kind: "roller", x: R(8), k: X("5e4") }] },
    { name: "simply supported, both settled differently", supports: [{ kind: "pin", x: R(0), settle: X("0.004") }, { kind: "roller", x: R(8), settle: X("0.011") }] },
    { name: "propped cantilever, settling prop", supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.01") }] },
    { name: "propped cantilever, spring prop", supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X("2e4") }] },
    { name: "fixed-fixed, one end settles", supports: [{ kind: "fixed", x: R(0) }, { kind: "fixed", x: R(8), settle: X("0.006") }] },
    { name: "three supports, mixed springs and settlement", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(4), k: X("1e4"), settle: X("0.003") }, { kind: "roller", x: R(8), settle: X("-0.002") }] },
    { name: "cantilever on a vertical spring", supports: [{ kind: "fixed", x: R(0), k: X("8e4") }] },
    { name: "spring under a fixed end plus a settling prop", supports: [{ kind: "fixed", x: R(0), k: X("9e4") }, { kind: "roller", x: R(8), settle: X("0.005") }] },
  ];

  test.each(CASES)("$name — reactions sum to the applied load", ({ supports }) => {
    const r = ok({ length: R(8), supports, loads: LOADS, ei: X("2.4e5") });
    const sum = r.reactions.reduce((s, re) => s + re.force, 0);
    near(sum, appliedLoad(LOADS), 1e-7);
  });

  test.each(CASES)("$name — shear and moment both vanish past the right-hand end", ({ supports }) => {
    const r = ok({ length: R(8), supports, loads: LOADS, ei: X("2.4e5") });
    // Sampling just inside the end; every load and reaction is behind us there.
    expect(Math.abs(r.shearAt(8))).toBeLessThan(1e-6);
    expect(Math.abs(r.momentAt(8))).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Superposition — the attack on a wrongly-scaled settlement term
// ---------------------------------------------------------------------------

describe("linearity: load and settlement superpose exactly", () => {
  const EI = X("2.4e5");
  const loads: Load[] = [
    { kind: "udl", a: R(0), b: R(8), w: R(5) },
    { kind: "point", x: R(3), p: R(40) },
  ];
  const settle = X("0.009");

  const both = ok({
    length: R(8),
    supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle }],
    loads,
    ei: EI,
  });
  const loadOnly = ok({
    length: R(8),
    supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8) }],
    loads,
  });
  const settleOnly = ok({
    length: R(8),
    supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle }],
    loads: [],
    ei: EI,
  });

  test("reactions superpose EXACTLY, as rationals", () => {
    for (let i = 0; i < 2; i++) {
      const sum = ratAdd(loadOnly.reactions[i].forceExact, settleOnly.reactions[i].forceExact);
      expect(`R${i} = ${both.reactions[i].forceExact.n}/${both.reactions[i].forceExact.d}`).toBe(
        `R${i} = ${sum.n}/${sum.d}`,
      );
    }
  });

  test("the fixed-end moment superposes too", () => {
    near((both.reactions[0].moment as number), (loadOnly.reactions[0].moment as number) + (settleOnly.reactions[0].moment as number), 1e-9);
  });

  test("doubling the settlement doubles the settlement-induced part", () => {
    const twice = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.018") }],
      loads: [],
      ei: EI,
    });
    near(ratToNumber(twice.reactions[1].forceExact), 2 * ratToNumber(settleOnly.reactions[1].forceExact), 1e-12);
  });

  test("a settlement of the OPPOSITE sign reverses the induced reactions", () => {
    const up = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X("-0.009") }],
      loads: [],
      ei: EI,
    });
    near(ratToNumber(up.reactions[1].forceExact), -ratToNumber(settleOnly.reactions[1].forceExact), 1e-12);
  });
});

// ---------------------------------------------------------------------------
// The spring's own law, never asserted by the solve
// ---------------------------------------------------------------------------

describe("every spring obeys R = k * its own compression", () => {
  const EI = 2.4e5;
  const cases: { k: string; supports: (k: Rat) => Support[]; at: number; idx: number }[] = [
    { k: "1e3", supports: (k) => [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k }], at: 8, idx: 1 },
    { k: "5e4", supports: (k) => [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k }], at: 8, idx: 1 },
    { k: "2e2", supports: (k) => [{ kind: "pin", x: R(0), k }, { kind: "roller", x: R(8) }], at: 0, idx: 0 },
    { k: "7e5", supports: (k) => [{ kind: "fixed", x: R(0) }, { kind: "fixed", x: R(8), k }], at: 8, idx: 1 },
  ];

  test.each(cases)("k = $k", ({ k, supports, at, idx }) => {
    const r = ok({
      length: R(8),
      supports: supports(X(k)),
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }, { kind: "point", x: R(5), p: R(30) }],
      ei: X("2.4e5"),
    });
    const v = r.eiDeflectionAt(at) / EI; // positive up
    near(r.reactions[idx].force, Number(k) * -v, 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Rigid-body motion
// ---------------------------------------------------------------------------

describe("settling a determinate beam uniformly just lowers it", () => {
  const EI = X("2.4e5");
  const loads: Load[] = [{ kind: "udl", a: R(0), b: R(8), w: R(5) }, { kind: "point", x: R(6), p: R(30) }];
  const d = X("0.02");

  const flat = ok({
    length: R(8),
    supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }],
    loads,
  });
  const sunk = ok({
    length: R(8),
    supports: [{ kind: "pin", x: R(0), settle: d }, { kind: "roller", x: R(8), settle: d }],
    loads,
    ei: EI,
  });

  test("no reaction changes", () => {
    for (let i = 0; i < 2; i++)
      expect(`R${i} = ${sunk.reactions[i].forceExact.n}/${sunk.reactions[i].forceExact.d}`).toBe(
        `R${i} = ${flat.reactions[i].forceExact.n}/${flat.reactions[i].forceExact.d}`,
      );
  });

  test("no bending moment changes anywhere", () => {
    for (const x of [0, 1, 2.5, 4, 6, 7.5, 8]) near(sunk.momentAt(x), flat.momentAt(x), 1e-7);
  });

  test("but every point moved down by exactly the settlement", () => {
    const ei = ratToNumber(EI);
    for (const x of [0, 2, 4, 6, 8])
      near(sunk.eiDeflectionAt(x) / ei - flat.eiDeflectionAt(x) / ei, -0.02, 1e-7);
  });
});

// ---------------------------------------------------------------------------
// Things that make a pane freeze or lie
// ---------------------------------------------------------------------------

describe("pathological magnitudes stay fast and finite", () => {
  // A frozen task pane is not an error message. Every one of these must return.
  const run = (k: string, ei: string, settle: string) =>
    analyzeBeam({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X(k), settle: X(settle) }],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X(ei),
    });

  test.each([
    ["1e-12", "2.1e11", "0.0001"],
    ["1e18", "2.1e11", "0.0001"],
    ["5.7e7", "2.1e11", "0.012345678"],
    ["1", "1e-9", "1e-9"],
    ["123456789", "987654321", "0.000000001"],
  ])("k=%s EI=%s settle=%s returns finite numbers quickly", (k, ei, settle) => {
    const started = Date.now();
    const r = run(k, ei, settle);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const re of r.reactions) expect(Number.isFinite(re.force)).toBe(true);
      expect(Number.isFinite(r.maxMoment.value)).toBe(true);
      expect(Number.isFinite(r.maxEiDeflection.value)).toBe(true);
    }
  });

  test("a realistic steel beam on a realistic soil spring is sane", () => {
    // 254x146 UB, E = 210 GPa, I = 6.26e-5 m^4 -> EI = 1.31e7 N.m^2.
    // Soil spring 5e7 N/m. 10 kN/m over 8 m.
    const r = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X("5e7") }],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: X("10000") }],
      ei: X("1.31e7"),
    });
    const total = 80000;
    near(r.reactions[0].force + r.reactions[1].force, total, 1e-7);
    // A stiff soil spring against a soft beam behaves close to a rigid prop
    // (3wL/8 = 30 kN), and must at least sit between the two limits.
    expect(r.reactions[1].force).toBeGreaterThan(0);
    expect(r.reactions[1].force).toBeLessThan(0.375 * total + 1);
  });
});

describe("the new options cannot smuggle a beam past an old guard", () => {
  test("a single roller on a spring is still a mechanism", () => {
    const r = analyzeBeam({
      length: R(8),
      supports: [{ kind: "roller", x: R(4), k: X("1e4") }],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mechanism/i);
  });

  test("two supports at the same position are still refused, options or not", () => {
    const r = analyzeBeam({
      length: R(8),
      supports: [{ kind: "pin", x: R(4) }, { kind: "roller", x: R(4), settle: X("0.01") }],
      loads: [],
      ei: X("2.4e5"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/same position/i);
  });

  test("a support off the beam is still refused", () => {
    const r = analyzeBeam({
      length: R(8),
      supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(99), k: X("1e4") }],
      loads: [],
      ei: X("2.4e5"),
    });
    expect(r.ok).toBe(false);
  });

  test("a determinate beam with a spring still reports itself determinate", () => {
    const r = ok({
      length: R(8),
      supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k: X("1e4") }],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    expect(r.determinacy.degree).toBe(0);
    expect(r.determinacy.note).toMatch(/change no reaction/i);
  });

  test("the EI-free claim is never made for an EI-coupled beam", () => {
    const r = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X("1e4") }],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    const all = [r.determinacy.note, ...r.warnings].join(" ");
    expect(all).not.toMatch(/supports being RIGID/);
    expect(all).toMatch(/NOT EI-free/i);
  });
});

// ---------------------------------------------------------------------------
// Parser attacks
// ---------------------------------------------------------------------------

describe("the option parser cannot be tricked", () => {
  test("an option with no value is not silently accepted", () => {
    const p = parseSupports("roller 8 k=");
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.supports).toHaveLength(0);
  });

  test("a bare number after the position is not read as an option", () => {
    const p = parseSupports("roller 8 5000");
    expect(p.errors.length).toBeGreaterThan(0);
  });

  test("a missing position is refused even when an option is present", () => {
    const p = parseSupports("roller k=5000");
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.supports).toHaveLength(0);
  });

  test("case and spacing around = do not matter", () => {
    const p = parseSupports("ROLLER 8 K = 5000, PIN 0 Settle = 0.01");
    expect(p.errors).toEqual([]);
    expect(ratToNumber(p.supports[0].k as Rat)).toBe(5000);
    expect(ratToNumber(p.supports[1].settle as Rat)).toBe(0.01);
  });

  test("an option on one support does not leak onto the next", () => {
    const p = parseSupports("pin 0 k=1000, roller 8");
    expect(p.errors).toEqual([]);
    expect(p.supports[0].k).toBeTruthy();
    expect(p.supports[1].k ?? null).toBeNull();
  });

  test("a repeated option takes the last value rather than both", () => {
    const p = parseSupports("roller 8 k=1000 k=2000");
    expect(p.errors).toEqual([]);
    expect(ratToNumber(p.supports[0].k as Rat)).toBe(2000);
  });

  test("plain beams still parse identically to before the change", () => {
    const p = parseSupports("fixed 0, roller 8, pin 4");
    expect(p.errors).toEqual([]);
    expect(p.supports.map((s) => s.kind)).toEqual(["fixed", "roller", "pin"]);
    expect(p.supports.map((s) => ratToNumber(s.x))).toEqual([0, 8, 4]);
  });

  test("garbage is still refused rather than partially accepted", () => {
    for (const bad of ["wobble 8", "roller", "roller eight", "8 roller", ""]) {
      const p = parseSupports(bad);
      if (bad === "") expect(p.supports).toHaveLength(0);
      else expect(p.errors.length + (p.supports.length ? 0 : 1)).toBeGreaterThan(0);
    }
  });
});
