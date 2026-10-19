// R3b: an STL as a part of the drawing. The oracle needs no outside file: catalogue parts are
// tessellated by the engine, written out as STL (binary, float32, as exporters write; and text),
// read back, and drawn — the drawing must match the analytic part's own.
import { apply3, Mesh, rotationMatrix, SolidMesh, tessellate } from "../cadModel";
import { drawLines, Polyline, viewFromDegrees } from "../cadLines";
import { faceAt } from "../cadMate";
import { hasStl, MeshRef, meshFor, rememberStl } from "../cadMeshStore";
import { attachCallout, CadDoc, CadPart, defaultParams, docToAssembly, parseDoc, partProblems, resolveCallouts, serializeDoc, ShapeId, starterDoc } from "../cadShapes";
import { autoExplode, explodedAnchors, explodedDoc, explodeTrails } from "../cadExplode";
import { layoutSheet } from "../cadSheet";
import { readStl, stlBody, stlHash, STL_LIMITS } from "../stl";

const place = { translate: [0, 0, 0] as [number, number, number], rotateDeg: [0, 0, 0] as [number, number, number] };

function analytic(shape: ShapeId): Mesh {
  const doc: CadDoc = { ...starterDoc("asme"), parts: [{ id: "a", name: "A", shape, params: defaultParams(shape), placement: place }] };
  const a = docToAssembly(doc);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
}

