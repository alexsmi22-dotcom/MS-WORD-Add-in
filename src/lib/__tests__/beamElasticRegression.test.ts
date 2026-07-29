// Regressions found by an INDEPENDENT bug hunt on v2.36.0.
//
// All four were in text and pictures rather than in the solve, which is why 118
// green tests and a full QC run missed every one: the arithmetic was checked
// hard and the things the user actually READS were not checked at all.
//
//   1. The warning shown on every indeterminate rigid-support beam told the
//      reader to type `settle 0.01`, which the parser rejects.
//   2. The "NOT EI-free" warning fired on determinate beams, where it is false,
//      and contradicted the determinacy note printed above it in the same result.
//   3. A string concatenation split "rigid-support" into "rigid -support".
//   4. The figure inserted into the document drew a rigid support for a spring
//      or a settling one — byte-identical SVG.
//
// The first of these gets a GENERAL test rather than a specific one: every piece
// of syntax any warning quotes is fed back through the parser. That catches the
// next such instruction too, which a test for this one sentence would not.

import { analyzeBeam, parseSupports, BeamInput, BeamResult, Support, Load } from "../beam";
import { beamDiagramSvg } from "../beamChart";
import { Rat, ratInt, ratDiv, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const X = (s: string): Rat => parseRatLiteral(s) as Rat;

function ok(input: BeamInput): BeamResult {
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

const LOADS: Load[] = [{ kind: "udl", a: R(0), b: R(8), w: R(5) }];

/** Every distinct beam shape, so the warning sweep sees every warning. */
const SHAPES: { name: string; supports: Support[]; ei?: Rat }[] = [
  { name: "simply supported", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }] },
  { name: "propped cantilever", supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8) }] },
  { name: "fixed-fixed", supports: [{ kind: "fixed", x: R(0) }, { kind: "fixed", x: R(8) }] },
  { name: "cantilever", supports: [{ kind: "fixed", x: R(0) }] },
  { name: "three supports", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(4) }, { kind: "roller", x: R(8) }] },
  { name: "determinate + spring", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k: X("5") }], ei: X("1") },
  { name: "determinate + settle", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.01") }], ei: X("2.4e5") },
  { name: "indeterminate + spring", supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X("5e4") }], ei: X("2.4e5") },
  { name: "indeterminate + settle", supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.01") }], ei: X("2.4e5") },
];

const ALL = SHAPES.map((s) => ({ ...s, result: ok({ length: R(8), supports: s.supports, loads: LOADS, ei: s.ei ?? null }) }));

// ---------------------------------------------------------------------------
// 1. Advice a user can actually follow
// ---------------------------------------------------------------------------

describe("every support syntax a message quotes must actually parse", () => {
  test.each(ALL)("$name", ({ result }) => {
    const text = [result.determinacy.note, ...result.warnings].join(" ");
    // Quoted fragments that look like a support option or a support line.
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThanOrEqual(0);
    for (const q of quoted) {
      // An option fragment like `settle=0.01` is tested attached to a support.
      const candidate = /^(pin|roller|fixed)\b/i.test(q) ? q : `roller 8 ${q}`;
      const p = parseSupports(candidate);
      expect({ quoted: q, errors: p.errors }).toEqual({ quoted: q, errors: [] });
    }
  });

  test("the specific instruction that was broken now round-trips", () => {
    const r = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8) }],
      loads: LOADS,
    });
    const advice = r.warnings.join(" ");
    expect(advice).toMatch(/settle=0\.01/);
    expect(advice).not.toMatch(/"settle 0\.01"/);
    const p = parseSupports("roller 8 settle=0.01");
    expect(p.errors).toEqual([]);
    expect(p.supports[0].settle).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. The EI claim must match the determinacy
// ---------------------------------------------------------------------------

