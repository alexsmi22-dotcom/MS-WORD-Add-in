// Persistent homology over 𝔽p (persistence.ts, v2.139.0) — the §D acceptance
// audit of docs/SCOPE-NUMERICS-TOPOLOGY.md.
//
// ORACLES. Every number pinned here was produced independently by GUDHI 3.13.0
// (RipsComplex, homology_coeff_field = p) and Ripser 0.6.15 (coeff = p), run
// under `python -I` on the SAME clouds this file generates (written at 17
// significant digits). The two oracles agree with each other, and with this
// engine, to < 6e-8 on every bar of every barcode below (Ripser computes in
// float32; GUDHI in double). The brief's tolerance is 1e-6.
//
// THE CLAIM. Going 𝔽₂ → 𝔽₃ the Klein bottle loses exactly one long H1 bar
// (H₁ = ℤ ⊕ ℤ/2), the torus loses none, and ℝP² loses its only one (H₁ = ℤ/2).
// That is the whole point of a second field, and the torsion line must say it.

import {
  persistentHomology, parsePersistenceRequest, parseFieldSpec, homologyOverField,
  barcodeSvg, euclidean, _internals, MAX_PRIME,
  type PersistencePair, type PersistenceResult,
} from "../persistence";
// Type-only: this suite never LOADS homology.ts (another builder owns it and
// it may be mid-edit); the triangulations are rebuilt here and the integral
// homology is given as the cited result, so the two routes stay independent.
import type { HomologyResult } from "../homology";

/** A surface from an a×b grid of squares, each split into two triangles; `twist` glues one pair of sides reversed (Klein bottle). */
function gridSurface(a: number, b: number, twist: boolean): number[][] {
  const id = (i: number, j: number) => {
    let jj = j;
    if (i >= a && twist) jj = b - j;
    return (i % a) * b + (((jj % b) + b) % b);
  };
  const out: number[][] = [];
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      out.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)]);
      out.push([id(i, j), id(i, j + 1), id(i + 1, j + 1)]);
    }
  }
  return out;
}
/** The 6-vertex ℝP² (hemi-icosahedron). */
const RP2_6 = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 1], [1, 2, 4], [2, 3, 5], [3, 4, 1], [4, 5, 2], [5, 1, 3]];
const TRIANGULATIONS: Record<string, number[][]> = {
  klein: gridSurface(4, 4, true),
  torus: gridSurface(4, 4, false),
  rp2: RP2_6,
};
/** Every face of the maximal simplices, by dimension, deduplicated. */
function facesByDim(maximal: number[][]): number[][][] {
  const byDim: Map<string, number[]>[] = [new Map(), new Map(), new Map()];
  for (const raw of maximal) {
    const s = [...raw].sort((x, y) => x - y);
    for (let mask = 1; mask < 1 << s.length; mask++) {
      const f = s.filter((_, i) => mask & (1 << i));
      byDim[f.length - 1].set(f.join(","), f);
    }
  }
  return byDim.map((m) => [...m.values()]);
}
/** The cited integral homology as a HomologyResult (only betti/torsion are read). */
const integral = (betti: number[], torsion: number[][]): HomologyResult => ({
  cells: [], betti, torsion: torsion.map((ts) => ts.map((t) => BigInt(t))), groups: [], dimension: betti.length - 1,
  euler: 0, eulerFromBetti: 0, eulerAgrees: true, connected: true, steps: [], caveats: [],
});
const INTEGRAL: Record<string, HomologyResult> = {
  klein: integral([1, 1, 0], [[], [2], []]), // ℤ, ℤ ⊕ ℤ/2, 0
  rp2: integral([1, 0, 0], [[], [2], []]),   // ℤ, ℤ/2, 0
  torus: integral([1, 2, 1], [[], [], []]),  // ℤ, ℤ², ℤ
};

// --- The §D clouds, exactly as the brief states the generators ---------------
const PHI = (1 + Math.sqrt(5)) / 2;
const frac = (x: number) => x - Math.floor(x);
function klein150(N = 150, a = 2, b = 1): number[][] {
  return Array.from({ length: N }, (_, k) => {
    const u = (2 * Math.PI * k) / N, v = 2 * Math.PI * frac(k * PHI);
    return [(a + b * Math.cos(v)) * Math.cos(u), (a + b * Math.cos(v)) * Math.sin(u),
      b * Math.sin(v) * Math.cos(u / 2), b * Math.sin(v) * Math.sin(u / 2)];
  });
}
function torus150(N = 150, a = 2, b = 1): number[][] {
  return Array.from({ length: N }, (_, k) => {
    const u = (2 * Math.PI * k) / N, v = 2 * Math.PI * frac(k * PHI);
    return [(a + b * Math.cos(v)) * Math.cos(u), (a + b * Math.cos(v)) * Math.sin(u), b * Math.sin(v), 0];
  });
}
function rp2_120(n = 120): number[][] {
  return Array.from({ length: n }, (_, k) => {
    const z = 1 - (k + 0.5) / n, r = Math.sqrt(1 - z * z), th = (2 * Math.PI * k) / PHI;
    const x = r * Math.cos(th), y = r * Math.sin(th);
    return [x * x - y * y, x * y, x * z, y * z];
  });
}
const CLOUDS: Record<string, () => number[][]> = { klein150, torus150, rp2_120 };

