// Oracle tests for ELASTIC AND DISPLACED SUPPORTS on the beam engine.
//
// Every closed form here is derived independently of the Macaulay machinery,
// and the two structural oracles are the ones worth stating up front because
// they are what make this path trustworthy at all:
//
//   1. ON A DETERMINATE BEAM, a spring stiffness and a support settlement
//      change NO reaction. Equilibrium alone already fixed them, so the beam
//      simply moves. If the new code path had leaked a term into the wrong row
//      this is the test that would catch it, and it is checked EXACTLY against
//      the rigid-support answer rather than to a tolerance.
//
//   2. AS A SPRING STIFFENS, the answer must converge on the rigid-support
//      answer it replaces. That is a genuine limit check across the whole
//      solve rather than a spot value, and it fails loudly if the EI/k
//      coefficient is attached to the wrong unknown or carries the wrong sign.
//
// Where the closed form is rational the assertion is EXACT, because the whole
// claim being made about this path is that it stays exact.

import { analyzeBeam, parseSupports, BeamInput, BeamResult } from "../beam";
import { Rat, ratInt, ratDiv, ratToNumber, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

/** Exact rational from a JS number, for the very small/large spring stiffnesses. */
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

function expectExact(actual: Rat, expected: Rat, what: string): void {
  expect(`${what} = ${actual.n}/${actual.d}`).toBe(`${what} = ${expected.n}/${expected.d}`);
}

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

// ---------------------------------------------------------------------------
// Oracle 1 — a determinate beam does not care
// ---------------------------------------------------------------------------

describe("determinate beams are unaffected by spring stiffness and settlement", () => {
  const base = (extra: Partial<{ k: Rat; settle: Rat }>, ei: Rat | null): BeamInput => ({
    length: R(8),
    supports: [
      { kind: "pin", x: R(0) },
      { kind: "roller", x: R(8), ...extra },
    ],
    loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
    ei,
  });

  // Rigid: R1 = R2 = wL/2 = 20 exactly.
  const rigid = ok(base({}, null));

  test("the rigid case is the reference, and it is exact", () => {
    expectExact(rigid.reactions[0].forceExact, R(20), "R1");
    expectExact(rigid.reactions[1].forceExact, R(20), "R2");
    expect(rigid.eiCoupled).toBe(false);
  });

  test("a settling support changes no reaction on a determinate beam", () => {
    const r = ok(base({ settle: ratDiv(R(1), R(100)) }, R(1000)));
    expectExact(r.reactions[0].forceExact, R(20), "R1 with settlement");
    expectExact(r.reactions[1].forceExact, R(20), "R2 with settlement");
    expect(r.eiCoupled).toBe(true);
  });

  test("a soft spring changes no reaction on a determinate beam either", () => {
    const r = ok(base({ k: R(37) }, R(1000)));
    expectExact(r.reactions[0].forceExact, R(20), "R1 on a spring");
    expectExact(r.reactions[1].forceExact, R(20), "R2 on a spring");
  });

  test("but the beam does MOVE — the settled support sits exactly where it was put", () => {
    const settle = ratDiv(R(1), R(100));
    const EI = 1000;
    const r = ok(base({ settle }, R(EI)));
    // v(8) must be exactly -0.01, i.e. EI·v(8) = -10.
    near(r.eiDeflectionAt(8) / EI, -0.01, 1e-9);
    // And the rigid beam sits at zero there.
    near(rigid.eiDeflectionAt(8), 0, 1e-9);
  });

  test("a spring support deflects by exactly R/k", () => {
    const k = 37;
    const EI = 1000;
    const r = ok(base({ k: R(k) }, R(EI)));
    // R2 = 20 up, so the seat compresses 20/37 downward.
    near(r.eiDeflectionAt(8) / EI, -20 / k, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Oracle 2 — indeterminate beams, against closed forms
// ---------------------------------------------------------------------------

describe("propped cantilever with a settling prop", () => {
  // Fixed at 0, prop at L, NO applied load, prop pushed down by delta.
  // The prop must drag the beam tip down delta, which for a cantilever needs a
  // downward force P with delta = PL^3/(3EI), so
  //     R_prop  = -3·EI·delta / L^3      (negative: the prop pulls DOWN)
  //     R_fixed = +3·EI·delta / L^3
  //     M_wall  = -3·EI·delta / L^2      (hogging)
  const L = 2,
    EI = 1000,
    delta = 1 / 1000;
  const expected = (3 * EI * delta) / L ** 3; // = 0.375

  const r = ok({
    length: R(L),
    supports: [
      { kind: "fixed", x: R(0) },
      { kind: "roller", x: R(L), settle: ratDiv(R(1), R(1000)) },
    ],
    loads: [],
    ei: R(EI),
  });

  test("settlement alone induces reactions, exactly 3EI·delta/L^3", () => {
    expectExact(r.reactions[1].forceExact, ratDiv(R(-3), R(8)), "prop reaction");
    expectExact(r.reactions[0].forceExact, ratDiv(R(3), R(8)), "wall reaction");
    near(Math.abs(ratToNumber(r.reactions[1].forceExact)), expected, 1e-12);
  });

  test("the wall moment is 3EI·delta/L^2, hogging", () => {
    const m = r.reactions[0].moment as number;
    expect(m).toBeLessThan(0);
    near(Math.abs(m), (3 * EI * delta) / L ** 2, 1e-12);
  });

  test("the induced reactions scale LINEARLY with EI — which is why they are uncertain", () => {
    const twice = ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(L), settle: ratDiv(R(1), R(1000)) },
      ],
      loads: [],
      ei: R(2 * EI),
    });
    near(ratToNumber(twice.reactions[1].forceExact), 2 * ratToNumber(r.reactions[1].forceExact), 1e-12);
  });

  test("an unloaded beam on RIGID supports has no reactions at all", () => {
    const rigid = ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [],
    });
    expectExact(rigid.reactions[0].forceExact, R(0), "wall reaction, no settlement");
    expectExact(rigid.reactions[1].forceExact, R(0), "prop reaction, no settlement");
  });
});