describe("the NOT-EI-free warning appears only where it is true", () => {
  const determinateSpring = (ei: string): BeamResult =>
    ok({
      length: R(8),
      supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k: X("5") }],
      loads: [{ kind: "point", x: R(6), p: R(30) }],
      ei: X(ei),
    });

  test("a DETERMINATE elastic beam really does give the same reactions at any EI", () => {
    const a = determinateSpring("1");
    const b = determinateSpring("1e6");
    for (let i = 0; i < 2; i++)
      expect(`R${i}=${a.reactions[i].forceExact.n}/${a.reactions[i].forceExact.d}`).toBe(
        `R${i}=${b.reactions[i].forceExact.n}/${b.reactions[i].forceExact.d}`,
      );
  });

  test("so it must NOT be told its reactions scale with EI", () => {
    const r = determinateSpring("1");
    expect(r.eiCoupled).toBe(true);
    expect(r.warnings.join(" ")).not.toMatch(/NOT EI-free/i);
    expect(r.warnings.join(" ")).not.toMatch(/scale with it/i);
    // and it should be told the useful true thing instead
    expect(r.warnings.join(" ")).toMatch(/same for any EI/i);
  });

  test("an INDETERMINATE elastic beam still gets the warning, because there it is true", () => {
    const r = ok({
      length: R(8),
      supports: [{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), k: X("5e4") }],
      loads: LOADS,
      ei: X("2.4e5"),
    });
    expect(r.warnings.join(" ")).toMatch(/NOT EI-free/i);
  });

  test("no result ever contradicts itself about EI", () => {
    for (const { name, result } of ALL) {
      const all = [result.determinacy.note, ...result.warnings].join(" ");
      const saysNoChange = /change no reaction|same for any EI/i.test(all);
      const saysScales = /scale with it|NOT EI-free/i.test(all);
      expect({ name, contradiction: saysNoChange && saysScales }).toEqual({ name, contradiction: false });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Broken concatenation
// ---------------------------------------------------------------------------

describe("no message has a seam left by string concatenation", () => {
  test.each(ALL)("$name", ({ result }) => {
    const text = [result.determinacy.note, ...result.warnings].join("\n");
    expect(text).not.toMatch(/\s-[a-z]/); // " -support"
    expect(text).not.toMatch(/[a-z]- /); // "rigid- support"
    expect(text).not.toMatch(/ {2,}/); // doubled spaces from a missing trim
    expect(text).not.toMatch(/[a-z][A-Z]{2,}[a-z]/); // glued words
  });
});

// ---------------------------------------------------------------------------
// 4. The figure must show what was computed
// ---------------------------------------------------------------------------

describe("the inserted diagram distinguishes elastic and settling supports", () => {
  const svgFor = (extra: Partial<{ k: Rat; settle: Rat }>, ei: Rat | null): string => {
    const supports: Support[] = [
      { kind: "fixed", x: R(0) },
      { kind: "roller", x: R(8), ...extra },
    ];
    const result = ok({ length: R(8), supports, loads: LOADS, ei });
    return beamDiagramSvg({ result, supports, loads: LOADS, forceUnit: "kN", momentUnit: "kN·m", lengthUnit: "m" });
  };

  const rigid = svgFor({}, null);
  const spring = svgFor({ k: X("5e4") }, X("2.4e5"));
  const settled = svgFor({ settle: X("0.01") }, X("2.4e5"));
  const both = svgFor({ k: X("5e4"), settle: X("0.01") }, X("2.4e5"));

  test("a spring support does not draw the same picture as a rigid one", () => {
    expect(spring).not.toBe(rigid);
  });

  test("a settling support does not draw the same picture as a rigid one", () => {
    expect(settled).not.toBe(rigid);
  });

  test("a spring and a settlement do not draw the same picture as each other", () => {
    expect(spring).not.toBe(settled);
  });

  test("using both draws something different again", () => {
    expect(both).not.toBe(spring);
    expect(both).not.toBe(settled);
  });

  test("the settlement value is written on the figure", () => {
    expect(settled).toMatch(/0\.01/);
  });

  test("every diagram is still well-formed SVG with balanced tags", () => {
    for (const s of [rigid, spring, settled, both]) {
      expect(s.startsWith("<svg")).toBe(true);
      expect(s.trimEnd().endsWith("</svg>")).toBe(true);
      expect(s).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
