// Adversarial bug test — persistence over 𝔽p and the projected scale
// (persistence.ts, v2.139.0). Aimed where the brief (§C, §E) says it breaks:
// non-prime fields, the p cap at 46 337 / 46 349, clouds of exactly 150 and
// 151 points, ties in the filtration, degenerate clouds, and freezes. In a
// task pane an unbounded loop is a FROZEN WORD, so every heavy call carries a
// gross 4 s bound.
//
// Found by this pass and fixed before it was pinned:
//   * `over F99999999999999999999` sent 1e20 into trial division — √n = 10¹⁰
//     iterations in the primality test and again in the prime-power test.
//     The size is now refused BEFORE any division.

import * as fs from "fs";
import * as path from "path";
import {
  persistentHomology, parsePersistenceRequest, parseFieldSpec, barcodeSvg, euclidean, _internals, MAX_PRIME,
} from "../persistence";

const FREEZE_MS = 4000;
const timed = <T>(f: () => T): { value: T; ms: number } => {
  const t0 = Date.now();
  const value = f();
  return { value, ms: Date.now() - t0 };
};

const PHI = (1 + Math.sqrt(5)) / 2;
const frac = (x: number) => x - Math.floor(x);
const klein = (N: number) => Array.from({ length: N }, (_, k) => {
  const u = (2 * Math.PI * k) / N, v = 2 * Math.PI * frac(k * PHI);
  return [(2 + Math.cos(v)) * Math.cos(u), (2 + Math.cos(v)) * Math.sin(u), Math.sin(v) * Math.cos(u / 2), Math.sin(v) * Math.sin(u / 2)];
});
const ring = (n: number) => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)]);
let seed = 12345;
const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

describe("a field that is not an admissible prime is refused BY NAME", () => {
  const CASES: [number, RegExp][] = [
    [4, /𝔽₄ is a field but not ℤ\/4/],
    [9, /𝔽₉ is a field but not ℤ\/9; only prime fields here/],
    [6, /no field with 6 elements/],
    [1, /not a field/],
    [0, /not a field/],
    [-3, /not a field/],
    [2.5, /not a prime/],
    [NaN, /not a prime/],
    [Infinity, /not a prime/],
    [46349, /46349 is prime but above the cap 46 337/],
    [46341, /no field with 46341 elements/], // 46341 = 3² × 19 × 271, just past √2³¹
    [1e20, /far above the cap/],
  ];
  for (const [p, re] of CASES) {
    it(`p = ${p}`, () => {
      const { ms } = timed(() => expect(() => persistentHomology(ring(8), { p })).toThrow(re));
      expect(ms).toBeLessThan(FREEZE_MS);
    });
  }
  it("a 20-digit modulus in a header is refused without trial division (the freeze this pass found)", () => {
    const { value, ms } = timed(() => parsePersistenceRequest("over F99999999999999999999\n0 0\n1 1"));
    expect(ms).toBeLessThan(500);
    expect(value).toMatchObject({ ok: false });
    expect((value as { error: string }).error).toMatch(/far above the cap/);
  });
  it("p = 46 337 is accepted and matches GUDHI on klein150 (121 H1 bars, the 𝔽₃ long bars)", () => {
    const { value: r, ms } = timed(() => persistentHomology(klein(150), { maxDim: 1, p: MAX_PRIME }));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(MAX_PRIME).toBe(46337);
    expect(r.field).toBe(46337);
    const h1 = r.pairs.filter((q) => q.dimension === 1);
    expect(h1.length).toBe(121);
    const sumDeath = h1.reduce((a, q) => a + (q.death as number), 0);
    expect(Math.abs(sumDeath - 108.109075642)).toBeLessThan(1e-6); // GUDHI, homology_coeff_field = 46337
    const long = h1.filter((q) => (q.persistence as number) > 0.25).map((q) => q.birth.toFixed(6)).sort();
    expect(long).toEqual(["0.590549", "0.745408"]);
  });
  it("(p − 1)² < 2³¹ at the cap, so every product survives 32-bit coercion", () => {
    expect((MAX_PRIME - 1) ** 2).toBeLessThan(2 ** 31);
    expect(((MAX_PRIME - 1) ** 2) | 0).toBe((MAX_PRIME - 1) ** 2);
  });
});

