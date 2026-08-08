// Composite plane figures: exact areas for a base shape with cutouts or
// additions, units carried through, honest about what placement would change.

import { solveComposite, qtyExact, qtyToNumber } from "../compositeGeometry";
import { compositeShapeSvg } from "../geometryChart";

function val(r: NonNullable<ReturnType<typeof solveComposite>>, label: RegExp): number {
  const v = r.values.find((x) => label.test(x.label));
  expect(v).toBeDefined();
  return v!.value;
}

describe("the motivating request: a 10\" × 5\" rectangle with a triangle inside", () => {
  test("DSL form: both areas, exact, in in²", () => {
    const r = solveComposite("rectangle 10in x 5in minus triangle b=4in h=3in");
    expect(r).not.toBeNull();
    expect(r!.incomplete).toBeUndefined();
    expect(r!.unit).toBe("in");
    expect(val(r!, /cutouts still counted/)).toBe(50); // area WITH the triangle
    expect(val(r!, /without the cutouts/)).toBe(44); // area WITHOUT it
    expect(qtyExact(r!.netArea)).toBe("44");
    expect(r!.values.find((v) => /without/.test(v.label))!.unit).toBe("in²");
  });

  test("prose form with inch marks reads the same", () => {
    const r = solveComposite('take a rectangle that is 10" x 5" with a triangle inside, base 4" height 3"');
    expect(r).not.toBeNull();
    expect(r!.incomplete).toBeUndefined();
    expect(val(r!, /without the cutouts/)).toBe(44);
  });

  test("the question tail does not mint phantom shapes", () => {
    // "find the area without the triangle and with the triangle" mentions the
    // triangle twice more — with no dimensions. Those mentions are the
    // QUESTION, not additional cutouts.
    const r = solveComposite(
      'take a rectangle that is 10" x 5" with a triangle inside base 4" height 3". find the area without the triangle and with the triangle',
    );
    expect(r).not.toBeNull();
    expect(r!.incomplete).toBeUndefined();
    expect(r!.shapes).toHaveLength(2);
    expect(val(r!, /without the cutouts/)).toBe(44);
  });

  test("a triangle with no dimensions asks for them instead of guessing", () => {
    const r = solveComposite('rectangle 10" x 5" with a triangle inside');
    expect(r).not.toBeNull();
    expect(r!.incomplete).toMatch(/triangle needs dimensions/);
    expect(r!.values).toHaveLength(0);
  });
});

describe("exactness", () => {
  test("π survives: rectangle minus circle", () => {
    const r = solveComposite("rectangle 8 x 6 minus circle r=2");
    expect(qtyExact(r!.netArea)).toBe("48 - 4*pi");
    expect(qtyToNumber(r!.netArea)).toBeCloseTo(48 - 4 * Math.PI, 12);
    expect(r!.netArea.pi.n).not.toBe(0n); // the π term genuinely survives
  });

  test("annulus: circle minus circle", () => {
    const r = solveComposite("circle r=5 minus circle r=3");
    expect(qtyExact(r!.netArea)).toBe("16*pi");
  });

  test("Heron triangles keep their surd until it resolves", () => {
    // 3-4-5 is right-angled: √(6·3·2·1) = 6 exactly — the surd resolves.
    const r = solveComposite("rectangle 10 x 5 minus triangle 3 4 5");
    expect(qtyExact(r!.netArea)).toBe("44");
    // 2-3-4 is not: area √(4.5·2.5·1.5·0.5) stays exact under the root.
    const s = solveComposite("rectangle 10 x 5 minus triangle 2 3 4");
    expect(qtyExact(s!.netArea)).toMatch(/sqrt/);
    expect(qtyToNumber(s!.netArea)).toBeCloseTo(50 - 2.9047375096555625, 10);
  });

  test("fractional dimensions stay exact", () => {
    const r = solveComposite("rectangle 1/2 x 1/3 minus square s=1/4");
    expect(qtyExact(r!.baseArea)).toBe("1/6");
    expect(qtyExact(r!.netArea)).toBe("5/48");
  });

  test("mixed units convert exactly (1 ft = 12 in)", () => {
    const r = solveComposite("rectangle 1ft x 6in minus square s=2in");
    expect(r!.unit).toBe("ft"); // first unit seen wins
    // 1 ft × 1/2 ft = 1/2 ft²; square (1/6 ft)² = 1/36 ft².
    expect(qtyExact(r!.baseArea)).toBe("1/2");
    expect(qtyExact(r!.netArea)).toBe("17/36");
  });
});

