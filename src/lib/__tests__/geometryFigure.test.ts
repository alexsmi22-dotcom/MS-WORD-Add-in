// The plain-geometry figure builders (geometryChart.geometryFigureSvg).
//
// What an SVG string test CAN prove: the builder returns a real, non-degenerate
// figure with the marks and labels the caption promises. What it cannot prove:
// that Word honours the insert — that stays with docs/TEST-SCRIPT.md, as ever.

import { geometryFigureSvg, geometryFigureAlt, drawnShapesSvg } from "../geometryChart";
import { solveGeometry } from "../geometryParse";
import { GeoFigure } from "../geometry";

const figFor = (input: string): GeoFigure => {
  const g = solveGeometry(input);
  expect(g?.figure).toBeDefined();
  return g!.figure!;
};

const isSvg = (s: string): void => {
  expect(s.startsWith("<svg")).toBe(true);
  expect(s.trim().endsWith("</svg>")).toBe(true);
  expect(s).toContain("<text");
};

describe("triangle figures", () => {
  test("an SSS triangle draws with all six labels", () => {
    const svg = geometryFigureSvg(figFor("triangle 3 4 5"));
    isSvg(svg);
    for (const label of ["a = 3", "b = 4", "c = 5", "A = ", "B = ", "C = "]) {
      expect(svg).toContain(label);
    }
    expect(svg).toContain("drawn to scale");
  });

  test("the SSA pair draws BOTH solutions, labelled", () => {
    const fig = figFor("triangle a=6 b=8 A=30");
    expect(fig.kind).toBe("triangle");
    expect((fig as Extract<GeoFigure, { kind: "triangle" }>).triangles).toHaveLength(2);
    const svg = geometryFigureSvg(fig);
    isSvg(svg);
    expect(svg).toContain("solution 1");
    expect(svg).toContain("solution 2");
    expect(svg).toContain("both triangles satisfy");
  });

  test("the drawn triangle is FAITHFUL: the right angle of 3-4-5 is where it says", () => {
    // Construction check via the data, not the pixels: A at origin, B at (c, 0),
    // C at (b·cosA, b·sinA). For 3-4-5 the angle at C must be 90°.
    const fig = figFor("triangle 3 4 5") as Extract<GeoFigure, { kind: "triangle" }>;
    const t = fig.triangles[0];
    expect(t.A + t.B + t.C).toBeCloseTo(180, 8);
    expect(Math.max(t.A, t.B, t.C)).toBeCloseTo(90, 8);
  });
});

describe("point-set figures", () => {
  test("a polygon draws closed with its centroid marked", () => {
    const svg = geometryFigureSvg(figFor("polygon (0,0) (4,0) (5,3) (2,5) (-1,3)"));
    isSvg(svg);
    expect(svg).toContain("Z"); // a closed path
    expect(svg).toContain("centroid marked");
  });

  test("the point-in-polygon probe carries its verdict into the figure", () => {
    const svg = geometryFigureSvg(figFor("inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)"));
    isSvg(svg);
    expect(svg).toContain("inside");
  });

  test("a transform figure is a before → after pair", () => {
    const svg = geometryFigureSvg(figFor("rotate 90 (2,3)"));
    isSvg(svg);
    expect(svg).toContain("before → after");
    expect(svg).toContain("(2, 3)");
    // Figure text: U+2212 minus (display contract, v2.143.0 label audit).
    expect(svg).toContain("(−3, 2)");
  });
});

