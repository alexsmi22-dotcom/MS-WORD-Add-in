// Circular plasmid map tests.
//
// The dangerous failure here isn't a crash — it's a beautiful picture that lies.
// Get the angle convention backwards and the whole construct is mirrored; get
// the strand wrong and every arrow points the wrong way. Both look completely
// fine. So these check the geometry against known positions, not just "did it
// draw something".

import { buildCircularMapSvg } from "../seqmapcirc";
import { parseGenBank, SeqRecord } from "../seqio";

const GB = `LOCUS       pTEST                   1200 bp    DNA     circular SYN 15-JUL-2026
FEATURES             Location/Qualifiers
     source          1..1200
     promoter        1..100
                     /label="topProm"
     CDS             301..600
                     /gene="rightGene"
     misc_feature    complement(601..900)
                     /label="bottomRev"
     primer_bind     complement(901..1100)
                     /label="leftPrimer"
ORIGIN
        1 ${"acgt".repeat(300)}
//
`;

const rec = (): SeqRecord => {
  const r = parseGenBank(GB);
  if (!r.ok) throw new Error(r.error);
  return r.records[0];
};

const paths = (svg: string): string[] => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
/** All coordinate pairs in a path. */
const pts = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));

describe("well-formed", () => {
  test("valid SVG, no numeric leaks", () => {
    const svg = buildCircularMapSvg(rec())!;
    expect(svg).toMatch(/^<svg[^>]*>/);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  test("square canvas at the requested size", () => {
    const svg = buildCircularMapSvg(rec(), { size: 500 })!;
    expect(svg).toContain('width="500"');
    expect(svg).toContain('height="500"');
  });

  test("centre caption names the construct and its size", () => {
    const svg = buildCircularMapSvg(rec())!;
    expect(svg).toContain("pTEST");
    expect(svg).toContain("1,200 bp");
  });

  test("an empty record draws nothing rather than an empty ring", () => {
    const r = rec();
    r.length = 0;
    expect(buildCircularMapSvg(r)).toBeNull();
  });

  test("a record with no features still draws the backbone", () => {
    const r = rec();
    r.features = [];
    const svg = buildCircularMapSvg(r)!;
    expect(svg).toContain("<circle"); // the ring
    expect(svg).toContain("pTEST");
  });

  test("feature names are escaped, not injected", () => {
    const r = rec();
    r.features[0].name = '<script>x</script> & "q"';
    const svg = buildCircularMapSvg(r)!;
    expect(svg).toContain("&amp;");
    expect(svg.toLowerCase()).not.toContain("<script");
  });
});

describe("the geometry is CORRECT, not just pretty", () => {
  // The convention every plasmid map follows: position 1 at 12 o'clock,
  // increasing clockwise. Reversing it mirrors the construct — a picture that
  // looks perfect and is wrong.
  const S = 400;
  const cx = S / 2;
  const cy = S / 2;

  /** Mean position of one feature's arc. */
  const centroid = (name: string) => {
    const r = rec();
    const f = r.features.find((x) => x.name === name)!;
    const svg = buildCircularMapSvg({ ...r, features: [f] }, { size: S })!;
    const p = pts(paths(svg)[0]);
    return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length };
  };

  test("position 1 sits at 12 o'clock (top)", () => {
    // topProm is 1..100 of 1200 — the very start, so it must be at the top.
    const c = centroid("topProm");
    expect(c.y).toBeLessThan(cy); // above centre
    expect(Math.abs(c.x - cx)).toBeLessThan(S * 0.12); // and near the vertical axis
  });

  test("a quarter of the way round sits at 3 o'clock (right) — i.e. CLOCKWISE", () => {
    // rightGene is 301..600 of 1200 = 25–50%, so it spans the right side.
    // If the map ran anticlockwise this would land on the LEFT.
    const c = centroid("rightGene");
    expect(c.x).toBeGreaterThan(cx);
  });

  test("halfway round sits at 6 o'clock (bottom)", () => {
    // bottomRev is 601..900 = 50–75%.
    const c = centroid("bottomRev");
    expect(c.y).toBeGreaterThan(cy);
  });

  test("three quarters round sits at 9 o'clock (left)", () => {
    // leftPrimer is 901..1100 = 75–92%.
    const c = centroid("leftPrimer");
    expect(c.x).toBeLessThan(cx);
  });

  test("every feature is drawn", () => {
    const r = rec();
    const svg = buildCircularMapSvg(r)!;
    expect(paths(svg)).toHaveLength(r.features.length);
    for (const f of r.features) expect(svg).toContain(f.name);
  });

  test("arcs stay inside the canvas", () => {
    const svg = buildCircularMapSvg(rec(), { size: S })!;
    for (const d of paths(svg)) {
      for (const p of pts(d)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(S);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(S);
      }
    }
  });

  test("a 1 bp feature is still visible rather than a zero-width sliver", () => {
    const r = rec();
    r.features = [{ ...r.features[0], start: 600, end: 600, segments: [{ start: 600, end: 600 }] }];
    const svg = buildCircularMapSvg(r, { size: S })!;
    const p = pts(paths(svg)[0]);
    const w = Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
    const h = Math.max(...p.map((q) => q.y)) - Math.min(...p.map((q) => q.y));
    expect(Math.max(w, h)).toBeGreaterThan(2);
  });

  test("overlapping features are pushed onto separate rings", () => {
    // Two features at the same coordinates must not be drawn on top of each
    // other — they'd be indistinguishable.
    const r = rec();
    const base = r.features[0];
    r.features = [
      { ...base, name: "outer", start: 100, end: 500, segments: [{ start: 100, end: 500 }] },
      { ...base, name: "inner", start: 150, end: 450, segments: [{ start: 150, end: 450 }] },
    ];
    const svg = buildCircularMapSvg(r, { size: S })!;
    const radius = (d: string) => {
      const p = pts(d);
      return Math.max(...p.map((q) => Math.hypot(q.x - cx, q.y - cy)));
    };
    const [r1, r2] = paths(svg).map(radius);
    expect(Math.abs(r1 - r2)).toBeGreaterThan(5); // different rings
  });
});

describe("labels", () => {
  test("every feature gets a label with a leader line", () => {
    const r = rec();
    const svg = buildCircularMapSvg(r)!;
    for (const f of r.features) {
      expect(new RegExp(`<text[^>]*>${f.name}<`).test(svg)).toBe(true);
    }
    // One leader per feature, plus tick marks.
    expect((svg.match(/<line/g) || []).length).toBeGreaterThanOrEqual(r.features.length);
  });

  test("labels on the same side don't overlap vertically", () => {
    // The real failure on a dense plasmid: an MCS packs a dozen sites into
    // 100 bp and every label lands on the same spot.
    const r = rec();
    const base = r.features[0];
    r.features = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      name: `feature-${i}`,
      start: 10 + i * 3,
      end: 14 + i * 3,
      segments: [{ start: 10 + i * 3, end: 14 + i * 3 }],
    }));
    const svg = buildCircularMapSvg(r)!;
    const ys = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>feature-\d</g)].map((m) => +m[1]).sort((a, b) => a - b);
    expect(ys).toHaveLength(6);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(8); // a legible gap
    }
  });

  test("labels are anchored away from the ring on each side", () => {
    const svg = buildCircularMapSvg(rec())!;
    expect(svg).toMatch(/text-anchor="start"/);
    expect(svg).toMatch(/text-anchor="end"/);
  });
});