describe("propped cantilever on a spring prop", () => {
  // Fixed at 0, prop at L on a spring of stiffness k, UDL w over the whole span.
  // Rigid prop:  R_prop = 3wL/8.   No prop (k -> 0): R_prop = 0.
  // The spring answer must sit between and approach each limit.
  const L = 8,
    w = 5,
    EI = 1e6;
  const rigidProp = (3 * w * L) / 8; // = 15

  const withK = (k: string): BeamResult =>
    ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(L), k: X(k) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
      ei: X(String(EI)),
    });

  test("the rigid reference is 3wL/8 exactly", () => {
    const rigid = ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    expectExact(rigid.reactions[1].forceExact, ratDiv(R(15), R(1)), "rigid prop reaction");
  });

  test("a stiffening spring converges on the rigid answer", () => {
    const soft = ratToNumber(withK("1").reactions[1].forceExact);
    const mid = ratToNumber(withK("1e4").reactions[1].forceExact);
    const stiff = ratToNumber(withK("1e12").reactions[1].forceExact);
    expect(soft).toBeLessThan(mid);
    expect(mid).toBeLessThan(stiff);
    expect(stiff).toBeGreaterThan(rigidProp * 0.999999);
    expect(stiff).toBeLessThanOrEqual(rigidProp);
    near(stiff, rigidProp, 1e-6);
  });

  test("a vanishing spring converges on the unpropped cantilever", () => {
    const almostNone = ratToNumber(withK("1e-9").reactions[1].forceExact);
    expect(Math.abs(almostNone)).toBeLessThan(1e-6);
    // and the wall then carries the whole load, wL = 40.
    const wall = ratToNumber(withK("1e-9").reactions[0].forceExact);
    near(wall, w * L, 1e-6);
  });

  test("the spring answer always sits between the two limits", () => {
    for (const k of ["0.5", "10", "500", "1e5", "1e7"]) {
      const rp = ratToNumber(withK(k).reactions[1].forceExact);
      expect(rp).toBeGreaterThanOrEqual(-1e-9);
      expect(rp).toBeLessThanOrEqual(rigidProp + 1e-9);
    }
  });

  test("every case is still flagged as EI-coupled, and warns that it is", () => {
    const r = withK("1e4");
    expect(r.eiCoupled).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/NOT EI-free/i);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("refusals", () => {
  const springBeam = (k: Rat | null, settle: Rat | null, ei: Rat | null): BeamInput => ({
    length: R(8),
    supports: [
      { kind: "fixed", x: R(0) },
      { kind: "roller", x: R(8), ...(k ? { k } : {}), ...(settle ? { settle } : {}) },
    ],
    loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
    ei,
  });

  test("a spring without EI is refused, and the message says why there is no EI-free answer", () => {
    const r = analyzeBeam(springBeam(R(1000), null, null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/needs EI/i);
  });

  test("a settlement without EI is refused", () => {
    const r = analyzeBeam(springBeam(null, ratDiv(R(1), R(100)), null));
    expect(r.ok).toBe(false);
  });

  test("zero spring stiffness is refused as NO support rather than a soft one", () => {
    const r = analyzeBeam(springBeam(R(0), null, R(1000)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/greater than zero/i);
  });

  test("negative spring stiffness is refused", () => {
    expect(analyzeBeam(springBeam(R(-5), null, R(1000))).ok).toBe(false);
  });

  test("negative EI is refused", () => {
    expect(analyzeBeam(springBeam(R(1000), null, R(-1000))).ok).toBe(false);
  });

  test("a settlement of exactly zero is NOT a coupling, so it needs no EI", () => {
    const r = analyzeBeam(springBeam(null, R(0), null));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eiCoupled).toBe(false);
  });

  test("EI on an ordinary rigid beam changes nothing in the solve", () => {
    const without = ok({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
    });
    const with_ = ok({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: R(12345),
    });
    expectExact(with_.reactions[1].forceExact, without.reactions[1].forceExact, "prop reaction");
    expect(with_.eiCoupled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parsing — the capability has to be reachable from typed text
// ---------------------------------------------------------------------------

describe("parseSupports reads the new options", () => {
  test("plain supports still parse, and carry no options", () => {
    const p = parseSupports("pin 0, roller 8");
    expect(p.errors).toEqual([]);
    expect(p.supports).toHaveLength(2);
    expect(p.supports[0].k ?? null).toBeNull();
    expect(p.supports[1].settle ?? null).toBeNull();
  });

  test("a spring stiffness in scientific notation is exact", () => {
    const p = parseSupports("fixed 0, roller 8 k=5e4");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[1].k as Rat, R(50000), "k");
  });

  test("a settlement parses as an exact decimal, not a float", () => {
    const p = parseSupports("pin 0, roller 8 settle=0.01");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[1].settle as Rat, ratDiv(R(1), R(100)), "settle");
  });

  test("both options together, in either order", () => {
    const a = parseSupports("roller 8 k=1000 settle=0.02");
    const b = parseSupports("roller 8 settle=0.02 k=1000");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expectExact(a.supports[0].k as Rat, R(1000), "k");
    expectExact(b.supports[0].k as Rat, R(1000), "k");
    expectExact(a.supports[0].settle as Rat, ratDiv(R(2), R(100)), "settle");
    expectExact(b.supports[0].settle as Rat, ratDiv(R(2), R(100)), "settle");
  });

  test("the aliases work", () => {
    expect(parseSupports("roller 8 spring=1000").supports[0].k).toBeTruthy();
    expect(parseSupports("roller 8 stiffness=1000").supports[0].k).toBeTruthy();
    expect(parseSupports("roller 8 settlement=0.01").supports[0].settle).toBeTruthy();
  });

  test("an unknown option is named rather than silently dropped", () => {
    const p = parseSupports("roller 8 wobble=3");
    expect(p.errors.join(" ")).toMatch(/not a support option/i);
    expect(p.supports).toHaveLength(0);
  });

  test("a negative settlement (an upward heave) is allowed and keeps its sign", () => {
    const p = parseSupports("roller 8 settle=-0.01");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].settle as Rat, ratDiv(R(-1), R(100)), "settle");
  });

  test("the option regex does not eat the position", () => {
    const p = parseSupports("roller 8 settle=1e-3");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].x, R(8), "x");
    expectExact(p.supports[0].settle as Rat, ratDiv(R(1), R(1000)), "settle");
  });
});

// ---------------------------------------------------------------------------
// What the two options MEAN together
// ---------------------------------------------------------------------------

describe("a spring and a settlement on the same support compose as seat-then-spring", () => {
  // v(x_s) = -settle - R/k : the seat drops by `settle`, and the spring then
  // compresses by R/k on top of that. The alternative reading — the beam ends up
  // exactly `settle` low whatever the spring does — is a different model, and
  // the two are indistinguishable from the reported numbers alone.
  const EI = 2.4e5;
  const k = 5e4;
  const settle = 0.01;

  const r = ok({
    length: R(8),
    supports: [
      { kind: "fixed", x: R(0) },
      { kind: "roller", x: R(8), k: X("5e4"), settle: X("0.01") },
    ],
    loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
    ei: X("2.4e5"),
  });

  test("the beam sits at exactly -(settle + R/k), not at -settle", () => {
    const v = r.eiDeflectionAt(8) / EI;
    near(v, -(settle + r.reactions[1].force / k), 1e-9);
  });

  test("and that is measurably NOT the same as the settle-only model", () => {
    const settleOnly = ok({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), settle: X("0.01") },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    near(settleOnly.eiDeflectionAt(8) / EI, -settle, 1e-9);
    // Different model, different reaction — so the docs have to say which.
    expect(Math.abs(r.reactions[1].force - settleOnly.reactions[1].force)).toBeGreaterThan(1e-6);
  });

  test("dropping the spring recovers the pure-settlement answer", () => {
    const stiff = ok({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), k: X("1e14"), settle: X("0.01") },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    const settleOnly = ok({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), settle: X("0.01") },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("2.4e5"),
    });
    near(ratToNumber(stiff.reactions[1].forceExact), ratToNumber(settleOnly.reactions[1].forceExact), 1e-6);
  });
});

describe("fractions reach the parser from every field", () => {
  test("a fractional support position is exact", () => {
    const p = parseSupports("roller 1/3");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].x, ratDiv(R(1), R(3)), "x");
  });

  test("a fractional spring stiffness is exact", () => {
    const p = parseSupports("roller 8 k=1/3");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].k as Rat, ratDiv(R(1), R(3)), "k");
  });
});
