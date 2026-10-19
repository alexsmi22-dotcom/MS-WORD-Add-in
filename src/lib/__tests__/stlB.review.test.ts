import { readStl, stlBody, stlHash, STL_LIMITS } from "../stl";
import { tessellate } from "../cadModel";
import { rememberStl } from "../cadMeshStore";
import { CadDoc, defaultParams, docToAssembly, starterDoc } from "../cadShapes";
import { autoExplode, explodedAnchors, explodedDoc, explodeTrails } from "../cadExplode";
import { layoutSheet } from "../cadSheet";

type P3 = [number, number, number];

function build(): Uint8Array {
  const facets: P3[][] = [];
  const nu = 460, nv = 100;
  const T = (i: number, j: number): P3 => {
    const u = (2 * Math.PI * (i % nu)) / nu, v = (2 * Math.PI * (j % nv)) / nv;
    return [(40 + 12 * Math.cos(v)) * Math.cos(u), (40 + 12 * Math.cos(v)) * Math.sin(u), 12 * Math.sin(v)];
  };
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      facets.push([T(i, j), T(i + 1, j), T(i + 1, j + 1)], [T(i, j), T(i + 1, j + 1), T(i, j + 1)]);
    }
  // star prism at x=200: k points alternating radius, height 20
  const k = 1950;
  const S = (i: number, z: number): P3 => {
    const a = (2 * Math.PI * (i % k)) / k, r = i % 2 ? 30 : 36;
    return [200 + r * Math.cos(a), r * Math.sin(a), z];
  };
  for (let i = 0; i < k; i++) {
    facets.push([S(i, 0), S(i + 1, 0), S(i + 1, 20)], [S(i, 0), S(i + 1, 20), S(i, 20)]);
    facets.push([[200, 0, 20], S(i, 20), S(i + 1, 20)], [[200, 0, 0], S(i + 1, 0), S(i, 0)]);
  }
  const b = new Uint8Array(84 + 50 * facets.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(80, facets.length, true);
  facets.forEach((t, f) => t.forEach((p, c) => p.forEach((v, q) => dv.setFloat32(84 + 50 * f + 12 + 12 * c + 4 * q, v, true))));
  return b;
}

describe("review B: at the limits", () => {

  it("100k facets / ~5.9k edges: file → sheet with 4 views + exploded + detail", () => {
    const bytes = build();
    let t0 = Date.now();
    const r = readStl(bytes);
    if (!r.ok) throw new Error(r.reason);
    const tRead = Date.now() - t0;
    t0 = Date.now();
    const b = stlBody(r.stl, 1, 30);
    if (!b.ok) throw new Error(b.reason);
    const tBody = Date.now() - t0;
    console.log("facets", r.stl.count, "edges", b.body.mesh.edges.length / 2, "limit", STL_LIMITS.edges, "read", tRead, "body", tBody);
    const hash = stlHash(bytes);
    rememberStl(hash, r.stl);
    const doc: CadDoc = {
      ...starterDoc("asme"),
      parts: [
        { id: "m", name: "Big", shape: "mesh", params: {}, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] }, mesh: { file: "big.stl", hash, facets: r.stl.count, mmPerUnit: 1, creaseDeg: 30, size: b.body.size } },
        { id: "b", name: "Block", shape: "box", params: defaultParams("box"), placement: { translate: [400, 0, 0], rotateDeg: [0, 0, 0] } },
      ],
    };
    t0 = Date.now();
    const a = docToAssembly(doc);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    const tTess = Date.now() - t0;
    t0 = Date.now();
    const offsets = autoExplode(doc, t.mesh);
    const ea = docToAssembly(explodedDoc(doc, offsets));
    if (!ea.ok) throw new Error(ea.reason);
    const et = tessellate(ea.assembly);
    if (!et.ok) throw new Error(et.reason);
    const tExp = Date.now() - t0;
    t0 = Date.now();
    const sh = layoutSheet(t.mesh, {
      standard: "asme",
      views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }, { kind: "exploded" }, { kind: "detail", letter: "A", of: "front", at: [0, 0], r: 20, factor: 2 } as any],
      callouts: [],
      exploded: { mesh: et.mesh, anchors: explodedAnchors(doc, [], offsets), trails: explodeTrails(doc, t.mesh, offsets) },
    });
    const tSheet = Date.now() - t0;
    console.log("tess", tTess, "explode", tExp, "sheet", tSheet, "svg bytes", sh.svg.length, "notes", sh.notes);
  }, 600000);
});
