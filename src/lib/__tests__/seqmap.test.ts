// Linear sequence map tests.
//
// A map is a figure someone puts in a paper or an application, so the failure
// that matters isn't a crash — it's a plausible-looking picture that says
// something untrue: an arrow pointing the wrong way, an intron drawn as coding
// sequence, or a feature silently missing. These check the drawing says what the
// data says.

import { buildLinearMapSvg, featureTypes } from "../seqmap";
import { parseGenBank, SeqRecord } from "../seqio";

const GB = `LOCUS       pTEST                    600 bp    DNA     circular SYN 15-JUL-2026
FEATURES             Location/Qualifiers
     source          1..600
     promoter        1..100
                     /label="T7 promoter"
     CDS             join(101..200,301..400)
                     /gene="testG"
     misc_feature    complement(401..500)
                     /label="revElement"
     primer_bind     complement(551..560)
                     /label="M13rev"
ORIGIN
        1 ${"acgt".repeat(150)}
//
`;

const rec = (): SeqRecord => {
  const r = parseGenBank(GB);
  if (!r.ok) throw new Error(r.error);
  return r.records[0];
};

/** Every <path d="…"> in the SVG. */
const paths = (svg: string): string[] => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe("the map is well-formed", () => {
  test("renders valid SVG with no numeric leaks", () => {
    const svg = buildLinearMapSvg(rec())!;
    expect(svg).toMatch(/^<svg[^>]*>/);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  test("titles itself with name, length and topology", () => {
    const svg = buildLinearMapSvg(rec())!;
    expect(svg).toContain("pTEST");
    expect(svg).toContain("600");
    expect(svg).toContain("circular");
  });

  test("a linear record says linear", () => {
    const r = rec();
    r.circular = false;
    expect(buildLinearMapSvg(r)!).toContain("linear");
  });

  test("an empty record yields no map rather than an empty frame", () => {
    const r = rec();
    r.length = 0;
    expect(buildLinearMapSvg(r)).toBeNull();
  });

  test("a record with no features still draws the backbone and scale", () => {
    const r = rec();
    r.features = [];
    const svg = buildLinearMapSvg(r)!;
    expect(svg).toContain("<line"); // backbone
    expect(svg).toContain("600"); // end label
  });

  test("XML-special characters in a feature name are escaped, not injected", () => {
    const r = rec();
    r.features[0].name = 'a & b <tag> "q"';
    const svg = buildLinearMapSvg(r)!;
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;tag&gt;");
    // The injected tag must not become real markup.
    expect(svg).not.toMatch(/<tag>/);
  });
});

describe("the drawing says what the data says", () => {
  test("every feature is drawn", () => {
    const r = rec();
    const svg = buildLinearMapSvg(r)!;
    for (const f of r.features) expect(svg).toContain(f.name);
  });

  test("a joined CDS draws one body per exon, not one bar across the intron", () => {
    // The whole point of parsing join() is that the intron is NOT coding. A
    // single bar from 101..400 would claim it is.
    const r = rec();
    const cds = r.features.find((f) => f.type === "CDS")!;
    expect(cds.segments).toHaveLength(2);
    const only = { ...r, features: [cds] };
    const svg = buildLinearMapSvg(only)!;
    expect(paths(svg)).toHaveLength(2); // one per exon
    expect(svg).toContain("stroke-dasharray"); // the intron connector
  });

  test("a single-segment feature draws exactly one body", () => {
    const r = rec();
    const p = r.features.find((f) => f.type === "promoter")!;
    expect(paths(buildLinearMapSvg({ ...r, features: [p] })!)).toHaveLength(1);
  });

  test("forward and reverse arrows point opposite ways", () => {
    const r = rec();
    const fwd = r.features.find((f) => f.type === "promoter")!; // strand +1
    const rev = r.features.find((f) => f.type === "misc_feature")!; // strand -1
    expect(fwd.strand).toBe(1);
    expect(rev.strand).toBe(-1);

    // The arrow tip is the vertex at mid-height. For a forward arrow it sits at
    // the feature's right edge; for a reverse one, at its left.
    const tipX = (svg: string): number => {
      const d = paths(svg)[0];
      const pts = [...d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
      const ys = pts.map((p) => p.y);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      return pts.find((p) => Math.abs(p.y - mid) < 0.6)!.x;
    };
    const fx = tipX(buildLinearMapSvg({ ...r, features: [fwd] })!);
    const rx = tipX(buildLinearMapSvg({ ...r, features: [rev] })!);
    // Forward: tip is at the RIGHT of its span (1..100, near the left edge).
    // Reverse: tip is at the LEFT of its span (401..500, further right).
    // So the forward tip must still be left of the reverse feature's tip, and
    // each tip must be at the correct end of its own body.
    const bodyX = (svg: string) => {
      const pts = [...paths(svg)[0].matchAll(/([\d.]+),([\d.]+)/g)].map((m) => +m[1]);
      return { min: Math.min(...pts), max: Math.max(...pts) };
    };
    const fb = bodyX(buildLinearMapSvg({ ...r, features: [fwd] })!);
    const rb = bodyX(buildLinearMapSvg({ ...r, features: [rev] })!);
    expect(fx).toBeCloseTo(fb.max, 1); // forward tip at the right end
    expect(rx).toBeCloseTo(rb.min, 1); // reverse tip at the left end
  });

  test("feature position tracks its coordinates", () => {
    // A feature at the start must be drawn left of one at the end.
    const r = rec();
    const first = r.features.find((f) => f.start === 1)!;
    const last = r.features.find((f) => f.type === "primer_bind")!;
    const x = (svg: string) => Math.min(...[...paths(svg)[0].matchAll(/([\d.]+),/g)].map((m) => +m[1]));
    expect(x(buildLinearMapSvg({ ...r, features: [first] })!)).toBeLessThan(
      x(buildLinearMapSvg({ ...r, features: [last] })!)
    );
  });

  test("a tiny feature is still visible rather than sub-pixel", () => {
    const r = rec();
    r.features = [{ ...r.features[0], start: 300, end: 301, segments: [{ start: 300, end: 301 }] }];
    const svg = buildLinearMapSvg(r)!;
    const xs = [...paths(svg)[0].matchAll(/([\d.]+),/g)].map((m) => +m[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(2);
  });
});

describe("labels don't collide", () => {
  test("overlapping features are pushed onto separate lanes", () => {
    // Two features at the same coordinates must not be drawn on top of each other.
    const r = rec();
    const base = r.features[0];
    r.features = [
      { ...base, name: "alpha", start: 10, end: 60, segments: [{ start: 10, end: 60 }] },
      { ...base, name: "beta", start: 20, end: 70, segments: [{ start: 20, end: 70 }] },
    ];
    const svg = buildLinearMapSvg(r)!;
    const ys = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>(alpha|beta)</g)].map((m) => +m[1]);
    expect(ys).toHaveLength(2);
    expect(ys[0]).not.toBeCloseTo(ys[1], 1); // different lanes
  });

  test("a long label on a short feature reserves lane space (or labels overlap)", () => {
    // The real failure: a 3px feature with a 60px label. If only the body's
    // width is reserved, the next feature's label lands on top of this one.
    const r = rec();
    const base = r.features[0];
    r.features = [
      { ...base, name: "a-very-long-feature-label-here", start: 10, end: 12, segments: [{ start: 10, end: 12 }] },
      { ...base, name: "second-long-label-here", start: 20, end: 22, segments: [{ start: 20, end: 22 }] },
    ];
    const svg = buildLinearMapSvg(r)!;
    const ys = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>(a-very-long|second-long)/g)].map((m) => +m[1]);
    expect(ys).toHaveLength(2);
    expect(ys[0]).not.toBeCloseTo(ys[1], 1);
  });

  test("a label near the right edge flips left instead of being clipped", () => {
    // Found by rendering a pUC19 map and LOOKING at it: "AmpR promoter" and
    // "rrnB T1" sit near the end of the sequence, so their labels were placed to
    // the right of the feature and ran straight off the canvas — they rendered
    // as "AmpR p" and "rrn". Every assertion passed; only the picture showed it.
    const r = rec();
    const base = r.features[0];
    r.features = [{ ...base, name: "a-label-too-long-to-fit-here", start: 590, end: 600, segments: [{ start: 590, end: 600 }] }];
    const W = 400;
    const svg = buildLinearMapSvg(r, { width: W })!;
    const m = /<text[^>]*x="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>a-label-too-long/.exec(svg)!;
    expect(m).toBeTruthy();
    expect(m[2]).toBe("end"); // anchored right → text extends LEFT
    expect(Number(m[1])).toBeLessThanOrEqual(W); // and stays on the canvas
  });

  test("a label with room to the right still goes right", () => {
    const r = rec();
    const base = r.features[0];
    r.features = [{ ...base, name: "short", start: 10, end: 20, segments: [{ start: 10, end: 20 }] }];
    const svg = buildLinearMapSvg(r, { width: 400 })!;
    expect(/<text[^>]*text-anchor="start"[^>]*>short/.test(svg)).toBe(true);
  });

  test("no label overflows either edge of the canvas", () => {
    // The general form of the bug: with features at both extremes and long
    // names, nothing may spill past the viewport in either direction.
    const r = rec();
    const base = r.features[0];
    const W = 420;
    r.features = [
      { ...base, name: "left-edge-long-label", start: 1, end: 5, segments: [{ start: 1, end: 5 }] },
      { ...base, name: "right-edge-long-label", start: 596, end: 600, segments: [{ start: 596, end: 600 }] },
    ];
    const svg = buildLinearMapSvg(r, { width: W })!;
    for (const m of svg.matchAll(/<text[^>]*x="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]+)</g)) {
      const x = Number(m[1]);
      const w = m[3].length * 9 * 0.55;
      const left = m[2] === "end" ? x - w : m[2] === "middle" ? x - w / 2 : x;
      const right = m[2] === "end" ? x : m[2] === "middle" ? x + w / 2 : x + w;
      expect(left).toBeGreaterThanOrEqual(-1);
      expect(right).toBeLessThanOrEqual(W + 1);
    }
  });

  test("the SVG grows to fit its lanes rather than clipping them", () => {
    const r = rec();
    const base = r.features[0];
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      name: `feature-number-${i}`,
      start: 10 + i,
      end: 20 + i,
      segments: [{ start: 10 + i, end: 20 + i }],
    }));
    const svg = buildLinearMapSvg({ ...r, features: many })!;
    const h = Number(/height="(\d+)"/.exec(svg)![1]);
    const maxY = Math.max(...[...svg.matchAll(/y="([\d.]+)"/g)].map((m) => +m[1]));
    expect(maxY).toBeLessThanOrEqual(h); // nothing drawn off-canvas
  });
});

