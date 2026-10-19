import { readStl, stlBody, STL_LIMITS, StlFacets } from "../stl";
import { tessellate, Assembly, IDENTITY_PLACEMENT, box, SolidMesh } from "../cadModel";
import { drawLines, STANDARD_VIEWS } from "../cadLines";

type Tri = [number, number, number][];

/** A binary STL of these facets (header text optional). */
function binary(tris: Tri[], header = "made by a test"): Uint8Array {
  const b = new Uint8Array(84 + 50 * tris.length);
  for (let i = 0; i < Math.min(80, header.length); i++) b[i] = header.charCodeAt(i);
  const dv = new DataView(b.buffer);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, f) => t.forEach((p, c) => p.forEach((v, k) => dv.setFloat32(84 + 50 * f + 12 + 12 * c + 4 * k, v, true))));
  return b;
}

/** A text STL of these facets. */
function text(tris: Tri[], name = "part"): Uint8Array {
  const NL = String.fromCharCode(10);
  const lines = [`solid ${name}`];
  for (const t of tris) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (const p of t) lines.push(`      vertex ${p[0]} ${p[1]} ${p[2]}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return new TextEncoderLike().encode(lines.join(NL));
}
class TextEncoderLike {
  encode(s: string): Uint8Array {
    return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  }
}

/** A cube [0,s]³ wound outward (two facets a side). */
function cube(s = 10): Tri[] {
  const q = (a: number[], b: number[], c: number[], d: number[]): Tri[] => [
    [a, b, c] as Tri,
    [a, c, d] as Tri,
  ].map((t) => t.map((p) => p.map((v) => v * s)) as Tri);
  return [
    ...q([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]), // bottom (−Z)
    ...q([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]), // top
    ...q([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]), // front (−Y)
    ...q([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]), // back
    ...q([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]), // left (−X)
    ...q([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]), // right
  ];
}

/** A closed cylinder about Z: radius r, height h, n facets around. */
function cylinder(n: number, r = 10, h = 20): Tri[] {
  const out: Tri[] = [];
  const p = (i: number, z: number): [number, number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push([p(i, 0), p(j, 0), p(j, h)], [p(i, 0), p(j, h), p(i, h)]);
    out.push([[0, 0, h], p(i, h), p(j, h)], [[0, 0, 0], p(j, 0), p(i, 0)]);
  }
  return out;
}

const read = (b: Uint8Array): StlFacets => {
  const r = readStl(b);
  if (!r.ok) throw new Error(r.reason);
  return r.stl;
};
const body = (b: Uint8Array, mm = 1, crease?: number) => {
  const r = stlBody(read(b), mm, crease);
  if (!r.ok) throw new Error(r.reason);
  return r.body;
};
const asm = (mesh: SolidMesh, extra: Assembly["bodies"] = []): Assembly => ({
  version: 1,
  bodies: [{ id: "m", name: "Imported", spec: { kind: "mesh", mesh }, placement: IDENTITY_PLACEMENT }, ...extra],
});

describe("reading STL files", () => {
  test("a binary cube: corners joined within each face (not across its edges), the 12 real edges drawn, the face diagonals not", () => {
    const b = body(binary(cube()));
    // 6 faces × 4 corners: a corner is shared along a face, never across an edge (as the engine's own box).
    expect(b.mesh.positions.length / 3).toBe(24);
    expect(b.mesh.triangles.length / 3).toBe(12);
    expect(b.mesh.edges.length / 2).toBe(12);
    expect(b.size).toEqual([10, 10, 10]);
    expect(b.notes).toEqual([]);
    expect(b.mesh.sag).toBe(0);
  });

  test("the same cube as text reads the same", () => {
    const t = read(text(cube()));
    expect(t.format).toBe("text");
    const b = body(text(cube()));
    expect(b.mesh.edges.length / 2).toBe(12);
    expect(b.size).toEqual([10, 10, 10]);
  });

  test('a binary file whose header starts "solid" is read as binary (its size decides)', () => {
    const t = read(binary(cube(), "solid part exported by a CAD program"));
    expect(t.format).toBe("binary");
    expect(t.count).toBe(12);
  });

  test("units scale the body and nothing is assumed", () => {
    expect(body(binary(cube(1)), 25.4).size).toEqual([25.4, 25.4, 25.4]);
    const r = stlBody(read(binary(cube())), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("choose the file's units first");
  });

  test("the body is moved so its lowest corner is at the origin", () => {
    const moved = cube().map((t) => t.map((p) => [p[0] + 500, p[1] - 40, p[2] + 7]) as Tri);
    const P = body(binary(moved)).mesh.positions;
    expect(Math.min(...P.filter((_, i) => i % 3 === 0))).toBe(0);
    expect(Math.min(...P.filter((_, i) => i % 3 === 2))).toBe(0);
  });

  test("an inside-out cube is turned to face out, and the note says so", () => {
    const inside = cube().map((t) => [t[0], t[2], t[1]] as Tri);
    const b = body(binary(inside));
    expect(b.notes).toEqual(["12 facets were wound the wrong way and turned."]);
    // Every facet now faces away from the centre.
    const P = b.mesh.positions, T = b.mesh.triangles;
    for (let t = 0; t < 12; t++) {
      const v = (i: number) => [P[3 * T[3 * t + i]], P[3 * T[3 * t + i] + 1], P[3 * T[3 * t + i] + 2]];
      const [a, bb, c] = [v(0), v(1), v(2)];
      const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const mid = [(a[0] + bb[0] + c[0]) / 3 - 5, (a[1] + bb[1] + c[1]) / 3 - 5, (a[2] + bb[2] + c[2]) / 3 - 5];
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);
    }
  });

  test("one facet wound against its neighbours is turned", () => {
    const tris = cube();
    tris[5] = [tris[5][0], tris[5][2], tris[5][1]];
    expect(body(binary(tris)).notes).toEqual(["1 facet was wound the wrong way and turned."]);
  });

  test("a faceted cylinder is drawn by its rims and outline, not its facets", () => {
    const b = body(binary(cylinder(64)));
    expect(b.mesh.edges.length / 2).toBe(128); // two rims of 64 sides
    const t = tessellate(asm(b.mesh));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const d = drawLines(t.mesh, STANDARD_VIEWS.front);
    // The front view's outline: the two sides of the cylinder, x = 0 and x = 20 (moved to the origin).
    const xs = d.visible.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(20, 1);
    // No facet seams: every visible vertical line is at one of the two sides.
    const vertical = d.visible.filter((l) => l.length >= 2 && Math.abs(l[0][0] - l[l.length - 1][0]) < 1e-6 && Math.abs(l[0][1] - l[l.length - 1][1]) > 1);
    for (const l of vertical) expect(Math.min(Math.abs(l[0][0] - 0), Math.abs(l[0][0] - 20))).toBeLessThan(0.1);
    expect(b.mesh.sag).toBeGreaterThan(0);
  });

  test("the edge angle decides: an 8-sided prism's 45° sides are edges at 30°, smooth at 50°", () => {
    expect(body(binary(cylinder(8)), 1, 30).mesh.edges.length / 2).toBe(8 + 8 + 8);
    expect(body(binary(cylinder(8)), 1, 50).mesh.edges.length / 2).toBe(16);
  });

  test("an open surface: its boundary is drawn and the note counts the open edges", () => {
    const sq: Tri[] = [
      [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      [[0, 0, 0], [1, 1, 0], [0, 1, 0]],
    ];
    const b = body(binary(sq));
    expect(b.mesh.edges.length / 2).toBe(4);
    expect(b.notes).toEqual(["4 edges are open — the surface has gaps there, drawn as edges."]);
  });

  test("facets with an unreadable number, or two corners in one place, are counted", () => {
    const tris = cube();
    tris.push([[0, 0, 0], [NaN, 0, 0], [1, 1, 1]]);
    tris.push([[0, 0, 0], [0, 0, 0], [1, 1, 1]]);
    const b = body(binary(tris));
    expect(b.notes).toEqual([
      "1 facet with a number that could not be read was left out.",
      "1 facet with two corners in one place was left out.",
    ]);
  });
});

describe("refusals, by name", () => {
  test("a file whose size does not match its stated count, and that is not text", () => {
    const b = binary(cube());
    const cut = b.subarray(0, b.length - 10);
    const r = readStl(cut);
    expect(r).toEqual({
      ok: false,
      reason: 'this is not an STL this importer can read — as a binary STL it states 12 facets, which take 684 bytes, but the file has 674; and it does not start as a text STL ("solid …")',
    });
  });

  test("more facets than the limit, refused before they are read", () => {
    const b = new Uint8Array(84 + 50 * 10);
    new DataView(b.buffer).setUint32(80, 10, true);
    expect(readStl(b).ok).toBe(true); // ten zero facets: read, then refused below for having no area
    const big = new Uint8Array(84 + 50 * (STL_LIMITS.facets + 1));
    new DataView(big.buffer).setUint32(80, STL_LIMITS.facets + 1, true);
    expect(readStl(big)).toEqual({ ok: false, reason: "it has more than 100,000 facets — this importer reads up to 100,000; export it again with a coarser tolerance" });
  });

  test("a file larger than the size limit", () => {
    const r = readStl(new Uint8Array(STL_LIMITS.bytes + 1));
    expect(r).toEqual({ ok: false, reason: "the file is 30.1 MB — this importer reads STL files up to 30 MB" });
  });

  test("text: a facet with four corners, a cut-off file, no facets", () => {
    const NL = String.fromCharCode(10);
    const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    const four = ["solid x", "facet normal 0 0 1", "outer loop", "vertex 0 0 0", "vertex 1 0 0", "vertex 1 1 0", "vertex 0 1 0", "endloop", "endfacet", "endsolid"].join(NL);
    expect(readStl(enc(four))).toEqual({ ok: false, reason: "facet 1 has 4 corners — an STL facet has three" });
    const cut = ["solid x", "facet normal 0 0 1", "outer loop", "vertex 0 0 0"].join(NL);
    expect(readStl(enc(cut))).toEqual({ ok: false, reason: 'facet 1 has no "endfacet" (the file is cut short)' });
    expect(readStl(enc("solid empty" + NL + "endsolid empty"))).toEqual({ ok: false, reason: "it has no facets" });
  });

  test('a solid NAMED "facet" is not a facet', () => {
    expect(read(text(cube(), "facet")).count).toBe(12);
  });

  test("every facet degenerate: refused", () => {
    const b = new Uint8Array(84 + 50 * 3);
    new DataView(b.buffer).setUint32(80, 3, true);
    expect(stlBody(read(b), 1)).toEqual({ ok: false, reason: "every facet has two corners in one place (no area)" });
  });
});

describe("in the drawing", () => {
  test("an imported body and a box that overlaps it: the crossing is found", () => {
    const m = body(binary(cube())).mesh;
    const t = tessellate(asm(m, [{ id: "b", name: "Block", spec: box(4, 4, 20), placement: { translate: [3, 3, -5], rotateDeg: [0, 0, 0] } }]));
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.mesh.overlaps).toEqual([[0, 1]]);
  });

  test("a body past the drawing's triangle limit is refused by name", () => {
    const m = body(binary(cylinder(64))).mesh;
    const r = tessellate(asm(m), { relTol: 2e-4, maxTriangles: 100 });
    expect(r).toEqual({ ok: false, reason: "Imported: it has 256 triangles — a drawing holds at most 100 in all" });
  });

  test("a damaged body is refused, not drawn", () => {
    const m = body(binary(cube())).mesh;
    const bad = { ...m, triangles: [...m.triangles.slice(0, -1), 99] };
    const r = tessellate(asm(bad));
    expect(r).toEqual({ ok: false, reason: "Imported: its triangles are damaged" });
  });
});