describe("adversarial regressions — silent wrong numbers the first review caught", () => {
  test("decimal dimensions survive sentence-punctuation stripping", () => {
    // The period stripper once ate decimal points: 10.5 → "10 5", and the
    // pair regex then read a 5-wide rectangle. Values, not just no-NaN.
    const r = solveComposite("rectangle 10.5 x 4 minus circle r=1.25");
    expect(qtyExact(r!.baseArea)).toBe("42");
    expect(qtyExact(r!.removedArea)).toBe("25/16*pi");
    const s = solveComposite("rectangle 8 x 3 plus semicircle r=1.5");
    expect(qtyExact(s!.netArea)).toBe("24 + 9/8*pi");
  });

  test("sentence periods still go: '10 in. x 5 in.' parses", () => {
    const r = solveComposite("rectangle 10 in. x 5 in. minus square s=2in");
    expect(r!.unit).toBe("in");
    expect(qtyExact(r!.netArea)).toBe("46");
  });

  test("'with X attached / added / on top' is an ADDITION, not a sign error", () => {
    expect(qtyExact(solveComposite("rectangle 10 x 5 with a semicircle r=2 attached")!.netArea)).toBe("50 + 2*pi");
    expect(qtyExact(solveComposite("rectangle 10 x 5 with a circle r=2 added")!.netArea)).toBe("50 + 4*pi");
    expect(qtyExact(solveComposite("rectangle 10 x 5 with a square s=2 on top")!.netArea)).toBe("54");
    // …while plain "with … inside" stays a cutout.
    expect(qtyExact(solveComposite("rectangle 10 x 5 with a square s=2 inside")!.netArea)).toBe("46");
  });

  test("point-list triangles are declined (solveGeometry's grammar, not ours)", () => {
    // The vertices once parsed as SIDE LENGTHS and produced a false
    // "violates the triangle inequality" about a perfectly valid triangle.
    expect(solveComposite("triangle (1,1) (5,1) (1,4) minus circle r=1")).toBeNull();
    expect(solveComposite("triangle (0,0) (4,0) (0,3) minus circle r=1")).toBeNull();
  });

  test("angle-named triangles (SSA) are declined, not mangled by lowercasing", () => {
    // Lowercasing once turned A=30 into a=30, overwriting the side.
    expect(solveComposite("triangle a=6 b=8 A=30 minus circle r=1")).toBeNull();
  });
});

describe("shapes and operations", () => {
  test("semicircle, trapezoid and multiple cutouts", () => {
    const r = solveComposite("rectangle 12 x 8 minus trapezoid a=3 b=5 h=2 minus semicircle r=1");
    // 96 − 8 − π/2
    expect(qtyExact(r!.netArea)).toBe("88 - 1/2*pi");
  });

  test("additions build an L-shape", () => {
    const r = solveComposite("rectangle 8 x 3 plus rectangle 3 x 5");
    expect(qtyExact(r!.netArea)).toBe("39");
    expect(r!.caveats.some((c) => /perimeter.*depends|depends on how they attach/i.test(c))).toBe(true);
  });

  test("10x5 without spaces parses", () => {
    const r = solveComposite("rectangle 10x5 minus square s=2");
    expect(qtyExact(r!.netArea)).toBe("46");
  });

  test("continuation clauses do not split shapes ('square with side 4')", () => {
    const r = solveComposite("square with side 4 minus circle r=1");
    expect(r).not.toBeNull();
    expect(r!.shapes).toHaveLength(2);
    expect(qtyExact(r!.netArea)).toBe("16 - pi");
  });

  test("diameter works for circles", () => {
    const r = solveComposite("rectangle 12 x 8 minus circle d=3");
    expect(qtyExact(r!.removedArea)).toBe("9/4*pi");
  });
});

