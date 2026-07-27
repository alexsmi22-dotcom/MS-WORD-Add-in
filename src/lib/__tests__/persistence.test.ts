// Persistent homology (persistence.ts) — Release T2.
//
// The test that matters is the PROPERTY one, not exact bar endpoints: a ring of
// points must show exactly one long H₁ bar and a filled blob must show none.
// That contrast is the entire claim of the feature — a ring and a blob have
// similar means, similar spreads and similar correlations, and differ in H₁ —
// so if it fails, the feature is worthless regardless of what the numbers say.
//
// Everything is deterministic: the "noise" comes from a seeded PRNG, because a
// flaky topology test would be worse than no test.

import {
  persistentHomology, parsePointCloud, barcodeSvg, euclidean,
} from "../persistence";

/** Seeded PRNG — deterministic, so a failure is always reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const circle = (n: number, r = 1, noise = 0, seed = 42): number[][] => {
  const rnd = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [r * Math.cos(t) + (rnd() - 0.5) * noise, r * Math.sin(t) + (rnd() - 0.5) * noise];
  });
};

const blob = (n: number, seed = 7): number[][] => {
  const rnd = rng(seed);
  return Array.from({ length: n }, () => [rnd() * 2 - 1, rnd() * 2 - 1]);
};

const h1 = (r: ReturnType<typeof persistentHomology>) =>
  r.pairs.filter((p) => p.dimension === 1 && Number.isFinite(p.persistence));

describe("the property that justifies the feature", () => {
  it("A CIRCLE shows exactly one long H1 bar", () => {
    const r = persistentHomology(circle(24, 1, 0), { maxDim: 1 });
    const bars = h1(r).sort((a, b) => b.persistence - a.persistence);
    expect(bars.length).toBeGreaterThan(0);
    const longest = bars[0];
    const runnerUp = bars[1]?.persistence ?? 0;
    // The loop must dominate everything else by a wide margin.
    expect(longest.persistence).toBeGreaterThan(0.5);
    expect(longest.persistence).toBeGreaterThan(runnerUp * 5);
  });

  it("a NOISY circle still shows the loop", () => {
    const r = persistentHomology(circle(24, 1, 0.12), { maxDim: 1 });
    const bars = h1(r).sort((a, b) => b.persistence - a.persistence);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0].persistence).toBeGreaterThan(0.4);
  });

  it("a BLOB shows no comparable H1 feature — the essential contrast", () => {
    const rBlob = persistentHomology(blob(24), { maxDim: 1 });
    const rCirc = persistentHomology(circle(24, 1, 0), { maxDim: 1 });
    const longestBlob = Math.max(0, ...h1(rBlob).map((p) => p.persistence));
    const longestCirc = Math.max(0, ...h1(rCirc).map((p) => p.persistence));
    // A blob may show small spurious loops; the circle's must dwarf them.
    expect(longestCirc).toBeGreaterThan(longestBlob * 3);
  });

  it("two well-separated clusters show two long-lived components in H0", () => {
    const pts = [
      ...Array.from({ length: 8 }, (_, i) => [Math.cos(i), Math.sin(i)]),
      ...Array.from({ length: 8 }, (_, i) => [50 + Math.cos(i), Math.sin(i)]),
    ];
    const r = persistentHomology(pts, { maxDim: 1, bettiAt: 5 });
    // At a scale that merges each cluster but not the gap between them, β₀ = 2.
    expect(r.bettiAt!.betti[0]).toBe(2);
  });
});

describe("H0 behaves like connected components", () => {
  it("n points start as n components and merge into one", () => {
    const pts = circle(10, 1, 0);
    const r = persistentHomology(pts, { maxDim: 1 });
    const h0 = r.pairs.filter((p) => p.dimension === 0);
    // One component survives forever; the rest die as the cloud connects up.
    const essential = h0.filter((p) => !Number.isFinite(p.death));
    expect(essential.length).toBe(1);
    expect(h0.length).toBe(10); // 9 deaths + 1 essential
  });
  it("Betti numbers at scale 0 are the point count", () => {
    const r = persistentHomology(circle(6, 1, 0), { maxDim: 1, bettiAt: 0 });
    expect(r.bettiAt!.betti[0]).toBe(6);
  });
});

describe("bars are well formed", () => {
  it("death is always after birth, and persistence matches", () => {
    const r = persistentHomology(circle(16, 1, 0.05), { maxDim: 1 });
    for (const p of r.pairs) {
      expect(p.death).toBeGreaterThan(p.birth);
      if (Number.isFinite(p.death)) expect(p.persistence).toBeCloseTo(p.death - p.birth, 12);
      else expect(p.persistence).toBe(Infinity);
    }
  });
  it("the most persistent finite bar per dimension is surfaced", () => {
    const r = persistentHomology(circle(20, 1, 0), { maxDim: 1 });
    expect(r.notable.length).toBeGreaterThan(0);
    for (const n of r.notable) expect(Number.isFinite(n.persistence)).toBe(true);
  });
  it("cells are counted per dimension", () => {
    const r = persistentHomology(circle(8, 1, 0), { maxDim: 1 });
    expect(r.cells[0]).toBe(8);
    expect(r.cells[1]).toBeGreaterThan(0);
  });
});

describe("honesty", () => {
  it("every result states its 𝔽₂, proxy and evidence caveats", () => {
    const r = persistentHomology(circle(8, 1, 0), { maxDim: 1 });
    const all = r.caveats.join(" ");
    expect(all).toMatch(/𝔽₂|F2/);
    expect(all).toMatch(/PROXY/i);
    expect(all).toMatch(/EVIDENCE/i);
  });
  it("a point cap is REPORTED, never silent", () => {
    const many = Array.from({ length: 400 }, (_, i) => [Math.cos(i), Math.sin(i)]);
    const r = persistentHomology(many, { maxDim: 1 });
    expect(r.capped).toBeTruthy();
    expect(r.capped).toMatch(/reported limit, not a silent truncation/);
    expect(r.points).toBeLessThanOrEqual(150);
    expect(r.caveats.some((c) => /capped|cap/i.test(c))).toBe(true);
  });
  it("fewer than two points is refused", () => {
    expect(() => persistentHomology([[0, 0]], {})).toThrow(/at least two points/);
  });
});

describe("input parsing", () => {
  it("reads whitespace and comma separated rows, skipping headers", () => {
    const pts = parsePointCloud("x y\n0 0\n1 1\n2, 3\n\n4 5")!;
    expect(pts).toEqual([[0, 0], [1, 1], [2, 3], [4, 5]]);
  });
  it("works in three dimensions", () => {
    expect(parsePointCloud("0 0 0\n1 2 3")).toEqual([[0, 0, 0], [1, 2, 3]]);
  });
  it("refuses ragged rows, because the metric would be meaningless", () => {
    expect(parsePointCloud("0 0\n1 2 3")).toBeNull();
  });
  it("refuses fewer than two usable rows", () => {
    expect(parsePointCloud("")).toBeNull();
    expect(parsePointCloud("1 2")).toBeNull();
    expect(parsePointCloud("only text here")).toBeNull();
  });
});

describe("the barcode figure", () => {
  it("is a standalone SVG with one path per bar", () => {
    const r = persistentHomology(circle(10, 1, 0), { maxDim: 1 });
    const svg = barcodeSvg(r);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("Persistence barcode");
    expect(svg).toContain("scale (ε)");
    // At least one path per bar, plus axis and ticks.
    expect((svg.match(/<path /g) || []).length).toBeGreaterThanOrEqual(r.pairs.length);
  });
  it("an infinite bar is drawn to the edge with an arrow, never clipped silently", () => {
    const r = persistentHomology(circle(8, 1, 0), { maxDim: 1 });
    expect(r.pairs.some((p) => !Number.isFinite(p.death))).toBe(true);
    const svg = barcodeSvg(r);
    expect(svg).toContain("l6 3 l-6 3"); // the arrowhead
  });
  it("an empty result renders a stated empty state, not a blank box", () => {
    const empty = { ...persistentHomology(circle(4, 1, 0), { maxDim: 1 }), pairs: [] };
    expect(barcodeSvg(empty)).toContain("No persistent features found");
  });
});

describe("the metric", () => {
  it("euclidean works in any dimension and pads shorter vectors", () => {
    expect(euclidean([0, 0], [3, 4])).toBeCloseTo(5, 12);
    expect(euclidean([0, 0, 0], [1, 2, 2])).toBeCloseTo(3, 12);
    expect(euclidean([1], [1, 0, 0])).toBeCloseTo(0, 12);
  });
});
