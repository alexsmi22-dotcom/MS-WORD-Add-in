// The inserted figure has a LAYOUT BUDGET, and nothing in the drawing code
// makes that obvious.
//
// Found by an independent review of the support artwork added in v2.36.1. Panel
// one is BEAM_H = 78 tall and the shear panel starts at BEAM_H + GAP = 94. Every
// pre-existing element respected that; the new spring ran to y = 80 and the new
// settlement label to y = 94, so the label was drawn on top of the shear
// diagram's title. Two more defects rode along: a NEGATIVE settlement (a heave)
// drew a downward arrow beside a label reading "-0.01", and on the perfectly
// ordinary "roller 8" the label started at x = 410 in a 420-wide viewBox and was
// clipped.
//
// None of these are visible to a test that only asks "did the SVG change?",
// which is what the original tests asked. These parse the coordinates back out.

import { analyzeBeam, BeamInput, BeamResult, Support, Load } from "../beam";
import { beamDiagramSvg } from "../beamChart";
import { Rat, ratInt, ratDiv, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const X = (s: string): Rat => parseRatLiteral(s) as Rat;

const LOADS: Load[] = [{ kind: "udl", a: R(0), b: R(8), w: R(5) }];

function svgFor(supports: Support[], ei: Rat | null): string {
  const input: BeamInput = { length: R(8), supports, loads: LOADS, ei };
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(r.error);
  return beamDiagramSvg({
    result: r as BeamResult,
    supports,
    loads: LOADS,
    forceUnit: "kN",
    momentUnit: "kN·m",
    lengthUnit: "m",
  });
}

/** Every y coordinate that appears in the first panel's markup. */
function panelOneYs(svg: string): number[] {
  // Panel one ends where the first <path> begins: drawBeam emits only lines,
  // polygons, circles and text, while drawPanel opens with a filled path.
  const head = svg.slice(0, svg.indexOf("<path"));
  const ys: number[] = [];
  for (const m of head.matchAll(/\b(?:y|y1|y2|cy)="(-?[\d.]+)"/g)) ys.push(parseFloat(m[1]));
  for (const m of head.matchAll(/points="([^"]+)"/g))
    for (const pt of m[1].trim().split(/\s+/)) ys.push(parseFloat(pt.split(",")[1]));
  return ys.filter((v) => Number.isFinite(v));
}

const BEAM_H = 78;
const SHEAR_TOP = 78 + 16;

describe("the support artwork stays inside panel one", () => {
  const cases: { name: string; supports: Support[]; ei: Rat | null }[] = [
    { name: "rigid", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], ei: null },
    { name: "spring", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), k: X("5e4") }], ei: X("2.4e5") },
    { name: "settle", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.01") }], ei: X("2.4e5") },
    { name: "spring+settle", supports: [{ kind: "pin", x: R(0), k: X("5e4"), settle: X("0.01") }, { kind: "roller", x: R(8) }], ei: X("2.4e5") },
    { name: "fixed+spring", supports: [{ kind: "fixed", x: R(0), k: X("5e4") }, { kind: "roller", x: R(8) }], ei: X("2.4e5") },
    { name: "fixed+spring+settle", supports: [{ kind: "fixed", x: R(0), k: X("5e4"), settle: X("0.01") }, { kind: "roller", x: R(8) }], ei: X("2.4e5") },
    { name: "heave", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("-0.01") }], ei: X("2.4e5") },
    { name: "tiny settle", supports: [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("1e-9") }], ei: X("2.4e5") },
  ];

  test.each(cases)("$name never draws below the panel budget", ({ supports, ei }) => {
    const ys = panelOneYs(svgFor(supports, ei));
    const max = Math.max(...ys);
    expect({ max: max <= BEAM_H }).toEqual({ max: true });
    expect(max).toBeLessThan(SHEAR_TOP);
  });

  test.each(cases)("$name emits no NaN, Infinity or undefined coordinate", ({ supports, ei }) => {
    const svg = svgFor(supports, ei);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("a heave points up and a settlement points down", () => {
  const arrowApex = (svg: string): { apex: number; backs: number } => {
    const head = svg.slice(0, svg.indexOf("<path"));
    // The settlement arrow is the only 3-point filled polygon in panel one.
    for (const m of head.matchAll(/<polygon points="([^"]+)" fill="#111111"\/>/g)) {
      const pts = m[1].trim().split(/\s+/).map((p) => parseFloat(p.split(",")[1]));
      if (pts.length === 3) return { apex: pts[0], backs: pts[1] };
    }
    throw new Error("no settlement arrow found");
  };

  test("a downward settlement draws an arrow whose apex is BELOW its base", () => {
    const a = arrowApex(svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("0.01") }], X("2.4e5")));
    expect(a.apex).toBeGreaterThan(a.backs);
  });

  test("a heave draws an arrow whose apex is ABOVE its base", () => {
    const a = arrowApex(svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("-0.01") }], X("2.4e5")));
    expect(a.apex).toBeLessThan(a.backs);
  });

  test("the label always agrees in sign with the arrow it annotates", () => {
    expect(svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8), settle: X("-0.01") }], X("2.4e5"))).toMatch(/-0\.01/);
  });
});