// Each cloud is computed once per field and shared (the engine is ~0.2–1 s each).
const cache = new Map<string, PersistenceResult>();
const run = (name: string, p: number): PersistenceResult => {
  const key = `${name}/${p}`;
  if (!cache.has(key)) cache.set(key, persistentHomology(CLOUDS[name](), { maxDim: 1, p }));
  return cache.get(key)!;
};

const lengthOf = (r: PersistenceResult, q: PersistencePair) =>
  q.death === null ? r.scaleUsed - q.birth : (q.persistence as number);
const longH1 = (r: PersistenceResult) =>
  r.pairs.filter((q) => q.dimension === 1 && lengthOf(r, q) > 0.25)
    .map((q) => [q.birth, q.death as number])
    .sort((a, b) => a[0] - b[0]);
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

describe("§D projected scale — chosen BEFORE building, matching the brief", () => {
  // [cloud, diameter, enclosing radius, s*, cells at s*]
  const ROWS: [string, number, number, number, number][] = [
    ["klein150", 5.991464, 3.994141, 2.400447, 59990],
    ["torus150", 5.992899, 3.994141, 2.408707, 59981],
    ["rp2_120", 1.973097, 1.006884, 0.924311, 59988],
  ];
  for (const [name, diam, renc, sstar, cells] of ROWS) {
    it(`${name}: diameter ${diam}, enclosing radius ${renc}, s* ${sstar}, ${cells} cells`, () => {
      const r = run(name, 2);
      expect(near(r.diameter, diam)).toBe(true);
      expect(near(r.enclosingRadius, renc)).toBe(true);
      expect(near(r.scaleUsed, sstar)).toBe(true);
      expect(r.scaleSource).toBe("projected simplex cap");
      expect(r.cells.reduce((a, b) => a + b, 0)).toBe(cells);
      // The cap can no longer bite mid-dimension on this route.
      expect(r.capped ?? "").not.toMatch(/NOT RELIABLE/);
      expect(r.cells[2]).toBeGreaterThan(50000);
      // Said, in words.
      expect(r.steps.join(" ")).toMatch(/chosen automatically before building/);
    });
  }
});