describe("options and honesty", () => {
  test("monochrome is genuinely black and white — a patent figure must be", () => {
    const colour = buildCircularMapSvg(rec())!;
    const mono = buildCircularMapSvg(rec(), { monochrome: true })!;
    expect(colour).toMatch(/#2563eb|#7c3aed|#059669/);
    // Every colour in the mono map must be black, white, or near-black ink.
    const used = [...mono.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase());
    const allowed = new Set(["#000", "#fff", "#1b1b1f"]);
    for (const c of used) expect(allowed.has(c)).toBe(true);
  });

  test("type filtering draws only what was asked for", () => {
    const svg = buildCircularMapSvg(rec(), { types: ["CDS"] })!;
    expect(svg).toContain("rightGene");
    expect(svg).not.toContain("topProm");
  });

  test("a custom title replaces the name", () => {
    expect(buildCircularMapSvg(rec(), { title: "My plasmid" })!).toContain("My plasmid");
  });

  test("features that run out of rings are disclosed, not silently dropped", () => {
    // A very dense plasmid can exhaust the radius. Saying nothing would leave a
    // map that looks complete and isn't.
    const r = rec();
    const base = r.features[0];
    // 30 features all at the same spot → far more rings than fit.
    r.features = Array.from({ length: 30 }, (_, i) => ({
      ...base,
      name: `f${i}`,
      start: 100,
      end: 200,
      segments: [{ start: 100, end: 200 }],
    }));
    const svg = buildCircularMapSvg(r, { size: 300 })!;
    expect(svg).toMatch(/could not be placed/);
  });

  test("no such note when everything fits", () => {
    expect(buildCircularMapSvg(rec())!).not.toMatch(/could not be placed/);
  });
});