describe("the settlement label stays inside the viewBox", () => {
  const W = 420;
  const labelBox = (svg: string): { x: number; anchor: string; text: string } => {
    const head = svg.slice(0, svg.indexOf("<path"));
    const m = /<text x="([\d.-]+)" y="[\d.-]+" text-anchor="(start|end)" font-size="7\.5"[^>]*>([^<]*)<\/text>/.exec(head);
    if (!m) throw new Error("no settlement label found");
    return { x: parseFloat(m[1]), anchor: m[2], text: m[3] };
  };

  test.each([0, 1, 4, 7, 8])("a settling support at x = %s keeps its label on the page", (pos) => {
    const supports: Support[] = [
      { kind: "fixed", x: R(0) },
      { kind: "roller", x: R(pos === 0 ? 1 : pos), settle: X("0.0125") },
    ];
    if (pos === 0) supports[1] = { kind: "roller", x: R(8) };
    const target: Support[] =
      pos === 0
        ? [{ kind: "fixed", x: R(0), settle: X("0.0125") }, { kind: "roller", x: R(8) }]
        : supports;
    const lb = labelBox(svgFor(target, X("2.4e5")));
    // Estimate the text extent from the anchor and a generous per-glyph width.
    const wGuess = lb.text.length * 5;
    const left = lb.anchor === "end" ? lb.x - wGuess : lb.x;
    const right = lb.anchor === "end" ? lb.x : lb.x + wGuess;
    expect({ left: left >= 0, right: right <= W }).toEqual({ left: true, right: true });
  });
});

describe("the x-axis label is not clipped off the bottom", () => {
  test("the last text element sits inside the declared height", () => {
    const svg = svgFor([{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], null);
    const h = parseFloat(/height="([\d.]+)"/.exec(svg)![1]);
    const ys: number[] = [];
    for (const m of svg.matchAll(/<text x="[\d.-]+" y="([\d.-]+)"/g)) ys.push(parseFloat(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(h);
  });
});

describe("extreme but legal values do not corrupt the drawing", () => {
  test.each(["1e-9", "1e9", "0.000001234", "-1e-9", "123456.789"])("settle=%s", (v) => {
    const svg = svgFor([{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X(v) }], X("2.4e5"));
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(Math.max(...panelOneYs(svg))).toBeLessThanOrEqual(BEAM_H);
  });

  test("a huge exact settlement no longer renders as a non-finite coordinate", () => {
    // num() used Number(n)/Number(d), which made this Infinity and emitted it.
    const svg = svgFor([{ kind: "fixed", x: R(0) }, { kind: "roller", x: R(8), settle: X("1e400") }], X("2.4e5"));
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