describe("§D barcodes against GUDHI/Ripser, over 𝔽₂, 𝔽₃, 𝔽₅, 𝔽₇", () => {
  // GUDHI fingerprints of the FULL barcode (every bar, all lengths):
  // [cloud, p, dim, bars, essential, Σ birth, Σ finite death, Σ (finite persistence)²]
  const FP: [string, number, number, number, number, number, number, number][] = [
    ["klein150", 2, 0, 150, 1, 0, 98.248174922, 66.676367706],
    ["klein150", 2, 1, 121, 0, 95.915162316, 108.920009831, 4.112801871],
    ["klein150", 3, 0, 150, 1, 0, 98.248174922, 66.676367706],
    ["klein150", 3, 1, 121, 0, 95.915162316, 108.109075642, 3.089830092],
    ["klein150", 5, 0, 150, 1, 0, 98.248174922, 66.676367706],
    ["klein150", 5, 1, 121, 0, 95.915162316, 108.109075642, 3.089830092],
    ["klein150", 7, 0, 150, 1, 0, 98.248174922, 66.676367706],
    ["klein150", 7, 1, 121, 0, 95.915162316, 108.109075642, 3.089830092],
    ["torus150", 2, 0, 150, 1, 0, 96.940258086, 65.128188174],
    ["torus150", 2, 1, 119, 0, 93.730276834, 106.706287391, 4.157026993],
    ["torus150", 3, 0, 150, 1, 0, 96.940258086, 65.128188174],
    ["torus150", 3, 1, 119, 0, 93.730276834, 106.706287391, 4.157026993],
    ["torus150", 5, 0, 150, 1, 0, 96.940258086, 65.128188174],
    ["torus150", 5, 1, 119, 0, 93.730276834, 106.706287391, 4.157026993],
    ["torus150", 7, 0, 150, 1, 0, 96.940258086, 65.128188174],
    ["torus150", 7, 1, 119, 0, 93.730276834, 106.706287391, 4.157026993],
    ["rp2_120", 2, 0, 120, 1, 0, 25.496134787, 5.560883542],
    ["rp2_120", 2, 1, 76, 0, 20.964303961, 25.14288176, 0.355136713],
    ["rp2_120", 3, 0, 120, 1, 0, 25.496134787, 5.560883542],
    ["rp2_120", 3, 1, 76, 0, 20.964303961, 25.039338601, 0.307557568],
    ["rp2_120", 5, 0, 120, 1, 0, 25.496134787, 5.560883542],
    ["rp2_120", 5, 1, 76, 0, 20.964303961, 25.039338601, 0.307557568],
    ["rp2_120", 7, 0, 120, 1, 0, 25.496134787, 5.560883542],
    ["rp2_120", 7, 1, 76, 0, 20.964303961, 25.039338601, 0.307557568],
  ];
  for (const [name, p, dim, bars, ess, sb, sd, sq] of FP) {
    it(`${name} over 𝔽${p}, H${dim}: ${bars} bars (${ess} essential) and the GUDHI sums`, () => {
      const r = run(name, p);
      const qs = r.pairs.filter((q) => q.dimension === dim);
      const fin = qs.filter((q): q is PersistencePair & { death: number } => q.death !== null && Number.isFinite(q.death));
      expect(`${qs.length} bars, ${qs.filter((q) => q.death === Infinity).length} essential, ${r.censored} censored`)
        .toBe(`${bars} bars, ${ess} essential, 0 censored`);
      expect(near(qs.reduce((a, q) => a + q.birth, 0), sb)).toBe(true);
      expect(near(fin.reduce((a, q) => a + q.death, 0), sd)).toBe(true);
      expect(near(fin.reduce((a, q) => a + (q.death - q.birth) ** 2, 0), sq)).toBe(true);
    });
  }

  // The brief's table: H1 bars with persistence > 0.25 at s*.
  const LONG: Record<string, { f2: number[][]; fp: number[][] }> = {
    klein150: {
      f2: [[0.590549, 1.828497], [0.745408, 1.025236], [0.82902, 1.865224]],
      fp: [[0.590549, 1.828497], [0.745408, 1.025236]],
    },
    torus150: {
      f2: [[0.58951, 1.828628], [0.730548, 1.005034], [0.827, 1.865291]],
      fp: [[0.58951, 1.828628], [0.730548, 1.005034], [0.827, 1.865291]],
    },
    rp2_120: { f2: [[0.25193, 0.533457]], fp: [] },
  };
  for (const name of Object.keys(LONG)) {
    for (const p of [2, 3, 5, 7]) {
      it(`${name} over 𝔽${p}: the long H1 bars are exactly the brief's`, () => {
        const want = p === 2 ? LONG[name].f2 : LONG[name].fp;
        const got = longH1(run(name, p));
        expect(got.length).toBe(want.length);
        got.forEach(([b, d], i) => {
          expect(near(b, want[i][0])).toBe(true);
          expect(near(d, want[i][1])).toBe(true);
        });
      });
    }
  }
});

describe("the distinction the release exists for", () => {
  const lost = (name: string) => longH1(run(name, 2)).length - longH1(run(name, 3)).length;
  it("𝔽₂ → 𝔽₃: the Klein bottle loses exactly one long H1 bar", () => expect(lost("klein150")).toBe(1));
  it("𝔽₂ → 𝔽₃: the torus loses none", () => expect(lost("torus150")).toBe(0));
  it("𝔽₂ → 𝔽₃: ℝP² loses its only one", () => {
    expect(longH1(run("rp2_120", 2)).length).toBe(1);
    expect(longH1(run("rp2_120", 3)).length).toBe(0);
  });
  it("the torsion line FIRES for the Klein bottle, naming 2-torsion in H1 in words", () => {
    const r = run("klein150", 3);
    expect(r.torsion.length).toBe(1);
    expect(r.torsion[0]).toMatch(/present over 𝔽₂ and absent over 𝔽₃/);
    expect(r.torsion[0]).toMatch(/evidence of 2-torsion in H₁ \(H₀ is always free\)/);
    expect(r.torsion[0]).toMatch(/0\.82902/);
    expect(r.torsion[0]).toMatch(/universal coefficients/);
    expect(r.torsion[0]).toMatch(/evidence, not proof/);
    expect(r.caveats).toContain(r.torsion[0]);
  });
  it("the torsion line FIRES for ℝP²", () => {
    const r = run("rp2_120", 3);
    expect(r.torsion.length).toBe(1);
    expect(r.torsion[0]).toMatch(/0\.25193/);
    expect(r.torsion[0]).toMatch(/2-torsion/);
  });
  it("the torsion line is SILENT for the torus, and says why in the steps", () => {
    const r = run("torus150", 3);
    expect(r.torsion).toEqual([]);
    expect(r.steps.join(" ")).toMatch(/no long bar differs/);
  });
  it("every field ≠ 2 carries the 𝔽₂ comparison on the same filtration", () => {
    for (const p of [3, 5, 7]) {
      const r = run("klein150", p);
      expect(r.field).toBe(p);
      expect(r.comparison!.field).toBe(2);
      expect(longH1({ ...r, pairs: r.comparison!.pairs })).toEqual(longH1(run("klein150", 2)));
    }
  });
  it("over 𝔽₂ there is no comparison and no torsion claim", () => {
    const r = run("klein150", 2);
    expect(r.comparison).toBeUndefined();
    expect(r.torsion).toEqual([]);
  });
});

