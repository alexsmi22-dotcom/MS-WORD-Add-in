import { readStl, stlBody, StlFacets } from "../stl";
import { tessellate, IDENTITY_PLACEMENT, SolidMesh, box } from "../cadModel";

type P3 = [number, number, number];
type Tri = P3[];

function binary(tris: Tri[]): Uint8Array {
  const b = new Uint8Array(84 + 50 * tris.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, f) => t.forEach((p, c) => p.forEach((v, k) => dv.setFloat32(84 + 50 * f + 12 + 12 * c + 4 * k, v, true))));
  return b;
}
function text(tris: Tri[], fmt: (v: number) => string = String, pre = ""): Uint8Array {
  const lines = [`${pre}solid part`];
  for (const t of tris) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (const p of t) lines.push(`      vertex ${p.map(fmt).join(" ")}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push("endsolid part");
  return Uint8Array.from(lines.join("\n"), (ch) => ch.charCodeAt(0));
}
function cubeAt(o: P3, s: number, inward = false): Tri[] {
  const q = (a: number[], b: number[], c: number[], d: number[]): Tri[] =>
    [[a, b, c], [a, c, d]].map((t) => t.map((p) => p.map((v, k) => o[k] + v * s) as P3));
  const f = [
    ...q([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]),
    ...q([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]),
    ...q([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]),
    ...q([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]),
    ...q([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]),
    ...q([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]),
  ];
  return inward ? f.map((t) => [t[0], t[2], t[1]]) : f;
}
const read = (b: Uint8Array): StlFacets => {
  const r = readStl(b);
  if (!r.ok) throw new Error(r.reason);
  return r.stl;
};
const bodyOf = (b: Uint8Array, mm = 1, crease?: number) => {
  const r = stlBody(read(b), mm, crease);
  if (!r.ok) throw new Error(r.reason);
  return r.body;
};
/** signed volume per closed piece computed from a SolidMesh */
function volume(m: SolidMesh): number {
  const P = m.positions, T = m.triangles;
  let v = 0;
  for (let t = 0; t < T.length / 3; t++) {
    const [a, b, c] = [T[3 * t], T[3 * t + 1], T[3 * t + 2]].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}

describe("review A", () => {
  it("hollow box (outer 10, cavity 4 wound into the void): the enclosed volume must be 1000 - 64 = 936", () => {
    const tris = [...cubeAt([0, 0, 0], 10), ...cubeAt([3, 3, 3], 4, true)];
    const b = bodyOf(binary(tris));
    console.log("hollow volume", volume(b.mesh), "notes", b.notes);
    expect(volume(b.mesh)).toBeCloseTo(936, 3);
  });

  it("a pin crossing into the cavity of a hollow STL: the crossing at the cavity wall is found", () => {
    const tris = [...cubeAt([0, 0, 0], 10), ...cubeAt([3, 3, 3], 4, true)];
    const b = bodyOf(binary(tris));
    // pin: box from x=-5..5 (through outer wall x=0 and cavity wall x=3), y,z 4.5..5.5
    const pinRef = { id: "p", name: "Pin", spec: box(10, 1, 1), placement: { translate: [-5, 4.5, 4.5] as P3, rotateDeg: [0, 0, 0] as P3 } };
    const t = tessellate({ version: 1, bodies: [{ id: "m", name: "Hollow", spec: { kind: "mesh", mesh: b.mesh }, placement: IDENTITY_PLACEMENT }, pinRef as any] });
    if (!t.ok) throw new Error(t.reason);
    const P = t.mesh.positions;
    const xs = t.mesh.crossings.map((c: any) => JSON.stringify(c).slice(0, 0) || c);
    // crossing segment endpoints' x
    const near = (x0: number) =>
      t.mesh.crossings.filter((c: any) => {
        const pts: number[][] = Array.isArray(c) ? c : c.points ?? [c.a, c.b];
        return pts.every((p: any) => Math.abs((Array.isArray(p) ? p[0] : P[3 * p]) - x0) < 1e-6);
      }).length;
    console.log("crossings", t.mesh.crossings.length, JSON.stringify(t.mesh.crossings.slice(0, 2)), "at x=0:", near(0), "at x=3:", near(3), xs.length);
    expect(near(3)).toBeGreaterThan(0);
  });

  it("two closed cubes sharing one edge: the pane's 'surface has gaps' claim (closed=false) is false", () => {
    const tris = [...cubeAt([0, 0, 0], 10), ...cubeAt([10, 10, 0], 10)];
    const b = bodyOf(binary(tris));
    console.log("shared-edge notes", b.notes, "closed", b.mesh.closed);
    expect(b.notes.join(" ")).not.toMatch(/open/);
    expect(b.mesh.closed).toBe(true);
  });

  it("text STL with a UTF-8 BOM", () => {
    const raw = text(cubeAt([0, 0, 0], 10));
    const bom = new Uint8Array(raw.length + 3);
    bom.set([0xef, 0xbb, 0xbf]);
    bom.set(raw, 3);
    const r = readStl(bom);
    console.log("BOM", r.ok ? "read" : r.reason);
    expect(r.ok).toBe(true);
  });

  it("text STL odd numbers", () => {
    for (const s of ["1.0E+01", "1.e1", "+10", "0x0A", "1_0", "10.", ".5e1"]) {
      const tris: Tri[] = cubeAt([0, 0, 0], 10);
      const r = readStl(text(tris, (v) => (v === 10 ? s : String(v))));
      console.log("num", s, r.ok ? `read unreadable=${r.stl.unreadable} first10=${Array.from(r.stl.corners).find((x) => x !== 0)}` : r.reason);
    }
  });

  it("fan around one apex: time stlBody for a 60k-facet cone fan", () => {
    const n = 60000;
    const tris: Tri[] = [];
    const p = (i: number): P3 => [10 * Math.cos((2 * Math.PI * i) / n), 10 * Math.sin((2 * Math.PI * i) / n), 0];
    for (let i = 0; i < n; i++) tris.push([[0, 0, 5], p(i), p((i + 1) % n)]);
    const st = read(binary(tris));
    const t0 = Date.now();
    const r = stlBody(st, 1, 30);
    console.log("fan 60k ms", Date.now() - t0, r.ok ? "ok" : r.reason);
  }, 600000);
});