describe("p = 2 is the old answer; compare and the default", () => {
  it("omitting p is 𝔽₂, and an explicit p = 2 is identical", () => {
    const a = persistentHomology(ring(30), { maxDim: 1 });
    const b = persistentHomology(ring(30), { maxDim: 1, p: 2 });
    expect(a.field).toBe(2);
    expect(JSON.stringify(b.pairs)).toBe(JSON.stringify(a.pairs));
  });
  it("compare with p = 2 computes over 𝔽₃ against 𝔽₂; compare with p = 5 keeps 5", () => {
    expect(persistentHomology(ring(12), { compare: true }).field).toBe(3);
    const r = persistentHomology(ring(12), { compare: true, p: 5 });
    expect(r.field).toBe(5);
    expect(r.comparison!.field).toBe(2);
  });
  it("the comparison's 𝔽₂ bars equal a separate 𝔽₂ run on the same cloud", () => {
    const pts = klein(90);
    const r3 = persistentHomology(pts, { maxDim: 1, p: 3 });
    const r2 = persistentHomology(pts, { maxDim: 1, p: 2 });
    expect(JSON.stringify(r3.comparison!.pairs)).toBe(JSON.stringify(r2.pairs));
  });
});

describe("300-point clouds and the subsample — under the freeze bound", () => {
  for (const p of [2, 3, 7]) {
    it(`klein(300) over 𝔽${p}: farthest-point subsample to 150, auto scale, < 4 s`, () => {
      const { value: r, ms } = timed(() => persistentHomology(klein(300), { maxDim: 1, p }));
      expect(ms).toBeLessThan(FREEZE_MS);
      expect(r.points).toBe(150);
      expect(r.subsample).toMatchObject({ from: 300, kept: 150 });
      expect(r.subsample!.coveringRadius).toBeGreaterThan(0);
      expect(r.cells.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
      expect(r.caveats.join(" ")).not.toMatch(/NOT RELIABLE/);
    });
  }
  it("the subsample is deterministic, starts from row 0, and really covers the cloud", () => {
    const pts = klein(300);
    const a = _internals.maxminSubsample(pts, 150);
    const b = _internals.maxminSubsample(pts, 150);
    expect(a).toEqual(b);
    expect(a.idx[0]).toBe(0);
    expect(new Set(a.idx).size).toBe(150);
    // Every point within the covering radius of a kept one (and one exactly at it).
    let worst = 0;
    for (const q of pts) worst = Math.max(worst, Math.min(...a.idx.map((i) => euclidean(q, pts[i]))));
    expect(Math.abs(worst - a.coveringRadius)).toBeLessThan(1e-12);
  });
  it("sorted data no longer becomes a strip: the subsample spans the whole cloud (the old first-150-rows did not)", () => {
    const pts = klein(300).sort((x, y) => x[0] - y[0]); // sorted by one coordinate
    const r = persistentHomology(pts, { maxDim: 1 });
    expect(r.subsample!.coveringRadius).toBeLessThan(0.8);
    expect(r.diameter).toBeGreaterThan(5.5); // the full extent survives
  });
  it("exactly 150 points: no subsample; 151: subsampled to 150, said", () => {
    const r150 = persistentHomology(klein(150), { maxDim: 0 });
    expect(r150.subsample).toBeUndefined();
    expect(r150.capped ?? "").not.toMatch(/farthest-point/);
    const r151 = persistentHomology(klein(151), { maxDim: 0 });
    expect(r151.subsample).toMatchObject({ from: 151, kept: 150 });
    expect(r151.capped).toMatch(/farthest-point subsample/);
  });
  it("20 000 rows: subsampled within the bound; 100 001 rows refused by name", () => {
    const big = Array.from({ length: 20000 }, () => [rnd(), rnd(), rnd()]);
    const { ms } = timed(() => persistentHomology(big, { maxDim: 1 }));
    expect(ms).toBeLessThan(FREEZE_MS);
    const huge = Array.from({ length: 100001 }, (_, i) => [i, 0]);
    expect(() => persistentHomology(huge)).toThrow(/100,000-row limit/);
  });
  it("a WIDE paste is bounded by its coordinate count, not just its rows (20 000 × 100 took 8 s before the cap)", () => {
    const wide = Array.from({ length: 20000 }, () => Array.from({ length: 100 }, () => 0.5));
    const { ms } = timed(() => expect(() => persistentHomology(wide)).toThrow(/1,000,000-value limit/));
    expect(ms).toBeLessThan(500);
    const atCap = Array.from({ length: 10000 }, () => Array.from({ length: 100 }, rnd)); // exactly 10⁶ values
    const { ms: ms2 } = timed(() => persistentHomology(atCap, { maxDim: 1 }));
    expect(ms2).toBeLessThan(FREEZE_MS);
  });
  it("300 rows of only 10 distinct points: the subsample stops at 10, and it is said as duplicates, not as a cap", () => {
    const base = Array.from({ length: 10 }, (_, i) => [Math.cos(i), Math.sin(i), i]);
    const rows = Array.from({ length: 300 }, (_, i) => base[i % 10]);
    const r = persistentHomology(rows, { maxDim: 1 });
    expect(r.points).toBe(10);
    expect(r.subsample).toBeUndefined();
    expect(r.capped).toBeUndefined();
    expect(r.steps[0]).toMatch(/290 exact duplicate rows merged/);
  });
  it("ragged rows are refused by the engine (they used to be padded with zeros)", () => {
    expect(() => persistentHomology([[0, 0], [1, 2, 3]])).toThrow(/same number of coordinates/);
  });
  it("the test-only reducers validate p too (p = 0 would never terminate)", () => {
    const S = [{ verts: [0], dim: 0, birth: 0 }, { verts: [1], dim: 0, birth: 0 }, { verts: [0, 1], dim: 1, birth: 1 }];
    expect(() => _internals.reduceFp(S, 0)).toThrow(/not a field/);
    expect(() => _internals.reduceCohomology(S, NaN)).toThrow(/not a prime/);
  });
});

describe("degenerate clouds — well-formed, bounded, honest", () => {
  it("150 identical points: one distinct point, one essential H0 bar, said", () => {
    const pts = Array.from({ length: 150 }, () => [1, 2, 3]);
    const { value: r, ms } = timed(() => persistentHomology(pts, { maxDim: 1 }));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.points).toBe(1);
    expect(r.pairs).toEqual([{ dimension: 0, birth: 0, death: Infinity, persistence: Infinity }]);
    expect(r.steps[0]).toMatch(/149 exact duplicate rows merged/);
  });
  it("150 collinear points: no H1, one component, under the bound", () => {
    const pts = Array.from({ length: 150 }, (_, i) => [i * 0.1, 2 * i * 0.1]);
    const { value: r, ms } = timed(() => persistentHomology(pts, { maxDim: 1, p: 3 }));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.pairs.filter((q) => q.dimension === 1 && q.death !== null && q.persistence! > 1e-9).length).toBe(0);
    expect(r.pairs.filter((q) => q.death === Infinity).length).toBe(1);
  });
  it("a regular simplex (150 points all √2 apart): nothing fits, vertices only, refused in words — not frozen", () => {
    const pts = Array.from({ length: 150 }, (_, i) => Array.from({ length: 150 }, (_, j) => (i === j ? 1 : 0)));
    const { value: r, ms } = timed(() => persistentHomology(pts, { maxDim: 1 }));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.cells).toEqual([150]);
    expect(r.capped).toMatch(/Even the shortest edges/);
    expect(r.pairs.filter((q) => q.death === Infinity).length).toBe(1);
    expect(r.censored).toBe(149);
    // With H0 only the edges DO fit, and the answer is exact.
    const r0 = persistentHomology(pts, { maxDim: 0 });
    expect(r0.scaleSource).toBe("enclosing radius");
    expect(r0.pairs.filter((q) => q.dimension === 0 && q.death !== null && Number.isFinite(q.death)).length).toBe(149);
  });
  it("a lattice full of ties: bars are well formed and the three reductions agree on the tied filtration", () => {
    const grid: number[][] = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) grid.push([i, j]);
    const r = persistentHomology(grid, { maxDim: 1, p: 5 });
    for (const q of r.pairs) if (q.death !== null) expect(q.death).toBeGreaterThan(q.birth);
    // Tied filtration built here, reduced three ways.
    type S = { verts: number[]; dim: number; birth: number };
    const n = grid.length, d = grid.map((a) => grid.map((b) => euclidean(a, b)));
    const S: S[] = grid.map((_, i) => ({ verts: [i], dim: 0, birth: 0 }));
    const sc = 1.5;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (d[i][j] <= sc) S.push({ verts: [i, j], dim: 1, birth: d[i][j] });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      const b = Math.max(d[i][j], d[i][k], d[j][k]);
      if (b <= sc) S.push({ verts: [i, j, k], dim: 2, birth: b });
    }
    S.sort((a, b) => a.birth - b.birth || a.dim - b.dim);
    const lows = (low: Int32Array) => [...low].map((L, j) => (L >= 0 ? `${L}>${j}` : "")).filter(Boolean).sort();
    for (const p of [2, 3, 5]) {
      const ref = lows(_internals.reduceFp(S, p).low);
      expect(lows(_internals.reduceCohomology(S, p).low)).toEqual(ref);
      if (p === 2) expect(lows(_internals.reduceF2(S).low)).toEqual(ref);
    }
  });
  it("non-finite coordinates are refused by the engine, and a row the parser cannot read is REPORTED", () => {
    expect(() => persistentHomology([[0, 0], [NaN, 1]])).toThrow(/finite numbers/);
    const req = parsePersistenceRequest("0 0\n1e999 2\n1 1");
    expect(req && req.ok && req.ignored).toEqual(["1e999 2"]);
  });
});