describe("conic figures", () => {
  test("an ellipse draws one closed curve with two foci marked", () => {
    const svg = geometryFigureSvg(figFor("x^2/9 + y^2/4 = 1"));
    isSvg(svg);
    expect(svg).toContain("foci marked");
  });

  test("a hyperbola draws BOTH branches", () => {
    const svg = geometryFigureSvg(figFor("x^2/4 - y^2/9 = 1"));
    isSvg(svg);
    // Two curve paths (plus marks): count path elements with the curve stroke.
    const curves = (svg.match(/<path d="M[^"]*" fill="none" stroke="#0c4a6e"/g) ?? []).length;
    expect(curves).toBe(2);
    expect(svg).toContain("both branches");
  });

  test("a parabola draws through its vertex, opening toward the focus", () => {
    const svg = geometryFigureSvg(figFor("y = x^2/8"));
    isSvg(svg);
    expect(svg).toContain("parabola");
  });

  test("circle through three points marks the given points", () => {
    const svg = geometryFigureSvg(figFor("circle (1,0) (0,1) (-1,0)"));
    isSvg(svg);
    expect(svg).toContain("the given points marked");
  });
});

describe("circle-toolkit figures", () => {
  test("a sector is a filled wedge on a dashed circle", () => {
    const svg = geometryFigureSvg(figFor("sector r=5 angle=60"));
    isSvg(svg);
    expect(svg).toContain('fill="#eef4f8"');
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("central angle 60");
  });

  test("a reflex sector (300°) uses the large-arc flag", () => {
    const svg = geometryFigureSvg(figFor("sector r=5 angle=300"));
    isSvg(svg);
    expect(svg).toMatch(/A[\d. ]+ [\d. ]+ 0 1 0/);
  });

  test("a 360° sector is drawn as the whole disc, not an invisible arc", () => {
    const svg = geometryFigureSvg(figFor("sector r=5 angle=360"));
    isSvg(svg);
    expect(svg).toContain("the whole circle");
    expect(svg).not.toContain("<path"); // circles, not a degenerate arc path
  });

  test("the tangent figure draws both tangent lines to their touch points", () => {
    const svg = geometryFigureSvg(figFor("tangent r=3 d=5"));
    isSvg(svg);
    const tangentLines = (svg.match(/stroke="#b91c1c" stroke-width="1.4"/g) ?? []).length;
    expect(tangentLines).toBe(2);
    expect(svg).toContain("right angle");
  });
});

describe("drawnShapesSvg — figures at the TRUE drawn placement (v2.108.0)", () => {
  const composite: Parameters<typeof drawnShapesSvg>[0] = [
    { kind: "rectangle", a: { x: 1, y: 1 }, b: { x: 11, y: 8 } },
    { kind: "circle", c: { x: 3.5, y: 4.5 }, r: 1.5 },
  ];

  test("a drawn composite renders base + hatched cutout with labels and NO disclaimer", () => {
    const svg = drawnShapesSvg(composite, ["base area 70   ·   net 62.93"]);
    isSvg(svg);
    expect(svg).toContain("10 × 7");
    expect(svg).toContain("− r = 1.5");
    expect(svg).toContain("drawnCutHatch");
    expect(svg).toContain("placement as drawn");
    expect(svg).not.toContain("illustrative");
  });

  test("the cutout decision is the shared one — moved outside, nothing hatches", () => {
    const apart: typeof composite = [
      composite[0],
      { kind: "circle", c: { x: 14, y: 4.5 }, r: 1.5 },
    ];
    const svg = drawnShapesSvg(apart, ["two shapes"]);
    expect(svg).not.toContain("url(#drawnCutHatch)");
  });

  test("single drawn shapes and segment pairs render to scale with captions", () => {
    const c = drawnShapesSvg([{ kind: "circle", c: { x: 5, y: 5 }, r: 2.5 }], ["Circle, r = 2.5"]);
    isSvg(c);
    expect(c).toContain("r = 2.5");
    const segs = drawnShapesSvg(
      [
        { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 4 } },
        { kind: "segment", a: { x: 0, y: 4 }, b: { x: 4, y: 0 } },
      ],
      ["Line"]
    );
    isSvg(segs);
    // Segment lengths live in the CAPTION — a crossing defeats every local
    // on-canvas placement (independent pass, v2.108.0).
    expect(segs).toContain("segment lengths: 5.66, 5.66");
  });

  test("touching tiny cutouts stack their labels instead of colliding (pinned)", () => {
    const svg = drawnShapesSvg(
      [
        { kind: "rectangle", a: { x: 1, y: 1 }, b: { x: 11, y: 8 } },
        { kind: "circle", c: { x: 5, y: 4 }, r: 0.5 },
        { kind: "circle", c: { x: 6, y: 4 }, r: 0.5 },
      ],
      ["base area 70"]
    );
    const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>− r = 0\.5<\/text>/g)];
    expect(labels).toHaveLength(2);
    const [a, b] = labels.map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    // Distinct rows or well-separated columns — never the same spot.
    expect(Math.abs(a.y - b.y) >= 11 || Math.abs(a.x - b.x) >= 46).toBe(true);
  });

  test("asymmetric segment crossings carry no on-canvas labels at all (pinned)", () => {
    const svg = drawnShapesSvg(
      [
        { kind: "segment", a: { x: 0, y: 0 }, b: { x: 16, y: 8 } },
        { kind: "segment", a: { x: 0, y: 4 }, b: { x: 16, y: 0 } },
      ],
      ["Line"]
    );
    // The only "length" text is in the caption strip, below the drawing.
    const lengthTexts = [...svg.matchAll(/<text[^>]*>segment lengths[^<]*<\/text>/g)];
    expect(lengthTexts).toHaveLength(1);
    expect(svg).toContain("segment lengths: 17.89, 16.49");
  });

  test("hostile inputs stay finite", () => {
    const svg = drawnShapesSvg([{ kind: "rectangle", a: { x: 0, y: 0 }, b: { x: 0.5, y: 0.5 } }], ["tiny"]);
    expect(svg).not.toContain("NaN");
    expect(drawnShapesSvg([], ["nothing"])).toBe("");
  });
});

describe("alt text is written by the kind that drew the figure", () => {
  test("each kind describes itself, never another kind", () => {
    const cases: [string, RegExp][] = [
      ["triangle 3 4 5", /solved triangle/],
      ["polygon (0,0) (4,0) (4,4) (0,4)", /polygon drawn to scale/],
      ["x^2/9 + y^2/4 = 1", /ellipse/],
      ["sector r=5 angle=60", /sector drawn to scale/],
      ["inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)", /marked inside/],
      ["rotate 90 (2,3)", /before and after/],
    ];
    for (const [input, want] of cases) {
      const g = solveGeometry(input)!;
      const alt = geometryFigureAlt(g.figure!, g.title);
      expect(alt).toMatch(want);
      expect(alt).toContain(g.title);
      expect(alt).not.toMatch(/barcode|composite/i);
    }
  });
});