describe("honesty", () => {
  test("a feature crossing the origin is disclosed, not silently dropped", () => {
    // On a circular plasmid a feature can wrap past the end. A linear map has no
    // honest way to draw it — so say so rather than omit it quietly.
    const r = rec();
    r.features = [{ ...r.features[0], name: "wrapper", start: 550, end: 650, wraps: true, segments: [{ start: 550, end: 650 }] }];
    const svg = buildLinearMapSvg(r)!;
    expect(svg).not.toContain("wrapper");
    expect(svg).toMatch(/cross the origin/);
  });

  test("no such note when nothing wraps", () => {
    expect(buildLinearMapSvg(rec())!).not.toMatch(/cross the origin/);
  });
});

describe("options", () => {
  test("monochrome draws line art for patent figures", () => {
    const colour = buildLinearMapSvg(rec())!;
    const mono = buildLinearMapSvg(rec(), { monochrome: true })!;
    expect(colour).toMatch(/#2563eb|#059669/); // real colours
    expect(mono).not.toMatch(/#2563eb|#059669/);
    expect(mono).toContain('fill="#fff"'); // hollow bodies, black outlines
  });

  test("type filtering draws only what was asked for", () => {
    const svg = buildLinearMapSvg(rec(), { types: ["CDS"] })!;
    expect(svg).toContain("testG");
    expect(svg).not.toContain("T7 promoter");
  });

  test("a custom title replaces the default", () => {
    expect(buildLinearMapSvg(rec(), { title: "My construct" })!).toContain("My construct");
  });

  test("width is honoured", () => {
    expect(buildLinearMapSvg(rec(), { width: 900 })!).toContain('width="900"');
  });
});

describe("featureTypes", () => {
  test("counts each type, most common first", () => {
    const t = featureTypes(rec());
    expect(t.map((x) => x.type).sort()).toEqual(["CDS", "misc_feature", "primer_bind", "promoter"]);
    expect(t.every((x) => x.count === 1)).toBe(true);
  });

  test("empty record → empty list", () => {
    expect(featureTypes({ ...rec(), features: [] })).toEqual([]);
  });
});