describe("the pane's paste, end to end: the same text with no header gives the 𝔽₂ column", () => {
  const text = (pts: number[][]) => pts.map((r) => r.map((v) => v.toPrecision(17)).join(" ")).join("\n");
  it("klein150 pasted with no header: 𝔽₂, auto scale, three long H1 bars — not 'NOT RELIABLE'", () => {
    const req = parsePersistenceRequest(text(klein150()));
    expect(req && req.ok).toBe(true);
    if (!req || !req.ok) return;
    expect(req.p).toBe(2);
    expect(req.maxScale).toBeUndefined();
    const r = persistentHomology(req.cloud, { maxDim: req.maxDim, p: req.p, maxScale: req.maxScale });
    expect(r.field).toBe(2);
    expect(longH1(r).length).toBe(3);
    expect(r.caveats.join(" ")).not.toMatch(/NOT RELIABLE/);
  });
  it("the same text under 'over F3' gives the 𝔽₃ column and the torsion line", () => {
    const req = parsePersistenceRequest("over F3\n" + text(klein150()));
    if (!req || !req.ok) throw new Error("expected a request");
    expect(req.p).toBe(3);
    const r = persistentHomology(req.cloud, { maxDim: req.maxDim, p: req.p });
    expect(longH1(r).length).toBe(2);
    expect(r.torsion.length).toBe(1);
  });
  it("BEFORE-pin: the old default (grow to the diameter) still hits the guard — now only when a user asks for it", () => {
    const pts = klein150();
    let diam = 0;
    for (const a of pts) for (const b of pts) diam = Math.max(diam, euclidean(a, b));
    const r = persistentHomology(pts, { maxDim: 1, maxScale: diam });
    expect(r.scaleSource).toBe("user");
    expect(r.capped).toMatch(/NOT RELIABLE/);
    expect(r.cells[2] ?? 0).toBe(0);
  });
});

