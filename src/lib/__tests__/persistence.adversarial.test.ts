// Adversarial bug test — persistent homology (persistence.ts).
//
// Run BEFORE shipping, per the deploy rule. Two real defects came out of it:
//
//   1. The essential-class scan rebuilt the pairing key list on every
//      iteration — O(n squared) — which would have crawled at the
//      60,000-simplex cap. `pairedBy` is keyed by the low row, so the check is
//      a direct has().
//   2. Worse, and an honesty defect: when the simplex cap bites BELOW the
//      killing dimension, the answer changes qualitatively rather than losing
//      detail. A loop can only be filled in by a triangle, so a complex cut off
//      at edges makes every loop look immortal. The cap message said only that
//      "bars near the largest scales may be missing", which understated it. It
//      now names exactly which dimensions are unreliable and why.

import { persistentHomology, parsePointCloud, barcodeSvg } from "../persistence";

const ring = (n: number, r = 1) =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

describe("the work stays bounded", () => {
  it("grows without hanging as the point count rises", () => {
    for (const n of [20, 40, 60, 90, 150]) {
      const t0 = Date.now();
      const r = persistentHomology(ring(n), { maxDim: 1 });
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(r.pairs.length).toBeGreaterThan(0);
    }
  });
  it("a request that would explode combinatorially is capped, not attempted", () => {
    // 150 points at maxDim 2 implies ~20 million 3-simplices if built naively.
    const t0 = Date.now();
    const r = persistentHomology(ring(150), { maxDim: 2 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.capped).toBeTruthy();
  });
});

describe("a cap below the killing dimension is reported as UNRELIABLE, not merely incomplete", () => {
  it("names the affected dimension when triangles were never built", () => {
    const r = persistentHomology(ring(150), { maxDim: 1 });
    expect(r.capped).toBeTruthy();
    expect(r.capped).toMatch(/NOT RELIABLE/);
    expect(r.capped).toMatch(/H1/);
    expect(r.capped).toMatch(/appear to live forever/);
    expect(r.cells[2] ?? 0).toBe(0); // no triangles, which is the whole point
  });
  it("names every affected dimension when several are cut off", () => {
    const r = persistentHomology(ring(150), { maxDim: 2 });
    expect(r.capped).toMatch(/H1, H2 are NOT RELIABLE/);
  });
  it("does NOT cry wolf when the killing dimension was completed", () => {
    const r = persistentHomology(ring(20), { maxDim: 1 });
    expect(r.capped).toBeFalsy();
    expect(r.cells[2]).toBeGreaterThan(0);
  });
  it("the cap always reaches the caveats, never only the internal field", () => {
    const r = persistentHomology(ring(150), { maxDim: 1 });
    expect(r.caveats.some((c) => /NOT RELIABLE/.test(c))).toBe(true);
  });
});

describe("degenerate clouds produce well-formed output, never malformed bars", () => {
  const CASES: [string, number[][]][] = [
    ["two identical points", [[0, 0], [0, 0]]],
    ["ten identical points", Array.from({ length: 10 }, () => [1, 1])],
    ["collinear", Array.from({ length: 8 }, (_, i) => [i, 0])],
    ["one-dimensional data", Array.from({ length: 8 }, (_, i) => [i * 0.5])],
    ["five-dimensional data", Array.from({ length: 8 }, (_, i) => [i, i, i, i, i])],
    ["two points very far apart", [[0, 0], [1e6, 1e6]]],
    ["tiny scale", Array.from({ length: 6 }, (_, i) => [1e-9 * Math.cos(i), 1e-9 * Math.sin(i)])],
    ["huge scale", Array.from({ length: 6 }, (_, i) => [1e9 * Math.cos(i), 1e9 * Math.sin(i)])],
    ["duplicated ring points", [...ring(6), [1, 0], [1, 0]]],
  ];
  for (const [name, pts] of CASES) {
    it(`${name}: every bar has death > birth and exactly one essential component`, () => {
      const r = persistentHomology(pts, { maxDim: 1 });
      for (const p of r.pairs) {
        expect(p.death).toBeGreaterThan(p.birth);
        expect(Number.isNaN(p.birth)).toBe(false);
        expect(Number.isNaN(p.persistence)).toBe(false);
      }
      const essential0 = r.pairs.filter((p) => p.dimension === 0 && !Number.isFinite(p.death));
      expect(essential0.length).toBe(1);
    });
  }
});

describe("the H0 invariant — a hard structural check", () => {
  it("H0 bars always number exactly the point count", () => {
    for (const n of [5, 10, 20, 33]) {
      const pts = Array.from({ length: n }, (_, i) => [Math.cos(i * 1.7), Math.sin(i * 2.3)]);
      const r = persistentHomology(pts, { maxDim: 1 });
      const h0 = r.pairs.filter((p) => p.dimension === 0);
      expect(`n=${n}: ${h0.length}`).toBe(`n=${n}: ${n}`);
    }
  });
});

describe("the figure never emits nonsense", () => {
  it("stays well-formed and free of NaN for small and odd inputs", () => {
    for (const n of [2, 3, 8, 20]) {
      const svg = barcodeSvg(persistentHomology(ring(n), { maxDim: 1 }));
      expect((svg.match(/<svg/g) || []).length).toBe(1);
      expect((svg.match(/<\/svg>/g) || []).length).toBe(1);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe("the parser refuses what it cannot use", () => {
  it("rejects empty, single-row, ragged and non-numeric input", () => {
    for (const s of ["", "   ", "abc", "1", "1 2", "1 2 3\n4 5", "NaN NaN\n1 2"]) {
      expect(`${JSON.stringify(s)}: ${parsePointCloud(s) === null ? "null" : "parsed"}`)
        .toBe(`${JSON.stringify(s)}: null`);
    }
  });
  it("accepts the shapes people actually paste", () => {
    expect(parsePointCloud("1 2\n3 4")).toEqual([[1, 2], [3, 4]]);
    expect(parsePointCloud("1,2\n3,4")).toEqual([[1, 2], [3, 4]]);
    expect(parsePointCloud("x y\n1 2\n\n3 4\n")).toEqual([[1, 2], [3, 4]]);
  });
});
