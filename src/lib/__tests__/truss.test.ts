// Oracle tests for the planar truss engine.
//
// The expected member forces are worked by hand from joint equilibrium, and
// where the answer is rational the assertion is EXACT against the returned Rat.
// An exact engine that returns 4.499999999999999 for 9/2 has lost the property
// that makes it worth having, and a tolerance-based test would not notice.

import { analyzeTruss, parseTruss, TrussResult, TrussInput } from "../truss";
import { Rat, ratInt, ratDiv, ratToNumber } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

function ok(input: TrussInput): TrussResult {
  const r = analyzeTruss(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

function fails(input: TrussInput): string {
  const r = analyzeTruss(input);
  if (r.ok) throw new Error("expected a refusal, got a solution");
  return r.error;
}

/** Exact rational equality, printed readably when it fails. */
function expectExact(actual: Rat, expected: Rat, what: string): void {
  expect(`${what} = ${actual.n}/${actual.d}`).toBe(`${what} = ${expected.n}/${expected.d}`);
}

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

const force = (r: TrussResult, a: string, b: string): number => {
  const m = r.members.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (!m) throw new Error(`no member ${a}-${b}`);
  return m.force;
};

const reaction = (r: TrussResult, joint: string, dir: "x" | "y"): Rat => {
  const x = r.reactions.find((v) => v.joint === joint && v.dir === dir);
  if (!x) throw new Error(`no reaction ${joint}.${dir}`);
  return x.exact;
};

// ---------------------------------------------------------------------------
// A single triangle, 3-4-5 so every answer is rational.
//
//        C (3,4)
//       / \
//      /   \        load 12 down at C
//     A-----B       A pinned (0,0), B roller (6,0)
//
// Symmetric, so Ay = By = 6. At A the vertical component of AC must carry 6,
// and AC rises 4 in a length of 5, so |F_AC| = 6 * 5/4 = 7.5 compression. Its
// horizontal component 7.5 * 3/5 = 4.5 is balanced by AB in tension.
// ---------------------------------------------------------------------------
const triangle: TrussInput = {
  joints: [
    { name: "A", x: R(0), y: R(0) },
    { name: "B", x: R(6), y: R(0) },
    { name: "C", x: R(3), y: R(4) },
  ],
  members: [
    { a: "A", b: "B" },
    { a: "A", b: "C" },
    { a: "B", b: "C" },
  ],
  supports: [
    { joint: "A", kind: "pin" },
    { joint: "B", kind: "roller" },
  ],
  loads: [{ joint: "C", fx: R(0), fy: R(-12) }],
};

describe("simple triangle truss", () => {
  test("member forces match hand-worked joint equilibrium, exactly", () => {
    const r = ok(triangle);
    const ab = r.members.find((m) => m.a === "A" && m.b === "B")!;
    const ac = r.members.find((m) => m.a === "A" && m.b === "C")!;
    const bc = r.members.find((m) => m.a === "B" && m.b === "C")!;
    // The 3-4-5 geometry makes every length rational, so every force is exact.
    expectExact(ab.exact!, R(9, 2), "F_AB");
    expectExact(ac.exact!, R(-15, 2), "F_AC");
    expectExact(bc.exact!, R(-15, 2), "F_BC");
    expect(ab.state).toBe("tension");
    expect(ac.state).toBe("compression");
    expect(bc.state).toBe("compression");
    near(ac.length, 5);
    near(bc.length, 5);
  });

  test("reactions are exact and symmetric", () => {
    const r = ok(triangle);
    expectExact(reaction(r, "A", "y"), R(6), "Ay");
    expectExact(reaction(r, "B", "y"), R(6), "By");
    expectExact(reaction(r, "A", "x"), R(0), "Ax");
  });

  test("global equilibrium holds", () => {
    const r = ok(triangle);
    const sumY = r.reactions.filter((v) => v.dir === "y").reduce((s, v) => s + v.value, 0);
    const sumX = r.reactions.filter((v) => v.dir === "x").reduce((s, v) => s + v.value, 0);
    near(sumY, 12);
    near(sumX, 0, 1e-9);
  });

  test("the determinacy count is reported", () => {
    const r = ok(triangle);
    expect(r.counts).toEqual({ joints: 3, members: 3, reactions: 3, equations: 6 });
    expect(r.determinacy).toMatch(/determinate/i);
  });

  test("compression members carry a buckling warning", () => {
    const r = ok(triangle);
    expect(r.warnings.join(" ")).toMatch(/BUCKLING/i);
  });

  test("the largest tension and compression are identified", () => {
    const r = ok(triangle);
    expect(r.maxTension!.member).toBe("A-B");
    near(r.maxTension!.force, 4.5);
    near(r.maxCompression!.force, -7.5);
  });
});

// ---------------------------------------------------------------------------
// Irrational geometry: the exactness trick's whole point.
// ---------------------------------------------------------------------------
describe("members with irrational length", () => {
  // Apex moved to (3,2): AC has length sqrt(9+4) = sqrt(13), which is irrational,
  // so the force is irrational too — but the REACTIONS stay exact, because they
  // never touch a length.
  const t: TrussInput = {
    joints: [
      { name: "A", x: R(0), y: R(0) },
      { name: "B", x: R(6), y: R(0) },
      { name: "C", x: R(3), y: R(2) },
    ],
    members: [
      { a: "A", b: "B" },
      { a: "A", b: "C" },
      { a: "B", b: "C" },
    ],
    supports: [
      { joint: "A", kind: "pin" },
      { joint: "B", kind: "roller" },
    ],
    loads: [{ joint: "C", fx: R(0), fy: R(-12) }],
  };

  test("reactions stay exact even though the members do not", () => {
    const r = ok(t);
    expectExact(reaction(r, "A", "y"), R(6), "Ay");
    expectExact(reaction(r, "B", "y"), R(6), "By");
  });

  test("an irrational length reports no exact force but the right number", () => {
    const r = ok(t);
    const ac = r.members.find((m) => m.a === "A" && m.b === "C")!;
    expect(ac.exact).toBeNull();
    near(ac.length, Math.sqrt(13));
    // Vertical equilibrium at A: |F| * (2/sqrt(13)) = 6, so F = -3*sqrt(13).
    near(ac.force, -3 * Math.sqrt(13));
    // The force PER UNIT LENGTH is still exact: -3.
    expectExact(ac.perLength, R(-3), "f_AC");
  });

  test("horizontal member force is still exactly rational", () => {
    const r = ok(t);
    const ab = r.members.find((m) => m.a === "A" && m.b === "B")!;
    // Horizontal component of AC at A is 3 * 3 = 9, balanced by AB.
    expectExact(ab.exact!, R(9), "F_AB");
  });
});

// ---------------------------------------------------------------------------
// Zero-force members, detected exactly.
// ---------------------------------------------------------------------------
describe("zero-force members", () => {
  // A joint with exactly two non-collinear members and no load carries nothing
  // in either — the standard rule, here as a consequence of the solve rather
  // than a special case in the code.
  const t: TrussInput = {
    joints: [
      { name: "A", x: R(0), y: R(0) },
      { name: "B", x: R(4), y: R(0) },
      { name: "C", x: R(8), y: R(0) },
      { name: "D", x: R(4), y: R(3) },
      { name: "E", x: R(8), y: R(3) },
    ],
    members: [
      { a: "A", b: "B" },
      { a: "B", b: "C" },
      { a: "A", b: "D" },
      { a: "B", b: "D" },
      { a: "D", b: "E" },
      { a: "C", b: "E" },
      { a: "D", b: "C" },
    ],
    supports: [
      { joint: "A", kind: "pin" },
      { joint: "C", kind: "roller" },
    ],
    loads: [{ joint: "E", fx: R(0), fy: R(-10) }],
  };

  test("an unloaded two-member joint gives exact zeros", () => {
    const r = ok(t);
    // B carries three collinear-plus-one members; D-B is the odd one out and
    // must be zero because nothing else at B has a vertical component.
    const bd = r.members.find((m) => m.a === "B" && m.b === "D")!;
    expect(bd.state).toBe("zero");
    expect(bd.perLength.n).toBe(0n);
    expect(r.zeroForce).toContain("B-D");
  });

  test("zero-force members carry the load-case caveat", () => {
    const r = ok(t);
    expect(r.warnings.join(" ")).toMatch(/different load case/i);
  });
});

// ---------------------------------------------------------------------------
// Refusals. Each of these is a structural statement, not a numerical failure.
// ---------------------------------------------------------------------------
describe("structures that have no answer", () => {
  test("a mechanism is named as a mechanism", () => {
    const t: TrussInput = {
      ...triangle,
      members: [
        { a: "A", b: "B" },
        { a: "A", b: "C" },
      ],
    };
    expect(fails(t)).toMatch(/MECHANISM/);
  });

  test("an indeterminate truss says the method cannot solve it", () => {
    const t: TrussInput = {
      ...triangle,
      supports: [
        { joint: "A", kind: "pin" },
        { joint: "B", kind: "pin" },
      ],
    };
    const e = fails(t);
    expect(e).toMatch(/INDETERMINATE to degree 1/);
    expect(e).toMatch(/stiffness|EA/i);
  });

  // THE CASE MEMBER COUNTING MISSES. Three parallel reactions: the count says
  // determinate, and the truss slides sideways.
  test("three parallel reactions are caught as a critical form", () => {
    const t: TrussInput = {
      joints: [
        { name: "A", x: R(0), y: R(0) },
        { name: "B", x: R(6), y: R(0) },
        { name: "C", x: R(3), y: R(4) },
      ],
      members: [
        { a: "A", b: "B" },
        { a: "A", b: "C" },
        { a: "B", b: "C" },
      ],
      supports: [
        { joint: "A", kind: "roller" },
        { joint: "B", kind: "roller" },
        { joint: "C", kind: "roller" },
      ],
      loads: [{ joint: "C", fx: R(0), fy: R(-12) }],
    };
    // 3 members + 3 reactions = 6 = 2 x 3 joints, so the count passes.
    expect(fails(t)).toMatch(/CRITICAL FORM/);
  });

  test("duplicate joints and members are refused by name", () => {
    expect(
      fails({
        ...triangle,
        joints: [
          { name: "A", x: R(0), y: R(0) },
          { name: "A", x: R(6), y: R(0) },
          { name: "C", x: R(3), y: R(4) },
        ],
      }),
    ).toMatch(/defined twice/);
    expect(
      fails({
        ...triangle,
        members: [
          { a: "A", b: "B" },
          { a: "B", b: "A" },
          { a: "A", b: "C" },
        ],
      }),
    ).toMatch(/listed twice/);
  });

  test("two joints at the same point are refused", () => {
    expect(
      fails({
        ...triangle,
        joints: [
          { name: "A", x: R(0), y: R(0) },
          { name: "B", x: R(0), y: R(0) },
          { name: "C", x: R(3), y: R(4) },
        ],
      }),
    ).toMatch(/same point/);
  });

  test("references to undeclared joints are refused", () => {
    expect(fails({ ...triangle, members: [...triangle.members, { a: "A", b: "Z" }] })).toMatch(/unknown joint "Z"/);
    expect(fails({ ...triangle, loads: [{ joint: "Q", fx: R(0), fy: R(-1) }] })).toMatch(/unknown joint "Q"/);
  });

  test("a member joining a joint to itself is refused", () => {
    expect(fails({ ...triangle, members: [...triangle.members, { a: "A", b: "A" }] })).toMatch(/itself/);
  });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
describe("parsing", () => {
  const text = [
    "joint A 0 0",
    "joint B 6 0",
    "joint C 3 4",
    "member A B",
    "member A C",
    "member B C",
    "support A pin",
    "support B roller",
    "load C 0 -12",
  ].join("\n");

  test("round-trips to the same answer as the hand-built input", () => {
    const p = parseTruss(text);
    expect(p.errors).toEqual([]);
    const r = ok(p.input);
    expectExact(r.members.find((m) => m.a === "A" && m.b === "B")!.exact!, R(9, 2), "F_AB");
  });

  test("decimals parse to exact rationals, not to the nearest double", () => {
    const p = parseTruss("joint A 0 0\njoint B 0.1 0");
    expect(p.errors).toEqual([]);
    // 0.1 is 1/10 exactly, not 3602879701896397/36028797018963968.
    expectExact(p.input.joints[1].x, R(1, 10), "x_B");
  });

  test("fractions are accepted", () => {
    const p = parseTruss("joint A 0 0\njoint B 7/3 0");
    expect(p.errors).toEqual([]);
    expectExact(p.input.joints[1].x, R(7, 3), "x_B");
  });

  test("comments and blank lines are ignored", () => {
    const p = parseTruss("# a comment\n\njoint A 0 0  # trailing\njoint B 1 0\n");
    expect(p.errors).toEqual([]);
    expect(p.input.joints).toHaveLength(2);
  });

  test("malformed lines are reported with a line number and not silently dropped", () => {
    const p = parseTruss("joint A 0\nwibble\nload C 0");
    expect(p.errors).toHaveLength(3);
    expect(p.errors[0]).toMatch(/line 1/);
    expect(p.errors[1]).toMatch(/line 2/);
    expect(p.errors[2]).toMatch(/line 3/);
  });

  test("a bad support kind is named", () => {
    const p = parseTruss("joint A 0 0\nsupport A wobbly");
    expect(p.errors.join(" ")).toMatch(/not a support kind/);
  });

  test("empty input reports that there are no joints", () => {
    expect(parseTruss("").errors.join(" ")).toMatch(/No joints/);
  });
});