describe("𝔽₂ is unchanged: the v2.33 path, twinned against a verbatim copy of the old reduction", () => {
  // The OLD reduce (persistence.ts before v2.139.0), copied verbatim. It
  // reported every unpaired column as an infinite bar in EVERY dimension —
  // including top-dimension cycles nobody asked for (the defect fixed here) —
  // so the twin compares dimensions ≤ maxDim, and "infinite" there with the
  // new engine's essential-or-censored.
  type OldPair = { dimension: number; birth: number; death: number; persistence: number };
  type S = { verts: number[]; dim: number; birth: number };
  function oldReduce(simplices: S[]): OldPair[] {
    const n = simplices.length;
    const index = new Map<string, number>();
    simplices.forEach((s, i) => index.set(s.verts.join(","), i));
    const cols: Set<number>[] = simplices.map((s) => {
      const col = new Set<number>();
      if (s.dim === 0) return col;
      for (let k = 0; k < s.verts.length; k++) {
        const face = s.verts.filter((_, m) => m !== k);
        const fi = index.get(face.join(","));
        if (fi !== undefined) col.add(fi);
      }
      return col;
    });
    const lowOf = (c: Set<number>): number => { let mx = -1; for (const v of c) if (v > mx) mx = v; return mx; };
    const pairedBy = new Map<number, number>();
    const pairs: OldPair[] = [];
    const isKiller = new Array<boolean>(n).fill(false);
    for (let j = 0; j < n; j++) {
      let low = lowOf(cols[j]);
      while (low >= 0 && pairedBy.has(low)) {
        const j2 = pairedBy.get(low)!;
        for (const v of cols[j2]) { if (cols[j].has(v)) cols[j].delete(v); else cols[j].add(v); }
        low = lowOf(cols[j]);
      }
      if (low >= 0) {
        pairedBy.set(low, j);
        isKiller[j] = true;
        const birth = simplices[low].birth;
        const death = simplices[j].birth;
        if (death > birth) pairs.push({ dimension: simplices[low].dim, birth, death, persistence: death - birth });
      }
    }
    for (let j = 0; j < n; j++) {
      if (isKiller[j] || cols[j].size > 0) continue;
      if (!pairedBy.has(j)) pairs.push({ dimension: simplices[j].dim, birth: simplices[j].birth, death: Infinity, persistence: Infinity });
    }
    return pairs;
  }
  function oldEngine(points: number[][], maxDim: number, maxScale: number): OldPair[] {
    const m = points.length;
    const dist = points.map((a) => points.map((b) => euclidean(a, b)));
    const simplices: S[] = [];
    for (let i = 0; i < m; i++) simplices.push({ verts: [i], dim: 0, birth: 0 });
    let prev: S[] = [];
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (dist[i][j] <= maxScale) prev.push({ verts: [i, j], dim: 1, birth: dist[i][j] });
    simplices.push(...prev);
    for (let d = 2; d <= maxDim + 1; d++) {
      const next: S[] = [];
      for (const s of prev) {
        for (let v = s.verts[s.verts.length - 1] + 1; v < m; v++) {
          let birth = s.birth, ok = true;
          for (const u of s.verts) { if (dist[u][v] > maxScale) { ok = false; break; } if (dist[u][v] > birth) birth = dist[u][v]; }
          if (ok) next.push({ verts: [...s.verts, v], dim: d, birth });
        }
      }
      simplices.push(...next);
      prev = next;
    }
    simplices.sort((a, b) => a.birth - b.birth || a.dim - b.dim || a.verts.length - b.verts.length);
    return oldReduce(simplices);
  }
  // EXACT: births and deaths are the same float distances on both sides, so
  // String(x) (shortest round-trip) makes this bit-for-bit, not 15 digits.
  const canon = (qs: { dimension: number; birth: number; death: number | null }[], maxDim: number) =>
    qs.filter((q) => q.dimension <= maxDim)
      .map((q) => `${q.dimension}:${String(q.birth)}:${q.death === null || !Number.isFinite(q.death) ? "alive" : String(q.death)}`)
      .sort();
  const ring = (n: number) => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blob = Array.from({ length: 40 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd()]);
  const CASES: [string, number[][], number, number][] = [
    ["ring24 at its diameter", ring(24), 1, 2],
    ["40-point blob at 0.9", blob, 1, 0.9],
    ["40-point blob, H2, at 0.7", blob, 2, 0.7],
    ["klein150 at 2.0 (the §A twin)", klein150(), 1, 2],
    ["rp2_120 at 0.8", rp2_120(), 1, 0.8],
  ];
  for (const [name, pts, maxDim, scale] of CASES) {
    it(`${name}: identical bars, p = 2`, () => {
      const r = persistentHomology(pts, { maxDim, maxScale: scale });
      expect(r.field).toBe(2);
      expect(canon(r.pairs, maxDim)).toEqual(canon(oldEngine(pts, maxDim, scale), maxDim));
    });
  }
  it("the production route at the AUTOMATIC scale equals the old engine there too (klein150 s*, and ring150 s* with a censored loop)", () => {
    for (const pts of [klein150(), ring(150)]) {
      const r = persistentHomology(pts, { maxDim: 1 });
      expect(r.scaleSource).toBe("projected simplex cap");
      expect(canon(r.pairs, 1)).toEqual(canon(oldEngine(pts, 1, r.scaleUsed), 1));
    }
  });
  it("the §A RIGHT pin: klein150 at scale 2 → (0.590549, 1.828497), (0.82902, 1.865224), (0.745408, 1.025236)", () => {
    const r = persistentHomology(klein150(), { maxDim: 1, maxScale: 2 });
    const got = longH1(r);
    const want = [[0.590549, 1.828497], [0.745408, 1.025236], [0.82902, 1.865224]];
    expect(got.length).toBe(3);
    got.forEach(([b, d], i) => { expect(near(b, want[i][0])).toBe(true); expect(near(d, want[i][1])).toBe(true); });
  });
  it("DEFECT FIXED: no bar is reported above maxDim (the old engine listed 1 771 'essential' H2 bars for a 24-point ring)", () => {
    const old = oldEngine(ring(24), 1, 2);
    expect(old.filter((q) => q.dimension === 2).length).toBe(1771);
    const r = persistentHomology(ring(24), { maxDim: 1 });
    expect(r.pairs.every((q) => q.dimension <= 1)).toBe(true);
  });
});