describe("the scale: projected before building, the user's overriding", () => {
  it("the projected count equals the count actually built, on random clouds", () => {
    for (let t = 0; t < 4; t++) {
      const pts = Array.from({ length: 60 + 30 * t }, () => [rnd(), rnd(), rnd()]);
      for (const maxDim of [1, 2]) {
        const r = persistentHomology(pts, { maxDim });
        const said = /(?:Projected |stays under the cap \()([\d,]+) simplices/.exec(r.steps.join(" "));
        expect(said).not.toBeNull();
        expect(Number(said![1].replace(/,/g, ""))).toBe(r.cells.reduce((a, b) => a + b, 0));
        expect(r.cells.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
      }
    }
  });
  it("H2 on klein150: tetrahedra are projected too; the cap holds and the time is bounded", () => {
    const { value: r, ms } = timed(() => persistentHomology(klein(150), { maxDim: 2, p: 3 }));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.cells.length).toBe(4);
    expect(r.cells[3]).toBeGreaterThan(0);
    expect(r.cells.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
    expect(r.pairs.every((q) => q.dimension <= 2)).toBe(true);
  });
  it("a user scale wins, even below the automatic one — and what is alive there is censored, not essential", () => {
    const r = persistentHomology(klein(150), { maxDim: 1, maxScale: 0.3 });
    expect(r.scaleSource).toBe("user");
    expect(r.scaleUsed).toBe(0.3);
    expect(r.censored).toBeGreaterThan(0);
    expect(r.pairs.filter((q) => q.death === Infinity).length).toBe(1);
    expect(r.notable.every((q) => Number.isFinite(q.death))).toBe(true);
    expect(r.steps.join(" ")).toMatch(/as you set it/);
  });
  it("a user scale past the diameter is clamped to it, and said", () => {
    const r = persistentHomology(ring(10), { maxScale: 50 });
    expect(r.scaleUsed).toBeCloseTo(2, 12);
    expect(r.steps.join(" ")).toMatch(/past the diameter/);
  });
  it("a negative or NaN scale is refused by name", () => {
    expect(() => persistentHomology(ring(10), { maxScale: -1 })).toThrow(/scale must be a number ≥ 0/);
    expect(() => persistentHomology(ring(10), { maxScale: NaN })).toThrow(/scale must be a number ≥ 0/);
  });
  it("Betti numbers asked for past the computed scale are flagged as upper bounds", () => {
    const r = persistentHomology(ring(30), { maxDim: 1, maxScale: 1, bettiAt: 1.9 });
    expect(r.bettiAt!.undetermined).toMatch(/upper bounds/);
    const ok = persistentHomology(ring(30), { maxDim: 1, bettiAt: 0.5 });
    expect(ok.bettiAt!.undetermined).toBeUndefined();
    expect(ok.bettiAt!.betti).toEqual([1, 1]);
  });
  it("maxDim is clamped to 0…2", () => {
    expect(persistentHomology(ring(8), { maxDim: 0 }).pairs.every((q) => q.dimension === 0)).toBe(true);
    expect(persistentHomology(ring(8), { maxDim: 9 }).cells.length).toBeLessThanOrEqual(4);
    expect(persistentHomology(ring(8), { maxDim: -4 }).pairs.every((q) => q.dimension === 0)).toBe(true);
  });
});

describe("the parser against odd input", () => {
  it.each([
    ["over 𝔽₄₆₃₃₇", 46337], ["over F_3", 3], ["over F 5", 5], ["OVER F3", 3], ["mod 7 please", 7], ["coefficients: Z/5", 5],
  ])("%s → %d", (h, p) => {
    const r = parsePersistenceRequest(`${h}\n0 0\n1 1`);
    expect(r && r.ok && r.p).toBe(p);
  });
  it.each(["over F0", "over F1", "mod 1", "over Z/0", "over F4", "mod 46349", "over R", "over the integers"])(
    "%s is refused, never silently read as 𝔽₂",
    (h) => {
      const r = parsePersistenceRequest(`${h}\n0 0\n1 1`);
      expect(r).toMatchObject({ ok: false });
    }
  );
  it("a 'scale' with no number is reported, and an absurd one refused", () => {
    expect(parsePersistenceRequest("scale auto\n0 0\n1 1")).toMatchObject({ ok: true, ignored: ["scale auto"] });
    expect(parsePersistenceRequest("scale 1e400\n0 0\n1 1")).toMatchObject({ ok: false });
    expect(parsePersistenceRequest("scale -2\n0 0\n1 1")).toMatchObject({ ok: false });
  });
  it("a 50 000-character header line is handled in bounded time", () => {
    const junk = "over ".repeat(10000);
    const { ms } = timed(() => parsePersistenceRequest(`${junk}\n0 0\n1 1`));
    expect(ms).toBeLessThan(1000);
    const { ms: ms2 } = timed(() => parseFieldSpec("in ".repeat(20000) + "F3"));
    expect(ms2).toBeLessThan(1000);
  });
});

describe("the figure never emits nonsense", () => {
  it("single, censored and compare figures are well formed and NaN-free", () => {
    const rs = [
      persistentHomology(ring(30), { maxDim: 1, maxScale: 1 }),
      persistentHomology(ring(2), { maxDim: 1 }),
      persistentHomology(klein(40), { maxDim: 1, compare: true }),
      persistentHomology(Array.from({ length: 5 }, () => [0, 0]), { maxDim: 1 }),
    ];
    for (const r of rs) {
      for (const svg of [barcodeSvg(r), barcodeSvg(r, 460, 300, { compare: true })]) {
        expect((svg.match(/<svg/g) || []).length).toBe(1);
        expect((svg.match(/<\/svg>/g) || []).length).toBe(1);
        expect(svg).not.toMatch(/NaN|Infinity|undefined|null/);
      }
    }
  });
});

describe("display contract — every string the user can see is typeset", () => {
  const texts: string[] = [];
  for (const r of [
    persistentHomology(klein(120), { maxDim: 1, p: 3 }),
    persistentHomology(klein(120), { maxDim: 2, compare: true }),
    persistentHomology(ring(30), { maxDim: 1, maxScale: 1, bettiAt: 1.9 }),
  ]) {
    texts.push(...r.steps, ...r.caveats, ...r.torsion, r.capped ?? "", r.bettiAt?.undetermined ?? "");
  }
  for (const h of ["mod 4", "over Z", "over F9", "over F46349", "over F6", "over Q", "H3", "over F0", "scale -1"]) {
    const req = parsePersistenceRequest(`${h}\n0 0\n1 1`);
    if (req && !req.ok) texts.push(req.error);
  }
  for (const p of [4, 9, 1, 2.5, 46349, 1e20]) {
    try { persistentHomology(ring(6), { p }); } catch (e) { texts.push((e as Error).message); }
  }
  it("collected a representative set", () => expect(texts.filter(Boolean).length).toBeGreaterThan(30));
  it("no raw subscript markup (H_k, _{…}) and no bare 𝔽p", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/H_|_\{|𝔽p/);
    }
  });
  it("the torsion line typesets H₁ and 𝔽ₚ", () => {
    const r = persistentHomology(klein(150), { maxDim: 1, p: 3 });
    expect(r.torsion[0]).toMatch(/An H₁ bar/);
    expect(r.torsion[0]).toMatch(/Hₖ\(𝔽ₚ\) = Hₖ ⊗ 𝔽ₚ ⊕ Tor\(Hₖ₋₁, 𝔽ₚ\)/);
  });
});

describe("source hygiene — the file is bundled into the pane", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "persistence.ts"), "utf8");
  it("no regex lookbehind (Mac WKWebView)", () => {
    expect(src).not.toMatch(/\(\?<[=!]/);
  });
  it("no control characters (eaten backslashes)", () => {
    // eslint-disable-next-line no-control-regex
    expect(src).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });
  it("no recursion in the reducers: no function calls itself", () => {
    for (const name of ["reduceF2", "reduceFp", "reduceCohomology", "projectScale", "maxminSubsample"]) {
      const start = src.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start + 10, src.indexOf("\n}\n", start));
      expect(body.includes(`${name}(`)).toBe(false);
    }
  });
});
