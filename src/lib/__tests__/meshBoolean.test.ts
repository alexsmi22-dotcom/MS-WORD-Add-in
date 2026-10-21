// Combining imported parts (docs/SCOPE-MESH-BOOLEANS.md), against the REAL engine: manifold-3d runs in a child
// process (fixtures/manifoldRun.mjs — it is ESM-only), behind the same BoolEngine contract the pane's adapter keeps.
// Small meshes only (QC memory).
import { execFileSync } from "child_process";
import * as path from "path";
import { combineMeshes, worldMesh, type BoolEngine, type BoolOp, type EngineMesh } from "../meshBoolean";
import { combinedFor, rememberStl, retainCombined, type MeshRef } from "../cadMeshStore";
import { combineTwo, ensureCombined, separatedOperands } from "../combineParts";
import { combineKey, docToAssembly, moveCallouts, parseDoc, partProblems, serializeDoc, starterDoc, type CadDoc, type CadPart, type DocCallout } from "../cadShapes";
import { stlBody, type StlFacets } from "../stl";
import { apply3, rotationMatrix, type Placement, type SolidMesh, type Vec3 } from "../cadModel";
import { DEFAULT_STANDARD } from "../cadStandards";

const RUN = path.join(__dirname, "fixtures", "manifoldRun.mjs");
const engine: BoolEngine = {
  version: "3.5.4",
  run(op: BoolOp, a: EngineMesh, b: EngineMesh) {
    const json = execFileSync(process.execPath, [RUN], { input: JSON.stringify({ op, a: { positions: Array.from(a.positions), triangles: Array.from(a.triangles) }, b: { positions: Array.from(b.positions), triangles: Array.from(b.triangles) } }), encoding: "utf8" });
    return JSON.parse(json);
  },
};

/** A box's 12 facets, lowest corner at the origin. */
function boxFacets(w: number, d: number, h: number): StlFacets {
  const v = (x: number, y: number, z: number): number[] => [x * w, y * d, z * h];
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const c: number[] = [];
  for (const [p, q, r, s] of quads) c.push(...p, ...q, ...r, ...p, ...r, ...s);
  return { format: "binary", corners: Float64Array.from(c), count: c.length / 9, unreadable: 0 };
}

/** An n-gon prism (a "cylinder"), radius r, height h, centred on the origin's z axis, base at z = 0. */
function prismFacets(r: number, h: number, n: number): StlFacets {
  const c: number[] = [];
  // k wraps at n: sin(2π) is not exactly 0, and the last side would miss the first by a sliver.
  const at = (k: number, z: number): number[] => [r * Math.cos((2 * Math.PI * (k % n)) / n) + r, r * Math.sin((2 * Math.PI * (k % n)) / n) + r, z];
  for (let k = 0; k < n; k++) {
    const a0 = at(k, 0), a1 = at(k + 1, 0), b0 = at(k, h), b1 = at(k + 1, h);
    c.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0); // side
    c.push(r, r, 0, ...a1, ...a0); // bottom (facing down)
    c.push(r, r, h, ...b0, ...b1); // top
  }
  return { format: "binary", corners: Float64Array.from(c), count: c.length / 9, unreadable: 0 };
}

const body = (f: StlFacets): SolidMesh => {
  const b = stlBody(f, 1, 30);
  if (!b.ok) throw new Error(b.reason);
  return b.body.mesh;
};