describe("honesty", () => {
  test("placement assumption is stated whenever something is removed", () => {
    const r = solveComposite("rectangle 10 x 5 minus circle r=1");
    expect(r!.caveats.some((c) => /lie fully inside|placement/i.test(c))).toBe(true);
  });

  test("a cutout that cannot fit is called out", () => {
    const r = solveComposite("rectangle 10 x 5 minus triangle b=12 h=3");
    expect(r!.incomplete).toBeUndefined(); // area math still valid to show
    expect(r!.caveats.some((c) => /larger than the base/.test(c))).toBe(true);
  });

  test("removed area exceeding the base is refused as impossible", () => {
    const r = solveComposite("rectangle 4 x 4 minus circle r=3");
    expect(r!.incomplete).toMatch(/exceeds the base area/);
    expect(r!.values).toHaveLength(0);
  });

  test("an impossible triangle is refused by name", () => {
    const r = solveComposite("rectangle 10 x 5 minus triangle 1 2 10");
    expect(r!.incomplete).toMatch(/triangle inequality/);
  });

  test("outer perimeter is reported only when the dimensions determine it", () => {
    const rect = solveComposite("rectangle 10 x 5 minus circle r=1");
    expect(rect!.values.some((v) => /outer perimeter/.test(v.label))).toBe(true);
    // A b/h triangle base: its slant sides are not fixed by b and h.
    const tri = solveComposite("triangle b=6 h=4 minus circle r=1");
    expect(tri!.values.some((v) => /outer perimeter/.test(v.label))).toBe(false);
  });
});

describe("what is NOT a composite request stays out of this parser", () => {
  test("single shapes fall through to solveGeometry (null here)", () => {
    expect(solveComposite("circle r=3")).toBeNull();
    expect(solveComposite("triangle 3 4 5")).toBeNull();
  });

  test("non-geometry text is null, not an error", () => {
    expect(solveComposite("x^2 - 5x + 6 = 0")).toBeNull();
    expect(solveComposite("")).toBeNull();
    expect(solveComposite("minus")).toBeNull();
  });
});

describe("the figure", () => {
  test("draws the motivating example with real labels and the disclaimer", () => {
    const r = solveComposite("rectangle 10in x 5in minus triangle b=4in h=3in");
    const svg = compositeShapeSvg(r!);
    expect(svg).toContain("<svg");
    expect(svg).toContain("rectangle 10 × 5 in");
    expect(svg).toContain("− b = 4, h = 3 in");
    expect(svg).toContain("base area 50 in²");
    expect(svg).toContain("net 44 in²");
    expect(svg).toContain("placement illustrative");
    // Cutouts are hatched, not solid — visually removal, not addition.
    expect(svg).toContain("cutHatch");
  });

  test("an incomplete result draws a message, never a guessed figure", () => {
    const r = solveComposite('rectangle 10" x 5" with a triangle inside');
    const svg = compositeShapeSvg(r!);
    expect(svg).toContain("triangle needs dimensions");
    expect(svg).not.toContain("cutHatch");
  });

  test("every emitted figure is finite markup with text", () => {
    for (const input of [
      "rectangle 10in x 5in minus triangle b=4in h=3in",
      "circle r=5 minus circle r=3",
      "rectangle 6 x 3 minus circle r=1.4 minus square s=2 minus triangle b=2 h=2",
      "rectangle 8 x 3 plus rectangle 3 x 5 plus semicircle r=1.5",
      "trapezoid a=3 b=5 h=2 minus circle r=0.5",
    ]) {
      const r = solveComposite(input);
      expect(r).not.toBeNull();
      const svg = compositeShapeSvg(r!);
      expect(svg).toContain("<text");
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