describe("three reductions, one pairing", () => {
  type S = { verts: number[]; dim: number; birth: number };
  function filtration(points: number[][], top: number, scale: number): S[] {
    const m = points.length;
    const dist = points.map((a) => points.map((b) => euclidean(a, b)));
    const out: S[] = [];
    for (let i = 0; i < m; i++) out.push({ verts: [i], dim: 0, birth: 0 });
    let prev: S[] = [];
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (dist[i][j] <= scale) prev.push({ verts: [i, j], dim: 1, birth: dist[i][j] });
    out.push(...prev);
    for (let d = 2; d <= top; d++) {
      const next: S[] = [];
      for (const s of prev) for (let v = s.verts[s.verts.length - 1] + 1; v < m; v++) {
        if (s.verts.every((u) => dist[u][v] <= scale)) next.push({ verts: [...s.verts, v], dim: d, birth: Math.max(s.birth, ...s.verts.map((u) => dist[u][v])) });
      }
      out.push(...next);
      prev = next;
    }
    return out.sort((a, b) => a.birth - b.birth || a.dim - b.dim);
  }
  let seed = 99;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const clouds = [0, 1, 2].map((k) => Array.from({ length: 22 + 4 * k }, () => [rnd(), rnd(), rnd()]));
  // Pairs below the top dimension (top cycles are unreported, and the early
  // exit legitimately leaves them unvisited).
  const pairsBelowTop = (S: S[], low: Int32Array, top: number) => {
    const out: string[] = [];
    low.forEach((L, j) => { if (L >= 0 && S[L].dim < top) out.push(`${L}>${j}`); });
    return out.sort();
  };
  for (const p of [2, 3, 5, 7, MAX_PRIME]) {
    it(`𝔽${p}: homology (signed), cohomology (cleared) and the 𝔽₂ set path agree pair for pair`, () => {
      for (const pts of clouds) {
        for (const top of [2, 3]) {
          const S = filtration(pts, top, 0.6);
          const a = pairsBelowTop(S, _internals.reduceFp(S, p).low, top);
          const b = pairsBelowTop(S, _internals.reduceCohomology(S, p).low, top);
          expect(b).toEqual(a);
          if (p === 2) expect(pairsBelowTop(S, _internals.reduceF2(S).low, top)).toEqual(a);
        }
      }
    });
  }
  it("∂∘∂ = 0 (mod p) on a built filtration — the signs are right", () => {
    const S = filtration(clouds[1], 3, 0.7);
    for (const p of [3, 5, 7, MAX_PRIME]) {
      const cols = _internals.signedBoundary(S, p);
      let checked = 0;
      for (let j = 0; j < S.length; j++) {
        if (S[j].dim < 2) continue;
        const acc = new Map<number, number>();
        cols[j].rows.forEach((r, e) => {
          const c = cols[j].vals[e];
          cols[r].rows.forEach((r2, e2) => acc.set(r2, ((acc.get(r2) ?? 0) + c * cols[r].vals[e2]) % p));
        });
        for (const v of acc.values()) expect(v % p).toBe(0);
        checked++;
      }
      expect(checked).toBeGreaterThan(100);
    }
  });
  it("modular inverses are inverses, up to the cap", () => {
    for (const p of [3, 5, 7, 101, MAX_PRIME]) {
      for (const a of [1, 2, p - 1, Math.floor(p / 2)]) expect((a * _internals.modInverse(a, p)) % p).toBe(1);
    }
  });
});

describe("𝔽p simplicial homology by universal coefficients — and the reduction as its second route", () => {
  const WANT: [string, number, number[]][] = [
    ["klein", 2, [1, 2, 1]], ["klein", 3, [1, 1, 0]],
    ["rp2", 2, [1, 1, 1]], ["rp2", 3, [1, 0, 0]],
    ["torus", 2, [1, 2, 1]], ["torus", 3, [1, 2, 1]], ["torus", 5, [1, 2, 1]],
  ];
  it("the test triangulations are closed surfaces (every edge in exactly two triangles; χ = 0, 0, 1)", () => {
    for (const [name, chi] of [["klein", 0], ["torus", 0], ["rp2", 1]] as [string, number][]) {
      const f = facesByDim(TRIANGULATIONS[name]);
      expect(f[0].length - f[1].length + f[2].length).toBe(chi);
      const uses = new Map<string, number>();
      for (const t of f[2]) for (const [x, y] of [[t[0], t[1]], [t[0], t[2]], [t[1], t[2]]]) uses.set(`${x},${y}`, (uses.get(`${x},${y}`) ?? 0) + 1);
      expect([...uses.values()].every((u) => u === 2)).toBe(true);
    }
  });
  for (const [name, p, betti] of WANT) {
    it(`${name} over 𝔽${p}: ${betti.join(", ")} by UCT`, () => {
      const f = homologyOverField(INTEGRAL[name], p);
      expect(f.betti).toEqual(betti);
      expect(f.p).toBe(p);
    });
    it(`${name} over 𝔽${p}: the reduction with every simplex at birth 0 leaves exactly ${betti.join(", ")} essential classes`, () => {
      const byDim = facesByDim(TRIANGULATIONS[name]);
      const S = byDim.flatMap((faces, d) => faces.map((verts) => ({ verts, dim: d, birth: 0 })));
      for (const red of [_internals.reduceFp(S, p), _internals.reduceCohomology(S, p)]) {
        const alive = [0, 0, 0];
        S.forEach((s, j) => { if (red.low[j] < 0 && !red.claimed[j]) alive[s.dim]++; });
        expect(alive).toEqual(betti);
      }
    });
  }
  it("the groups and the steps say where each 𝔽p comes from", () => {
    const f = homologyOverField(INTEGRAL.klein, 2);
    expect(f.groups).toEqual(["𝔽₂", "𝔽₂²", "𝔽₂"]);
    expect(f.steps.join(" ")).toMatch(/ℤ\/2 ⊗ 𝔽₂/);
    expect(f.steps.join(" ")).toMatch(/Tor\(ℤ\/2, 𝔽₂\)/);
    expect(homologyOverField(INTEGRAL.rp2, 3).groups).toEqual(["𝔽₃", "0", "0"]);
  });
  it("it only READS the integral result — the input is not modified", () => {
    const before = JSON.stringify(INTEGRAL.klein, (_, v) => (typeof v === "bigint" ? String(v) : v));
    homologyOverField(INTEGRAL.klein, 2);
    expect(JSON.stringify(INTEGRAL.klein, (_, v) => (typeof v === "bigint" ? String(v) : v))).toBe(before);
  });
  it("ℤ/6 torsion is seen by both 𝔽₂ and 𝔽₃, ℤ/4 by 𝔽₂ only", () => {
    const h = integral([1, 0, 0], [[], [6, 4], []]);
    expect(homologyOverField(h, 2).betti).toEqual([1, 2, 2]);
    expect(homologyOverField(h, 3).betti).toEqual([1, 1, 1]);
    expect(homologyOverField(h, 5).betti).toEqual([1, 0, 0]);
  });
  it("refuses a field that is not admissible, by name", () => {
    const h = INTEGRAL.klein;
    expect(() => homologyOverField(h, 4)).toThrow(/no field with 4 elements|not a field|𝔽₄/);
    expect(() => homologyOverField(h, 9)).toThrow(/𝔽₉ is a field but not ℤ\/9/);
    expect(() => homologyOverField(h, 46349)).toThrow(/above the cap/);
    expect(() => homologyOverField(h, 1)).toThrow(/not a field/);
  });
});