/** The enclosed volume (divergence theorem over the triangles). */
function volume(m: SolidMesh): number {
  let v = 0;
  const P = m.positions;
  for (let t = 0; t < m.triangles.length; t += 3) {
    const [a, b, c] = [m.triangles[t], m.triangles[t + 1], m.triangles[t + 2]].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(v);
}

const at = (translate: Vec3, rotateDeg: Vec3 = [0, 0, 0]): Placement => ({ translate, rotateDeg });
const polygonArea = (r: number, n: number): number => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

describe("combining against the real engine: volumes, flush contact, refusals", () => {
  const cube = body(boxFacets(20, 20, 20));
  const rod = body(prismFacets(5, 20, 64));
  test("a cube minus a rod exactly as tall: a clean through-hole (no skin over either end)", () => {
    const r = combineMeshes(engine, "subtract", { mesh: cube, placement: at([0, 0, 0]) }, { mesh: rod, placement: at([5, 5, 0]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.mesh.closed).toBe(true);
    expect(volume(r.mesh)).toBeCloseTo(8000 - polygonArea(5, 64) * 20, 1);
  });
  test("two boxes sharing a face join into one box: no internal face is left", () => {
    const b10 = body(boxFacets(10, 10, 10));
    const r = combineMeshes(engine, "union", { mesh: b10, placement: at([0, 0, 0]) }, { mesh: b10, placement: at([10, 0, 0]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(volume(r.mesh)).toBeCloseTo(2000, 3);
    // A plain 20 × 10 × 10 box as drawn: no edge in the plane where they met (x = 10), and the drawn lines add up to
    // the outline's 4 × 20 + 8 × 10 = 160 mm (the long edges may be split there, collinear — the drawing is the same).
    const P = r.mesh.positions, E = r.mesh.edges;
    let length = 0;
    for (let i = 0; i < E.length; i += 2) {
      const [p, q] = [E[i], E[i + 1]].map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
      expect(p[0] === 10 && q[0] === 10).toBe(false);
      length += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    }
    expect(length).toBeCloseTo(160, 6);
  });
  test("an overlap keeps only the shared volume, placed where it is", () => {
    const b10 = body(boxFacets(10, 10, 10));
    const r = combineMeshes(engine, "intersect", { mesh: b10, placement: at([0, 0, 0]) }, { mesh: b10, placement: at([5, 5, 5]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(volume(r.mesh)).toBeCloseTo(125, 3);
    expect(r.placement.translate.map((x) => +x.toFixed(4))).toEqual([5, 5, 5]);
  });
  test.each([
    ["parts that do not touch, joined", "union" as BoolOp, /do not join into one piece/],
    ["an overlap of parts that do not touch", "intersect" as BoolOp, /nothing is left/],
  ])("%s is refused by name", (_why, op, re) => {
    const b10 = body(boxFacets(10, 10, 10));
    const r = combineMeshes(engine, op, { mesh: b10, placement: at([0, 0, 0]) }, { mesh: b10, placement: at([30, 0, 0]) }, 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });
  test("an open surface is refused before the engine is asked", () => {
    const open = { ...body(boxFacets(10, 10, 10)), closed: false };
    const r = combineMeshes(engine, "union", { mesh: open, placement: at([0, 0, 0]) }, { mesh: cube, placement: at([0, 0, 0]) }, 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not enclose a volume/);
  });
  test("a part's placement (a turn and a move) is applied before combining", () => {
    const w = worldMesh(body(boxFacets(10, 20, 30)), at([100, 0, 0], [0, 0, 90]));
    const xs = Array.from({ length: w.positions.length / 3 }, (_, i) => w.positions[3 * i]);
    expect(Math.min(...xs)).toBeCloseTo(80, 6); // the 20-deep side turned onto −x, then moved +100
  });
});

describe("the recipe: a drawing carries operands, never triangles", () => {
  const ref = (hash: string, size: Vec3): MeshRef => ({ file: `${hash.slice(0, 4)}.stl`, hash, facets: 12, mmPerUnit: 1, creaseDeg: 30, size });
  const meshPart = (id: string, hash: string, f: StlFacets, size: Vec3, translate: Vec3): CadPart => {
    rememberStl(hash, f);
    return { id, name: id, shape: "mesh", params: {}, placement: at(translate), mesh: ref(hash, size) };
  };
  const A = (): CadPart => meshPart("A", "0123456789abcdef-1", boxFacets(20, 20, 20), [20, 20, 20], [0, 0, 0]);
  const B = (): CadPart => meshPart("B", "fedcba9876543210-2", prismFacets(5, 20, 64), [10, 10, 20], [5, 5, 0]);

  test("combineTwo caches the result; docToAssembly draws it; the JSON has no triangles", () => {
    const r = combineTwo(engine, "subtract", A(), B(), "C", "A − B");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const doc: CadDoc = { ...starterDoc(DEFAULT_STANDARD), parts: [r.part], callouts: [] };
    expect(partProblems(r.part)).toEqual([]);
    expect(docToAssembly(doc).ok).toBe(true);
    const json = serializeDoc(doc);
    expect(json).not.toMatch(/positions|triangles|corners/);
    const back = parseDoc(json);
    expect(back.ok).toBe(true);
    if (back.ok) expect(combineKey(back.doc.parts[0])).toBe(combineKey(r.part));
  });

  test("a result the cache lost is never drawn as its operands — it is computed again (ensureCombined)", () => {
    const r = combineTwo(engine, "union", A(), meshPart("D", "00000000000000aa-3", boxFacets(20, 20, 20), [20, 20, 20], [20, 0, 0]), "E", "A + D");
    if (!r.ok) throw new Error(r.reason);
    // Two newer results, then nothing named: the store keeps two spare, so this older one goes.
    for (const [id, hash, x] of [["J", "00000000000000c1-5", 40], ["K", "00000000000000c2-6", 40]] as const) {
      const q = combineTwo(engine, "union", A(), meshPart(id, hash, boxFacets(20, 20, 20), [20, 20, 20], [x - 20, 0, 0]), `${id}2`, id);
      if (!q.ok) throw new Error(q.reason);
    }
    retainCombined([]);
    expect(combinedFor(combineKey(r.part))).toBeUndefined();
    expect(partProblems(r.part)).toEqual(["it is being combined (or combine it again)"]);
    expect(ensureCombined(engine, r.part).ok).toBe(true);
    expect(partProblems(r.part)).toEqual([]);
  });

  test("a callout keeps pointing where it did when its part is combined", () => {
    const a = A();
    const b = B();
    const r = combineTwo(engine, "subtract", a, b, "F", "A − B");
    if (!r.ok) throw new Error(r.reason);
    const callouts: DocCallout[] = [{ label: "10", anchor: [20, 10, 10], part: "A", local: [20, 10, 10] } as DocCallout];
    expect(moveCallouts(callouts, [a, b], r.part)).toEqual(["10"]);
    const world = callouts[0].local!.map((x, k) => x + r.part.placement.translate[k]);
    expect(world.map((x) => +x.toFixed(6))).toEqual([20, 10, 10]);
    expect(callouts[0].part).toBe("F");
  });

  test.each([
    ["an unknown operation", (p: CadPart) => ({ ...p, combine: { ...p.combine!, op: "xor" } })],
    ["a catalogue part as an operand", (p: CadPart) => ({ ...p, combine: { ...p.combine!, operands: [{ ...p.combine!.operands[0], shape: "box" }, p.combine!.operands[1]] } })],
    ["three operands", (p: CadPart) => ({ ...p, combine: { ...p.combine!, operands: [...p.combine!.operands, p.combine!.operands[0]] } })],
  ])("a saved drawing with %s is refused by name", (_why, damage) => {
    const r = combineTwo(engine, "union", A(), meshPart("G", "00000000000000bb-4", boxFacets(20, 20, 20), [20, 20, 20], [20, 0, 0]), "H", "A + G");
    if (!r.ok) throw new Error(r.reason);
    const doc = { ...starterDoc(DEFAULT_STANDARD), parts: [damage(r.part)], callouts: [] };
    expect(parseDoc(JSON.stringify(doc)).ok).toBe(false);
  });

  test("combinations nest no deeper than MAX_COMBINE_DEPTH", () => {
    let n = 0;
    const tree = (h: number): CadPart =>
      h === 0
        ? { id: `m${n++}`, name: "m", shape: "mesh", params: {}, placement: at([0, 0, 0]), mesh: ref("0123456789abcdef-1", [20, 20, 20]) }
        : { id: `c${n++}`, name: "c", shape: "combine", params: {}, placement: at([0, 0, 0]), combine: { op: "union", operands: [tree(h - 1), tree(0)], at: [0, 0, 0] } };
    const p = tree(6);
    const r = parseDoc(JSON.stringify({ ...starterDoc(DEFAULT_STANDARD), parts: [p], callouts: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/deeper than 4/);
  });
});

describe("the hands-on walk: a cut that misses, and a join that changes nothing", () => {
  const cube = body(boxFacets(20, 20, 20));
  const rod = body(prismFacets(5, 20, 64));
  test("a cut that misses the part is refused by name (an imported part is placed beside the others)", () => {
    const r = combineMeshes(engine, "subtract", { mesh: cube, placement: at([90, 0, 0]) }, { mesh: rod, placement: at([5, 5, 0]) }, 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/do not overlap — nothing would be cut/);
  });
  test("a join with one part wholly inside the other says so", () => {
    const r = combineMeshes(engine, "union", { mesh: cube, placement: at([0, 0, 0]) }, { mesh: body(boxFacets(5, 5, 5)), placement: at([5, 5, 5]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.notes.join(" ")).toMatch(/wholly inside/);
  });
});

describe("review round: small cuts, depth, Separate after a move, nested ids", () => {
  const ref = (hash: string, size: Vec3): MeshRef => ({ file: `${hash.slice(0, 4)}.stl`, hash, facets: 12, mmPerUnit: 1, creaseDeg: 30, size });
  const meshPart = (id: string, hash: string, f: StlFacets, size: Vec3, translate: Vec3): CadPart => {
    rememberStl(hash, f);
    return { id, name: id, shape: "mesh", params: {}, placement: at(translate), mesh: ref(hash, size) };
  };
  test("a small real cut in a large part is a cut (the bound is not relative to the part's volume)", () => {
    const big = body(boxFacets(200, 200, 200));
    const r = combineMeshes(engine, "subtract", { mesh: big, placement: at([0, 0, 0]) }, { mesh: body(boxFacets(0.5, 0.5, 2)), placement: at([100, 100, 199]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(volume(r.mesh)).toBeCloseTo(8e6 - 0.25, 1);
    const boss = combineMeshes(engine, "union", { mesh: big, placement: at([0, 0, 0]) }, { mesh: body(boxFacets(0.5, 0.5, 2)), placement: at([100, 100, 199]) }, 30);
    expect(boss).toMatchObject({ ok: true });
    if (boss.ok) expect(boss.notes.join(" ")).not.toMatch(/wholly inside/);
  });
  test("a cut into the notch of an L — inside its box, touching nothing — still misses", () => {
    const L = combineMeshes(engine, "union", { mesh: body(boxFacets(40, 20, 20)), placement: at([0, 0, 0]) }, { mesh: body(boxFacets(20, 20, 20)), placement: at([0, 20, 0]) }, 30);
    if (!L.ok) throw new Error(L.reason);
    const r = combineMeshes(engine, "subtract", { mesh: L.mesh, placement: L.placement }, { mesh: body(boxFacets(10, 10, 10)), placement: at([25, 25, 5]) }, 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/nothing would be cut/);
  });
  test("the pane cannot nest a combination deeper than a drawing can be read back", () => {
    let p = meshPart("d0", "00000000000000d0-7", boxFacets(20, 20, 20), [20, 20, 20], [0, 0, 0]);
    for (let i = 1; i <= 5; i++) {
      const q = meshPart(`d${i}`, `00000000000000d${i}-7`, boxFacets(20, 20, 20), [20, 20, 20], [10 * i, 0, 0]);
      const r = combineTwo(engine, "union", p, q, `u${i}`, `u${i}`);
      if (i <= 4) {
        if (!r.ok) throw new Error(r.reason);
        p = r.part;
        expect(parseDoc(serializeDoc({ ...starterDoc(DEFAULT_STANDARD), parts: [p], callouts: [] })).ok).toBe(true);
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/at most 4 combinations/);
      }
    }
  });
  test.each([
    ["moved", at([100, 0, 0])],
    ["moved and turned", at([100, 40, 0], [0, 0, 90])],
    ["turned about two axes", at([-30, 10, 50], [30, 0, 45])],
    ["turned a quarter about Y (the X and Z turns then coincide)", at([0, 0, 0], [20, 90, 10])],
  ])("Separate after the combined part is %s: the operands stay where it is drawn, and so do its callouts", (_why, pl) => {
    const a = meshPart("SA", "00000000000000e1-8", boxFacets(20, 20, 20), [20, 20, 20], [0, 0, 0]);
    const b = meshPart("SB", "00000000000000e2-8", boxFacets(10, 10, 30), [10, 10, 30], [5, 5, 0]);
    const r = combineTwo(engine, "union", a, b, "SC", "SA + SB");
    if (!r.ok) throw new Error(r.reason);
    const c: CadPart = { ...r.part, placement: pl };
    const drawn = worldMesh(combinedFor(combineKey(c))!.mesh, c.placement);
    const [sa, sb] = separatedOperands(c);
    const box = (m: EngineMesh): number[] => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.positions.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], m.positions[i]);
        hi[i % 3] = Math.max(hi[i % 3], m.positions[i]);
      }
      return [...lo, ...hi].map((x) => +x.toFixed(4) + 0);
    };
    const wa = worldMesh(body(boxFacets(20, 20, 20)), sa.placement), wb = worldMesh(body(boxFacets(10, 10, 30)), sb.placement);
    const both = box({ positions: Float64Array.from([...Array.from(wa.positions), ...Array.from(wb.positions)]), triangles: [] });
    expect(both).toEqual(box(drawn));
    // A callout on the combined part, put on SA by Separate, still points at the same place.
    const callouts: DocCallout[] = [{ label: "12", anchor: [0, 0, 0], part: "SC", local: [20, 10, 10] } as DocCallout];
    const world = (p: Vec3, q: Placement): number[] => apply3(rotationMatrix(q.rotateDeg), p).map((x, k) => +(x + q.translate[k]).toFixed(6) + 0);
    const before = world([20, 10, 10], c.placement);
    moveCallouts(callouts, [c], sa);
    expect(world(callouts[0].local!, sa.placement)).toEqual(before);
  });
  test.each([
    ["a 10 m slab trimming the top 1 mm", at([-5000, -5000, 19]), [10000, 10000, 10], 8000 - 400],
    ["a 1 m block shaving 0.002 mm", at([-500, -500, 19.998]), [1000, 1000, 10], 8000 - 0.8],
  ])("an oversized cutter is still a cut: %s", (_why, pl, size, left) => {
    const r = combineMeshes(engine, "subtract", { mesh: body(boxFacets(20, 20, 20)), placement: at([0, 0, 0]) }, { mesh: body(boxFacets(size[0], size[1], size[2])), placement: pl }, 30);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(volume(r.mesh)).toBeCloseTo(left, 2);
  });
  test("a small cut in a large part far from the origin is a cut, and the right size", () => {
    const r = combineMeshes(engine, "subtract", { mesh: body(boxFacets(1000, 1000, 1000)), placement: at([1e5, 0, 0]) }, { mesh: body(boxFacets(1, 1, 0.8)), placement: at([1e5 + 500, 500, 999.9]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(1e9 - volume(r.mesh)).toBeCloseTo(0.1, 2);
    const cyl = combineMeshes(engine, "subtract", { mesh: body(prismFacets(7.3, 11.1, 48)), placement: at([1e5 + 0.1, 0, 0]) }, { mesh: body(boxFacets(3, 3, 3)), placement: at([1e5 + 0.1 + 6, 6, 11.09]) }, 30);
    expect(cyl).toMatchObject({ ok: true });
    if (cyl.ok) expect(polygonArea(7.3, 48) * 11.1 - volume(cyl.mesh)).toBeCloseTo(0.09, 3);
  });
  test("a small boss on a large part is not 'wholly inside'", () => {
    const r = combineMeshes(engine, "union", { mesh: body(boxFacets(1000, 1000, 1000)), placement: at([0, 0, 0]) }, { mesh: body(boxFacets(0.5, 0.5, 1)), placement: at([500, 500, 999.2]) }, 30);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.notes.join(" ")).not.toMatch(/wholly inside/);
  });
  test("a saved combined part without the point it was made at is refused (Separate could not place it)", () => {
    const a = meshPart("WA", "00000000000000a1-9", boxFacets(20, 20, 20), [20, 20, 20], [0, 0, 0]);
    const b = meshPart("WB", "00000000000000a2-9", boxFacets(20, 20, 20), [20, 20, 20], [10, 0, 0]);
    const r = combineTwo(engine, "union", a, b, "WC", "WA + WB");
    if (!r.ok) throw new Error(r.reason);
    const { at: _at, ...noAt } = r.part.combine!;
    void _at;
    expect(parseDoc(JSON.stringify({ ...starterDoc(DEFAULT_STANDARD), parts: [{ ...r.part, combine: noAt }], callouts: [] })).ok).toBe(false);
  });
  test("a saved drawing whose combined part reuses another part's id is refused (Separate would duplicate it)", () => {
    const a = meshPart("NA", "00000000000000f1-9", boxFacets(20, 20, 20), [20, 20, 20], [0, 0, 0]);
    const b = meshPart("NB", "00000000000000f2-9", boxFacets(20, 20, 20), [20, 20, 20], [10, 0, 0]);
    const r = combineTwo(engine, "union", a, b, "NC", "NA + NB");
    if (!r.ok) throw new Error(r.reason);
    const doc = { ...starterDoc(DEFAULT_STANDARD), parts: [r.part, { ...a }], callouts: [] };
    const back = parseDoc(JSON.stringify(doc));
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.reason).toMatch(/share one id/);
  });
});