/** A mesh's triangles as an STL file, as an exporter writes it (binary: float32, zero normals). */
function toStl(m: Mesh, format: "binary" | "text", order: (t: number) => number[] = () => [0, 1, 2]): Uint8Array {
  const T = m.triangles, P = m.positions, nt = T.length / 3;
  const corner = (t: number, c: number): number[] => {
    const v = T[3 * t + order(t)[c]];
    return [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
  };
  if (format === "binary") {
    const dv = new DataView(new ArrayBuffer(84 + 50 * nt));
    dv.setUint32(80, nt, true);
    for (let t = 0; t < nt; t++)
      for (let c = 0; c < 3; c++) corner(t, c).forEach((x, k) => dv.setFloat32(84 + 50 * t + 12 + 12 * c + 4 * k, x, true));
    return new Uint8Array(dv.buffer);
  }
  const lines = ["solid part"];
  for (let t = 0; t < nt; t++) {
    lines.push("  facet normal 0 0 0", "    outer loop");
    for (let c = 0; c < 3; c++) lines.push(`      vertex ${corner(t, c).map((x) => x.toExponential(9)).join(" ")}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push("endsolid part");
  return new TextEncoder().encode(lines.join("\n"));
}

function imported(bytes: Uint8Array, mm = 1, crease?: number): Mesh {
  const r = readStl(bytes);
  if (!r.ok) throw new Error(r.reason);
  const b = stlBody(r.stl, mm, crease);
  if (!b.ok) throw new Error(b.reason);
  const t = tessellate({ version: 1, bodies: [{ id: "s", name: "S", spec: { kind: "mesh", mesh: b.body.mesh }, placement: place }] });
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
}

/** Largest distance from a point of one drawing's lines to the other's (sampled both ways). */
function apart(a: Polyline[], b: Polyline[]): number {
  const segs = (ls: Polyline[]): number[][] => ls.flatMap((l) => l.slice(1).map((q, i) => [l[i][0], l[i][1], q[0], q[1]]));
  const sa = segs(a), sb = segs(b);
  const dist = (x: number, y: number, s: number[]): number => {
    const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
    return Math.hypot(x - s[0] - t * dx, y - s[1] - t * dy);
  };
  const one = (from: number[][], to: number[][]): number => {
    let worst = 0;
    for (const s of from)
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const x = s[0] + f * (s[2] - s[0]), y = s[1] + f * (s[3] - s[1]);
        let best = Infinity;
        for (const u of to) best = Math.min(best, dist(x, y, u));
        worst = Math.max(worst, best);
      }
    return worst;
  };
  return Math.max(one(sa, sb), one(sb, sa));
}

/** The analytic mesh moved so its lowest corner is at the origin (as the importer moves a file's). */
function atOrigin(m: Mesh): Mesh {
  const lo = [0, 1, 2].map((k) => Math.min(...m.positions.filter((_, i) => i % 3 === k)));
  return { ...m, positions: m.positions.map((v, i) => v - lo[i % 3]) };
}

const VIEWS = { front: viewFromDegrees([0, 0, 0], "front"), top: viewFromDegrees([90, 0, 0], "top"), iso: viewFromDegrees([35.264, 45, 0], "iso") };

describe("oracle: a catalogue part written as STL draws as the part itself", () => {
  for (const shape of ["box", "cylinder", "tube", "flange", "bracket", "shaft"] as ShapeId[])
    for (const format of ["binary", "text"] as const)
      it(`${shape}, ${format}`, () => {
        const a = atOrigin(analytic(shape));
        const b = imported(toStl(a, format));
        for (const [name, v] of Object.entries(VIEWS)) {
          const da = drawLines(a, v), db = drawLines(b, v);
          const tol = a.diag * 0.01;
          expect({ view: name, visible: apart(da.visible, db.visible) < tol, hidden: !(da.hidden.length || db.hidden.length) || apart(da.hidden, db.hidden) < tol }).toEqual({ view: name, visible: true, hidden: true });
        }
      });

  it("facets written in any winding (half of them reversed) draw the same", () => {
    const a = atOrigin(analytic("flange"));
    const b = imported(toStl(a, "binary", (t) => (t % 2 ? [0, 2, 1] : [0, 1, 2])));
    expect(apart(drawLines(a, VIEWS.iso).visible, drawLines(b, VIEWS.iso).visible)).toBeLessThan(a.diag * 0.01);
  });

  it("units scale the part (inches: 25.4 ×)", () => {
    const a = atOrigin(analytic("box"));
    const b = imported(toStl(a, "binary"), 25.4);
    expect(b.diag / a.diag).toBeCloseTo(25.4, 4);
  });
});

describe("closed and open surfaces", () => {
  const box = atOrigin(analytic("box"));
  const gap = (m: Mesh): Mesh => ({ ...m, triangles: m.triangles.slice(3), cornerNormals: m.cornerNormals.slice(9), triBody: m.triBody.slice(1) });

  it("a closed part reads as closed; one with a facet missing as open, with the gap drawn as edges", () => {
    const rc = readStl(toStl(box, "binary"));
    const ro = readStl(toStl(gap(box), "binary"));
    if (!rc.ok || !ro.ok) throw new Error("unread");
    const c = stlBody(rc.stl, 1), o = stlBody(ro.stl, 1);
    if (!c.ok || !o.ok) throw new Error("no body");
    expect(c.body.mesh.closed).toBe(true);
    expect(o.body.mesh.closed).toBe(false);
    expect(o.body.notes.join(" ")).toMatch(/3 edges are open/);
  });

  it("an open part alone draws; overlapping another part it is refused by name (inside / outside is unknown)", () => {
    const ro = readStl(toStl(gap(box), "binary"));
    if (!ro.ok) throw new Error("unread");
    const o = stlBody(ro.stl, 1);
    if (!o.ok) throw new Error("no body");
    const body = (x: number) => ({ id: "s", name: "Scan", spec: { kind: "mesh" as const, mesh: o.body.mesh }, placement: { translate: [x, 0, 0] as [number, number, number], rotateDeg: [0, 0, 0] as [number, number, number] } });
    const plate = { id: "p", name: "Plate", spec: { kind: "extrude" as const, profile: { outer: { start: [0, 0] as [number, number], segs: [{ kind: "line" as const, to: [10, 0] as [number, number] }, { kind: "line" as const, to: [10, 10] as [number, number] }, { kind: "line" as const, to: [0, 10] as [number, number] }, { kind: "line" as const, to: [0, 0] as [number, number] }] }, holes: [] }, depth: 2 }, placement: place };
    expect(tessellate({ version: 1, bodies: [body(0)] }).ok).toBe(true);
    const t = tessellate({ version: 1, bodies: [body(0), plate] });
    expect(!t.ok && t.reason).toMatch(/^Scan is not a closed solid \(its surface has gaps\), so where it meets Plate cannot be worked out — move them apart/);
    expect(tessellate({ version: 1, bodies: [body(1000), plate] }).ok).toBe(true);
  });
});

describe("limits, refused by name before the work", () => {
  it("more edges than a drawing holds at the edge angle: named, with the way out", () => {
    // A finely faceted torus at a 1° edge angle: every side is a crease.
    const nu = 120, nv = 40;
    const dv = new DataView(new ArrayBuffer(84 + 50 * 2 * nu * nv));
    dv.setUint32(80, 2 * nu * nv, true);
    const P = (i: number, j: number): number[] => {
      const u = (2 * Math.PI * (i % nu)) / nu, v = (2 * Math.PI * (j % nv)) / nv;
      return [(40 + 12 * Math.cos(v)) * Math.cos(u), (40 + 12 * Math.cos(v)) * Math.sin(u), 12 * Math.sin(v)];
    };
    let o = 84;
    const facet = (...c: number[][]): void => {
      o += 12;
      for (const p of c) for (const x of p) (dv.setFloat32(o, x, true), (o += 4));
      o += 2;
    };
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        facet(P(i, j), P(i + 1, j), P(i + 1, j + 1));
        facet(P(i, j), P(i + 1, j + 1), P(i, j + 1));
      }
    const r = readStl(new Uint8Array(dv.buffer));
    if (!r.ok) throw new Error(r.reason);
    const b = stlBody(r.stl, 1, 1);
    expect(!b.ok && b.reason).toBe(`at a 1° edge angle it has more than ${STL_LIMITS.edges.toLocaleString("en-US")} edges to draw — a drawing of an imported part holds at most ${STL_LIMITS.edges.toLocaleString("en-US")}; raise the edge angle, or export it again with a coarser tolerance`);
    // At the default angle the torus is smooth: no edges at all, and it draws.
    const ok = stlBody(r.stl, 1);
    expect(ok.ok && ok.body.mesh.edges.length).toBe(0);
  });
});

describe("the drawing names its file; the facets stay in this session", () => {
  const bytes = toStl(atOrigin(analytic("cylinder")), "binary");
  const hash = stlHash(bytes);
  const ref = (over: Partial<MeshRef> = {}): MeshRef => ({ file: "pin.stl", hash, facets: readStl(bytes).ok ? (readStl(bytes) as { stl: { count: number } }).stl.count : 0, mmPerUnit: 1, creaseDeg: 30, size: [20, 20, 40], ...over });
  const part = (r: MeshRef = ref()): CadPart => ({ id: "m1", name: "Pin", shape: "mesh", params: {}, placement: place, mesh: r });
  const docWith = (p: CadPart): CadDoc => ({ ...starterDoc("asme"), parts: [p] });

  it("the fingerprint is the bytes': one changed byte, another fingerprint", () => {
    const other = bytes.slice();
    other[100] ^= 1;
    expect(stlHash(bytes)).toBe(hash);
    expect(stlHash(other)).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{16}-\d+$/);
  });

  it("not open in this session: the part names its file to import again (never drawn as nothing)", () => {
    // (A file this session never read: the store is shared by the tests in this file.)
    const never = stlHash(bytes.slice(0, bytes.length - 50));
    expect(hasStl(never)).toBe(false);
    const part = (): CadPart => ({ id: "m1", name: "Pin", shape: "mesh", params: {}, placement: place, mesh: ref({ hash: never }) });
    expect(partProblems(part())).toEqual(["its file pin.stl is not open — import pin.stl again (Import DXF / STL…) to put it back"]);
    const a = docToAssembly(docWith(part()));
    expect(!a.ok && a.reason).toBe("Pin: its file pin.stl is not open — import pin.stl again (Import DXF / STL…) to put it back");
  });

  it("open: the part is built, and the saved drawing carries only the reference (no triangles)", () => {
    const r = readStl(bytes);
    if (!r.ok) throw new Error(r.reason);
    rememberStl(hash, r.stl);
    expect(hasStl(hash)).toBe(true);
    const doc = docWith(part());
    const a = docToAssembly(doc);
    expect(a.ok).toBe(true);
    const json = serializeDoc(doc);
    expect(json.length).toBeLessThan(2000);
    expect(json).not.toMatch(/positions|triangles|cornerNormals/);
    const back = parseDoc(json);
    expect(back.ok && back.doc.parts[0].mesh).toEqual(ref());
    const a2 = docToAssembly(back.ok ? back.doc : doc);
    expect(a2.ok && tessellate(a2.assembly).ok).toBe(true);
  });

  it("units and edge angle are the part's own: changing them rebuilds it to match", () => {
    const r = readStl(bytes);
    if (!r.ok) throw new Error(r.reason);
    rememberStl(hash, r.stl);
    const mm = meshFor(ref()), inch = meshFor(ref({ mmPerUnit: 25.4 }));
    if (!mm.ok || !inch.ok) throw new Error("unbuilt");
    expect(Math.max(...inch.mesh.positions) / Math.max(...mm.mesh.positions)).toBeCloseTo(25.4, 6);
  });

  it.each([
    ["no file name", { file: "" }],
    ["a fingerprint that is not one", { hash: "zz" }],
    ["no facets", { facets: 0 }],
    ["more facets than the importer reads", { facets: STL_LIMITS.facets + 1 }],
    ["units of zero", { mmPerUnit: 0 }],
    ["an edge angle of 180°", { creaseDeg: 180 }],
    ["a size that is not a number", { size: [1, NaN, 1] }],
  ])("a damaged record is refused by name, never drawn: %s", (_w, over) => {
    const json = serializeDoc(docWith(part(ref(over as Partial<MeshRef>)))).replace("null", "\"x\"");
    const r = parseDoc(json);
    expect(!r.ok && r.reason).toBe("part Pin has a damaged imported-file record");
  });

  it("a record with extra fields keeps only its own", () => {
    const json = serializeDoc(docWith(part({ ...ref(), positions: [1, 2, 3] } as MeshRef)));
    const r = parseDoc(json);
    expect(r.ok && Object.keys(r.doc.parts[0].mesh!).sort()).toEqual(["creaseDeg", "facets", "file", "hash", "mmPerUnit", "size"]);
  });
});

describe("mates on an imported part (float32 corners)", () => {
  it("a flat face of an STL box is found whole: its centre is the face's centre", () => {
    // A box at awkward coordinates, turned, so float32 rounding lands off the plane by ~1e-7 relative.
    const doc: CadDoc = { ...starterDoc("asme"), parts: [{ id: "a", name: "A", shape: "box", params: { ...defaultParams("box"), w: 33.3, d: 21.7, h: 9.1 }, placement: { translate: [101.1, 57.3, 13.9], rotateDeg: [17, 29, 41] } }] };
    const a = docToAssembly(doc);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    const m = imported(toStl(t.mesh, "binary"));
    // The triangle whose plane is farthest along its own normal from the centre: the faces are found by the normal.
    let best = -1, top = -Infinity;
    for (let k = 0; k < m.triangles.length / 3; k++) {
      const nz = m.cornerNormals[9 * k + 2];
      if (nz > top) (top = nz), (best = k);
    }
    const P = m.positions, T = m.triangles;
    // The face's four corners: the triangles facing the same way.
    const faceVerts = new Set<string>();
    const n0 = [0, 1, 2].map((j) => m.cornerNormals[9 * best + j]);
    for (let k = 0; k < T.length / 3; k++) {
      const n = [0, 1, 2].map((j) => m.cornerNormals[9 * k + j]);
      if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.999999) for (let j = 0; j < 3; j++) faceVerts.add([0, 1, 2].map((q) => P[3 * T[3 * k + j] + q].toFixed(4)).join(","));
    }
    expect(faceVerts.size).toBe(4);
    const cx = [0, 1, 2].map((q) => [...faceVerts].reduce((s, v) => s + Number(v.split(",")[q]), 0) / 4) as [number, number, number];
    // Clicked a little off the centre: it snaps to the centre of the WHOLE face (both triangles found).
    const f = faceAt(m, best, [cx[0] + 0.3, cx[1] - 0.2, cx[2]], 1);
    expect(f.ok).toBe(true);
    const hit = f.ok ? f.hit : null;
    expect(hit && hit.snap).toBe("centre");
    for (let q = 0; q < 3; q++) expect(Math.abs(hit!.point[q] - cx[q])).toBeLessThan(1e-3);
  });
});

describe("imported parts touching flush (faces within float32 rounding)", () => {
  it("two STL boxes stacked flush, turned: no overlap and no crossing lines, as the engine's own boxes", () => {
    const params = { ...defaultParams("box"), w: 33.3, d: 21.7, h: 9.1 };
    const rot: [number, number, number] = [17, 29, 41];
    const lift = apply3(rotationMatrix(rot), [0, 0, params.h]);
    const pair: CadDoc = {
      ...starterDoc("asme"),
      parts: [
        { id: "a", name: "A", shape: "box", params, placement: { translate: [100.7, 50.3, 20.1], rotateDeg: rot } },
        { id: "b", name: "B", shape: "box", params, placement: { translate: [100.7 + lift[0], 50.3 + lift[1], 20.1 + lift[2]], rotateDeg: rot } },
      ],
    };
    const a = docToAssembly(pair);
    if (!a.ok) throw new Error(a.reason);
    const ta = tessellate(a.assembly);
    if (!ta.ok) throw new Error(ta.reason);
    // Each box written as its own STL (world coordinates, float32), read back, placed where it was.
    const one = (bi: number): Mesh => {
      const T: number[] = [];
      for (let k = 0; k < ta.mesh.triangles.length / 3; k++) if (ta.mesh.triBody[k] === bi) T.push(...ta.mesh.triangles.slice(3 * k, 3 * k + 3));
      return { ...ta.mesh, triangles: T };
    };
    const bodies = [0, 1].map((bi) => {
      const r = readStl(toStl(one(bi), "binary"));
      if (!r.ok) throw new Error(r.reason);
      const b = stlBody(r.stl, 1);
      if (!b.ok) throw new Error(b.reason);
      // stlBody moved it to the origin: put it back at its file's lowest corner (float32 of it).
      const lo = [0, 1, 2].map((k) => Math.min(...Array.from(r.stl.corners).filter((_, i) => i % 3 === k)));
      return { id: `s${bi}`, name: `S${bi}`, spec: { kind: "mesh" as const, mesh: b.body.mesh }, placement: { translate: lo as [number, number, number], rotateDeg: [0, 0, 0] as [number, number, number] } };
    });
    const tb = tessellate({ version: 1, bodies });
    if (!tb.ok) throw new Error(tb.reason);
    expect(ta.mesh.overlaps).toEqual([]);
    expect(tb.mesh.overlaps).toEqual([]);
    expect(tb.mesh.crossings.length).toBe(ta.mesh.crossings.length);
  });
});

describe("an imported part takes callouts and explodes like any part", () => {
  it("a callout on it resolves to its surface; the exploded view draws it moved apart", () => {
    const bytes = toStl(atOrigin(analytic("cylinder")), "binary");
    const r = readStl(bytes);
    if (!r.ok) throw new Error(r.reason);
    const hash = stlHash(bytes);
    rememberStl(hash, r.stl);
    const doc: CadDoc = {
      ...starterDoc("asme"),
      parts: [
        { id: "b", name: "Base", shape: "box", params: defaultParams("box"), placement: place },
        { id: "m", name: "Pin", shape: "mesh", params: {}, placement: { translate: [10, 5, 20], rotateDeg: [0, 0, 0] }, mesh: { file: "pin.stl", hash, facets: r.stl.count, mmPerUnit: 1, creaseDeg: 30, size: [20, 20, 40] } },
      ],
    };
    const a = docToAssembly(doc);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    // A point on the pin's top face (world): its centre.
    const top: [number, number, number] = [20, 15, 60];
    doc.callouts.push(attachCallout(doc, 1, top, "12", t.mesh));
    const res = resolveCallouts(doc, t.mesh);
    expect(res.notes).toEqual([]);
    expect(res.callouts.map((c) => c.anchor.map((v) => +v.toFixed(6)))).toEqual([top]);

    const offsets = autoExplode(doc, t.mesh);
    expect(offsets.m?.[2]).toBeGreaterThan(0);
    const ea = docToAssembly(explodedDoc(doc, offsets));
    if (!ea.ok) throw new Error(ea.reason);
    const et = tessellate(ea.assembly);
    if (!et.ok) throw new Error(et.reason);
    const sh = layoutSheet(t.mesh, { standard: "asme", views: [{ kind: "front" }, { kind: "exploded" }], callouts: res.callouts, exploded: { mesh: et.mesh, anchors: explodedAnchors(doc, res.callouts, offsets), trails: explodeTrails(doc, t.mesh, offsets) } });
    expect(sh.svg).toMatch(/<svg/);
    expect(sh.notes.join(" ")).not.toMatch(/not drawn|cannot/i);
  });
});

// ---- review round 1 ----------------------------------------------------------------------------
type P3 = [number, number, number];
const bin = (tris: P3[][]): Uint8Array => {
  const b = new Uint8Array(84 + 50 * tris.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, f) => t.forEach((p, c) => p.forEach((v, k) => dv.setFloat32(84 + 50 * f + 12 + 12 * c + 4 * k, v, true))));
  return b;
};
function cubeAt(o: P3, s: number, inward = false): P3[][] {
  const q = (a: number[], b: number[], c: number[], d: number[]): P3[][] => [[a, b, c], [a, c, d]].map((t) => t.map((p) => p.map((v, k) => o[k] + v * s) as P3));
  const f = [
    ...q([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]), ...q([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]),
    ...q([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]), ...q([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]),
    ...q([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]), ...q([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]),
  ];
  return inward ? f.map((t) => [t[0], t[2], t[1]]) : f;
}
const bodyOf = (b: Uint8Array) => {
  const r = readStl(b);
  if (!r.ok) throw new Error(r.reason);
  const s = stlBody(r.stl, 1);
  if (!s.ok) throw new Error(s.reason);
  return s.body;
};
const meshBody = (mesh: SolidMesh, name = "S") => ({ id: name, name, spec: { kind: "mesh" as const, mesh }, placement: { translate: [0, 0, 0] as P3, rotateDeg: [0, 0, 0] as P3 } });

describe("review round 1", () => {
  it("1. a gear-like prism (1,950 teeth, within every facet and edge limit) is refused by name in seconds, not drawn for 49 s", () => {
    const star = (n: number): P3[][] => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const r = i % 2 ? 40 : 46, a = (2 * Math.PI * i) / n;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      const t: P3[][] = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        t.push([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], 20]], [[a[0], a[1], 0], [b[0], b[1], 20], [a[0], a[1], 20]]);
        t.push([[0, 0, 0], [b[0], b[1], 0], [a[0], a[1], 0]], [[0, 0, 20], [a[0], a[1], 20], [b[0], b[1], 20]]);
      }
      return t;
    };
    const t = tessellate({ version: 1, bodies: [meshBody(bodyOf(bin(star(1950))).mesh)] });
    if (!t.ok) throw new Error(t.reason);
    const t0 = Date.now();
    const sh = layoutSheet(t.mesh, { standard: "asme", views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }] });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(sh.svg).toBe("");
    expect(sh.notes).toEqual(["The drawing has too many lines crossing one another on the page to work out in time — raise an imported part's edge angle, use fewer or simpler parts, or show fewer views."]);
    // A modest one still draws.
    const small = tessellate({ version: 1, bodies: [meshBody(bodyOf(bin(star(120))).mesh)] });
    if (!small.ok) throw new Error(small.reason);
    expect(layoutSheet(small.mesh, { standard: "asme", views: [{ kind: "front" }, { kind: "iso" }] }).svg).toMatch(/<svg/);
  }, 30000);

  it("2. a fan of 99,000 facets round one apex is read in n log n (was 15 s before its refusal)", () => {
    const n = 99_000;
    const tris: P3[][] = [];
    const p = (i: number): P3 => [10 * Math.cos((2 * Math.PI * i) / n), 10 * Math.sin((2 * Math.PI * i) / n), 0];
    for (let i = 0; i < n; i++) tris.push([[0, 0, 5], p(i), p((i + 1) % n)]);
    const r = readStl(bin(tris));
    if (!r.ok) throw new Error(r.reason);
    const t0 = Date.now();
    stlBody(r.stl, 1, 30);
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 30000);

  it("3. a cavity wound into the void stays a cavity: volume 1000 − 64, no facet turned, and a pin's crossings at its walls are drawn", () => {
    const b = bodyOf(bin([...cubeAt([0, 0, 0], 10), ...cubeAt([3, 3, 3], 4, true)]));
    const P = b.mesh.positions, T = b.mesh.triangles;
    let v = 0;
    for (let t = 0; t < T.length / 3; t++) {
      const [x, y, z] = [T[3 * t], T[3 * t + 1], T[3 * t + 2]].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
      v += x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    }
    expect(v / 6).toBeCloseTo(936, 6);
    expect(b.notes).toEqual([]);
    // Wound out (wrongly) instead: turned in, and said so.
    const w = bodyOf(bin([...cubeAt([0, 0, 0], 10), ...cubeAt([3, 3, 3], 4)]));
    expect(w.notes).toEqual(["12 facets were wound the wrong way and turned."]);
    // A pin through the block along x, at y, z 4.5–5.5 (through the cavity).
    const pinStl = bin(cubeAt([0, 0, 0], 1).map((t) => t.map((p) => [p[0] * 16 - 3, p[1] + 4.5, p[2] + 4.5] as P3)));
    const t = tessellate({ version: 1, bodies: [meshBody(b.mesh, "Hollow"), { ...meshBody(bodyOf(pinStl).mesh, "Pin"), placement: { translate: [-3, 4.5, 4.5] as P3, rotateDeg: [0, 0, 0] as P3 } }] });
    if (!t.ok) throw new Error(t.reason);
    const atX = (x: number): number => t.mesh.crossings.filter((c) => Math.abs(c.a[0] - x) < 1e-3 && Math.abs(c.b[0] - x) < 1e-3).length;
    expect(atX(3)).toBeGreaterThan(0);
    expect(atX(7)).toBeGreaterThan(0);
  });

  it("4. a text STL printed with six significant digits (%g): a mate finds the whole face (centre within 0.01 mm)", () => {
    const doc: CadDoc = { ...starterDoc("asme"), parts: [{ id: "a", name: "A", shape: "box", params: { ...defaultParams("box"), w: 33.3, d: 21.7, h: 9.1 }, placement: { translate: [101.1, 57.3, 13.9], rotateDeg: [17, 29, 41] } }] };
    const a = docToAssembly(doc);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    const g = (x: number): string => String(Number(x.toPrecision(6)));
    const lines = ["solid part"];
    const Tm = t.mesh.triangles, Pm = t.mesh.positions;
    for (let k = 0; k < Tm.length / 3; k++) {
      lines.push("facet normal 0 0 0", "outer loop");
      for (let c = 0; c < 3; c++) lines.push(`vertex ${[0, 1, 2].map((q) => g(Pm[3 * Tm[3 * k + c] + q])).join(" ")}`);
      lines.push("endloop", "endfacet");
    }
    lines.push("endsolid part");
    const m = imported(Uint8Array.from(lines.join("\n"), (ch) => ch.charCodeAt(0)));
    const P = m.positions, T = m.triangles;
    // Every face of the block (one triangle per distinct normal), clicked a little off its centre.
    const seenN: number[][] = [];
    for (let best = 0; best < T.length / 3; best++) {
      const n0 = [0, 1, 2].map((j) => m.cornerNormals[9 * best + j]);
      if (seenN.some((n) => n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.99999)) continue;
      seenN.push(n0);
      const corners = new Map<number, number[]>();
      for (let k = 0; k < T.length / 3; k++) {
        const n = [0, 1, 2].map((j) => m.cornerNormals[9 * k + j]);
        if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.99999) for (let j = 0; j < 3; j++) corners.set(T[3 * k + j], [0, 1, 2].map((q) => P[3 * T[3 * k + j] + q]));
      }
      const pts = [...corners.values()];
      expect(pts.length).toBe(4);
      const cx = [0, 1, 2].map((q) => pts.reduce((s, p) => s + p[q], 0) / 4) as P3;
      // Off the centre, in the face's plane.
      const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      const click = [0, 1, 2].map((q) => cx[q] + (0.3 * u[q]) / ul) as P3;
      const f = faceAt(m, best, click, 1);
      expect([seenN.length, f.ok && f.hit.snap]).toEqual([seenN.length, "centre"]);
      for (let q = 0; q < 3; q++) expect(Math.abs((f.ok ? f.hit.point[q] : 99) - cx[q])).toBeLessThan(0.01);
    }
    expect(seenN.length).toBe(6);
  });

  it("5. two closed cubes sharing one edge are closed (no 'gaps' claimed)", () => {
    const b = bodyOf(bin([...cubeAt([0, 0, 0], 10), ...cubeAt([10, 10, 0], 10)]));
    expect(b.mesh.closed).toBe(true);
    expect(b.notes.join(" ")).not.toMatch(/open/);
    expect(b.notes.join(" ")).toMatch(/shared by more than two facets/);
  });

  it("7. a text STL saved with a UTF-8 byte-order mark reads", () => {
    const raw = toStl(atOrigin(analytic("box")), "text");
    const withBom = new Uint8Array(raw.length + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(raw, 3);
    const r = readStl(withBom);
    expect(r.ok && r.stl.count).toBe(12);
  });

  it("memory: the store keeps the last six files; a part naming an older one says to import it again", () => {
    const refs: MeshRef[] = [];
    for (let i = 0; i < 7; i++) {
      const bytes = bin(cubeAt([0, 0, 0], 10 + i));
      const r = readStl(bytes);
      if (!r.ok) throw new Error(r.reason);
      const hash = stlHash(bytes);
      rememberStl(hash, r.stl);
      refs.push({ file: `c${i}.stl`, hash, facets: 12, mmPerUnit: 1, creaseDeg: 30, size: [1, 1, 1] });
    }
    expect(meshFor(refs[0]).ok).toBe(false);
    expect(meshFor(refs[1]).ok).toBe(true);
    expect(meshFor(refs[6]).ok).toBe(true);
  });
});
