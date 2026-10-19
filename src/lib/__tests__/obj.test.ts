// Wavefront OBJ parts (obj.ts): read into the same facets as an STL, through the same pipeline.
import { readObj } from "../obj";
import { stlBody } from "../stl";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const CUBE_V = ["v 0 0 0", "v 10 0 0", "v 10 10 0", "v 0 10 0", "v 0 0 10", "v 10 0 10", "v 10 10 10", "v 0 10 10"];
const QUADS = ["f 1 4 3 2", "f 5 6 7 8", "f 1 2 6 5", "f 2 3 7 6", "f 3 4 8 7", "f 4 1 5 8"];
const tris = QUADS.flatMap((q) => {
  const [a, b, c, d] = q.slice(2).split(" ");
  return [`f ${a} ${b} ${c}`, `f ${a} ${c} ${d}`];
});

describe("readObj", () => {
  it("a cube of quads is twelve facets, and a closed 10 mm body", () => {
    const r = readObj(enc(["# cube", "o Cube", ...CUBE_V, "s off", ...QUADS].join("\n")));
    if (!r.ok) throw new Error(r.reason);
    expect(r.stl).toMatchObject({ format: "obj", count: 12, unreadable: 0 });
    const b = stlBody(r.stl, 1);
    if (!b.ok) throw new Error(b.reason);
    expect(b.body.size).toEqual([10, 10, 10]);
  });

  it("the same cube as triangles, and with negative indices and slash forms, gives the same facets", () => {
    const quads = readObj(enc([...CUBE_V, ...QUADS].join("\n")));
    const triangles = readObj(enc([...CUBE_V, ...tris].join("\n")));
    // Negative indices count back from the last corner; i/t/n and i//n carry the corner first.
    const neg = readObj(enc([...CUBE_V, "vt 0 0", "vn 0 0 1", "f -8/1/1 -5/1/1 -6/1/1 -7/1/1", ...QUADS.slice(1).map((q) => q.replace(/(\d+)/g, "$1//1"))].join("\r\n")));
    if (!quads.ok || !triangles.ok || !neg.ok) throw new Error("unread");
    expect(Array.from(triangles.stl.corners)).toEqual(Array.from(quads.stl.corners));
    expect(Array.from(neg.stl.corners)).toEqual(Array.from(quads.stl.corners));
  });

  it("a corner that does not exist is refused with its line", () => {
    const r = readObj(enc([...CUBE_V, "f 1 2 9"].join("\n")));
    expect(r).toEqual({ ok: false, reason: "line 9: corner 9 does not exist (8 corners so far)" });
  });

  it("a number that cannot be read is refused with its line, never skipped", () => {
    expect(readObj(enc("v 0 0 0\nv 1 O 0\n"))).toEqual({ ok: false, reason: 'line 2: "O" is not a number' });
    expect(readObj(enc("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 x\n"))).toEqual({ ok: false, reason: 'line 4: "x" is not a corner number' });
    expect(readObj(enc("v 0 0 0\nv 1 0 0\nf 1 2\n"))).toEqual({ ok: false, reason: 'line 3: a face ("f") needs at least three corners' });
  });

  it("corners but no faces, or nothing, is refused", () => {
    expect(readObj(enc(CUBE_V.join("\n")))).toEqual({ ok: false, reason: "it has corners but no faces" });
    expect(readObj(enc("# empty\n"))).toEqual({ ok: false, reason: "it has no faces" });
  });

  it("a material file is named but never read", () => {
    const r = readObj(enc(["mtllib cube.mtl", "usemtl Steel", ...CUBE_V, ...QUADS].join("\n")));
    expect(r.ok).toBe(true);
  });

  it("the printed digits are measured as for a text STL", () => {
    const r = readObj(enc(["v 0.000 0 0", "v 1.25 0 0", "v 0 1 0", "f 1 2 3"].join("\n")));
    if (!r.ok) throw new Error(r.reason);
    expect(r.stl.step).toBeCloseTo(1, 12);
    expect(r.stl.sig).toBe(3);
  });
});