describe("parsePersistenceRequest — header lines are read or REPORTED, never dropped", () => {
  const pts = "0 0\n1 0\n0 1\n1 1";
  const ok = (s: string) => {
    const r = parsePersistenceRequest(s);
    if (!r || !r.ok) throw new Error(`expected a request for ${JSON.stringify(s)}: ${JSON.stringify(r)}`);
    return r;
  };
  const err = (s: string) => {
    const r = parsePersistenceRequest(s);
    if (!r || r.ok) throw new Error(`expected a refusal for ${JSON.stringify(s)}: ${JSON.stringify(r)}`);
    return r.error;
  };
  it("no header: 𝔽₂, H0–H1, no scale, nothing ignored", () => {
    expect(ok(pts)).toMatchObject({ p: 2, maxDim: 1, compare: false, ignored: [], maxScale: undefined });
    expect(ok(pts).cloud).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });
  it.each([
    ["over F3", 3], ["over 𝔽₃", 3], ["over f5", 5], ["mod 3", 3], ["coefficients Z/3", 3], ["coefficients in F7", 7],
    ["field 5", 5], ["with Z/3 coefficients", 3], ["F3", 3], ["over GF(5)", 5], ["over Z_7", 7], ["over Z/3Z", 3],
    ["over ℤ/3", 3], ["over F2", 2],
  ])("%s → p = %d", (h, p) => {
    expect(ok(`${h}\n${pts}`).p).toBe(p);
  });
  it("scale, dimension and compare headers", () => {
    expect(ok(`scale 2\n${pts}`).maxScale).toBe(2);
    expect(ok(`max scale 0.5\n${pts}`).maxScale).toBe(0.5);
    expect(ok(`H2\n${pts}`).maxDim).toBe(2);
    expect(ok(`dimension 2\n${pts}`).maxDim).toBe(2);
    expect(ok(`compare\n${pts}`).compare).toBe(true);
    const all = ok(`over F5, scale 1.5, H2, compare\n${pts}`);
    expect(all).toMatchObject({ p: 5, maxScale: 1.5, maxDim: 2, compare: true });
    expect(all.read.join(" ")).toMatch(/𝔽₅/);
  });
  it("headers may sit on ';'-separated pieces too (the pane's one-line form)", () => {
    expect(ok("over F3; 0 0; 1 0; 0 1").p).toBe(3);
  });
  it("an unrecognised letter-led line is REPORTED, not dropped", () => {
    const r = ok(`x y\n${pts}\nmeasured on Tuesday`);
    expect(r.ignored).toEqual(["x y", "measured on Tuesday"]);
  });
  it("refusals by name (§D): mod 4, over Z, over F46349, over F9", () => {
    expect(err(`mod 4\n${pts}`)).toMatch(/ℤ\/4 is not a field — a barcode needs field coefficients/);
    expect(err(`over Z\n${pts}`)).toMatch(/Over ℤ there is no barcode/);
    expect(err(`over Z\n${pts}`)).toMatch(/compare/);
    expect(err(`over F46349\n${pts}`)).toMatch(/46349 is prime but above the cap 46 337/);
    expect(err(`over F9\n${pts}`)).toMatch(/𝔽₉ is a field but not ℤ\/9; only prime fields here/);
    expect(err(`coefficients Z/4\n${pts}`)).toMatch(/not a field/);
    expect(err(`over F6\n${pts}`)).toMatch(/no field with 6 elements/);
    expect(err(`over Q\n${pts}`)).toMatch(/Only the prime fields/);
    expect(err(`H3\n${pts}`)).toMatch(/H₃ is not computed here: persistence runs H₀–H₂/);
    expect(err(`over F3\nover F5\n${pts}`)).toMatch(/Two different fields/);
  });
  it("p = 46 337 is accepted (the largest admissible prime)", () => {
    expect(ok(`over F46337\n${pts}`).p).toBe(46337);
  });
  it("'in' alone needs an explicit modulus: a description like 'points in R^3' is not a field request", () => {
    expect(ok(`points in R^3\n${pts}`)).toMatchObject({ p: 2, ignored: ["points in R^3"] });
    expect(ok(`lattice points in Z^2\n${pts}`).p).toBe(2);
    expect(ok(`coefficients in F3\n${pts}`).p).toBe(3);
  });
  it("U+2212 minus is a minus, never dropped (it used to read −1 as 1)", () => {
    expect(ok("−1 2\n3 −4").cloud).toEqual([[-1, 2], [3, -4]]);
  });
  it("null when the text is not a cloud, so routing falls through", () => {
    expect(parsePersistenceRequest("torus")).toBeNull();
    expect(parsePersistenceRequest("over F3")).toBeNull();
    expect(parsePersistenceRequest("1 2")).toBeNull();
    expect(parsePersistenceRequest("")).toBeNull();
  });
  it("ragged rows are refused by name", () => {
    expect(err("0 0\n1 2 3")).toMatch(/Row 2 of the points has 3 coordinates but row 1 has 2/);
  });
  it("parseFieldSpec on its own (B's homology queries use it)", () => {
    expect(parseFieldSpec("homology of klein bottle over z/3")).toEqual({ ok: true, p: 3 });
    expect(parseFieldSpec("homology of rp2 mod 2")).toEqual({ ok: true, p: 2 });
    expect(parseFieldSpec("… with coefficients in F3")).toEqual({ ok: true, p: 3 });
    expect(parseFieldSpec("homology of the torus")).toBeNull();
    expect(parseFieldSpec("homology of rp2 mod 4")).toMatchObject({ ok: false });
  });
});

describe("censored bars — 'not computed past s' is never drawn as 'never dies'", () => {
  const ring = Array.from({ length: 30 }, (_, i) => [Math.cos((2 * Math.PI * i) / 30), Math.sin((2 * Math.PI * i) / 30)]);
  const r = persistentHomology(ring, { maxDim: 1, maxScale: 1 }); // the loop is still open at 1
  it("a bar alive at a user scale below the enclosing radius is censored: death null, censoredAt the scale", () => {
    const loop = r.pairs.filter((q) => q.dimension === 1);
    expect(loop.length).toBe(1);
    expect(loop[0].death).toBeNull();
    expect(loop[0].persistence).toBeNull();
    expect(loop[0].censoredAt).toBe(1);
    expect(r.censored).toBe(1);
  });
  it("the one surviving component is essential (Infinity), and only it", () => {
    expect(r.pairs.filter((q) => q.death === Infinity).map((q) => q.dimension)).toEqual([0]);
  });
  it("censored bars never reach the headline", () => {
    expect(r.notable.every((q) => Number.isFinite(q.death))).toBe(true);
    expect(r.notable.some((q) => q.dimension === 1)).toBe(false);
  });
  it("the figure draws a dashed end and the '≥ s' note, and no arrow on the censored bar", () => {
    const svg = barcodeSvg(r);
    expect(svg).toContain('stroke-dasharray="2 2"');
    expect(svg).toMatch(/alive at ≥ 1 \(censored\)/);
    expect((svg.match(/l6 3 l-6 3/g) || []).length).toBe(1); // the one essential H0 bar
  });
  it("said in the caveats", () => {
    expect(r.caveats.join(" ")).toMatch(/CENSORED.*Censored is not essential/);
  });
  it("past the enclosing radius nothing is censored", () => {
    const full = persistentHomology(ring, { maxDim: 1 });
    expect(full.scaleSource).toBe("enclosing radius");
    expect(full.censored).toBe(0);
    expect(full.pairs.filter((q) => q.dimension === 1 && Number.isFinite(q.death)).length).toBe(1);
  });
});

describe("the compare figure", () => {
  it("two stacked panels, 𝔽₂ above 𝔽₃, each titled with its field", () => {
    const r = persistentHomology(rp2_120(), { maxDim: 1, compare: true });
    expect(r.field).toBe(3);
    const svg = barcodeSvg(r, 460, 300, { compare: true });
    expect(svg).toMatch(/height="600"/);
    expect(svg).toContain("Persistence barcode over ℤ/2");
    expect(svg).toContain("Persistence barcode over ℤ/3");
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  it("without the option, one panel titled with the field used", () => {
    const svg = barcodeSvg(run("klein150", 3));
    expect(svg).toMatch(/height="300"/);
    expect(svg).toContain("Persistence barcode over ℤ/3");
  });
  it("rows fit inside the frame even with hundreds of bars (no bar crosses the tick labels)", () => {
    const svg = barcodeSvg(run("klein150", 2));
    const ys = [...svg.matchAll(/<path d="M[\d.]+ ([\d.]+) H/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(300 - 40);
  });
});
