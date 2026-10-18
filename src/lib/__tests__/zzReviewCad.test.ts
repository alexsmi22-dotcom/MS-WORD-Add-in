import { tessellate, rotationMatrix, Mesh, Vec3 } from "../cadModel";
import { CadDoc, CadPart, defaultParams, docToAssembly, overlapNotes, parseDoc, serializeDoc, SHAPES } from "../cadShapes";
import { eulerFromMatrix, faceAt, mate } from "../cadMate";
import { autoExplode, explodedDoc, explodeTrails, explodedAnchors } from "../cadExplode";
import { layoutSheet, ViewSpec } from "../cadSheet";

const box = (id: string, w: number, d: number, h: number, t: Vec3, r: Vec3 = [0, 0, 0]): CadPart => ({ id, name: id, shape: "box", params: { ...defaultParams("box"), w, d, h }, placement: { translate: t, rotateDeg: r } });
const TABLE = (): CadDoc => ({
  v: 1,
  parts: [box("top", 100, 60, 4, [0, 0, 70]), box("leg1", 5, 5, 70, [0, 0, 0]), box("leg2", 5, 5, 70, [95, 0, 0]), box("leg3", 5, 5, 70, [95, 55, 0]), box("leg4", 5, 5, 70, [0, 55, 0])],
  callouts: [],
  standard: "uspto",
  views: [{ kind: "iso" }],
});
const meshOf = (d: CadDoc): Mesh => {
  const a = docToAssembly(d);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
};
const log = (...a: unknown[]): void => console.log(JSON.stringify(a));

test("R1 false 'no parts' note when exploded view dropped", () => {
  const d = TABLE();
  const sh = layoutSheet(meshOf(d), { standard: "uspto", views: [{ kind: "iso" }, { kind: "exploded" }] });
  log("R1 notes", sh.notes);
  const sh2 = layoutSheet(meshOf(d), { standard: "uspto", views: [{ kind: "exploded" }] });
  log("R1b notes", sh2.notes);
});

test("R2 detail of ASME front drops hidden lines", () => {
  const d = TABLE();
  d.parts.push(box("inner", 10, 10, 10, [45, 25, 30])); // something behind? use legs: front view hides leg3/leg4 behind leg2/leg1
  const m = meshOf(d);
  const views: ViewSpec[] = [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [50, 35], r: 10, factor: 2 }];
  const sh = layoutSheet(m, { standard: "asme", views });
  const hiddenGroup = sh.svg.match(/<g[^>]*hidden[^>]*>([\s\S]*?)<\/g>/);
  log("R2 hidden paths", (hiddenGroup?.[1].match(/<path/g) ?? []).length, sh.labels);
});

test("R3 balloons only in detail when no pictorial", () => {
  const d = TABLE();
  d.standard = "asme";
  d.callouts = [{ anchor: [2.5, 0, 35], label: "1" }];
  const m = meshOf(d);
  const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 35], r: 10, factor: 2 }];
  const sh = layoutSheet(m, { standard: "asme", views, callouts: [{ anchor: [2.5, 0, 35], label: "1" }] });
  const circles = sh.svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#fff"/g);
  log("R3", circles, sh.frames?.map((f) => [f.view, f.cell.x, f.cell.y, f.cell.w, f.cell.h]));
});

test("R4 detail scale label", () => {
  const d = TABLE();
  for (const f of [2, 3, 4, 5, 10]) {
    const sh = layoutSheet(meshOf(d), { standard: "asme", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r: 8, factor: f }] });
    log("R4", f, sh.scaleMmPerUnit, sh.labels, sh.notes);
  }
  for (const f of [2, 3, 4, 5, 10]) {
    const sh = layoutSheet(meshOf(d), { standard: "iso", views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r: 8, factor: f }], format: { size: "A4", orientation: "landscape" } as never });
    log("R4iso", f, sh.scaleMmPerUnit, sh.labels, sh.notes);
  }
});

test("R5 marks on detail/exploded survive parseDoc; letter reuse", () => {
  const d = TABLE();
  d.explode = { top: [0, 0, 30] };
  d.views = [{ kind: "exploded" }, { kind: "detail", letter: "A", of: "exploded", at: [1, 2], r: 5, factor: 2 }];
  d.marks = [{ kind: "text", view: "detail:A", at: [0, 0], text: "X" }, { kind: "text", view: "exploded", at: [0, 0], text: "Y" }];
  const r = parseDoc(serializeDoc(d));
  log("R5", r.ok ? r.doc.marks : r.reason);
  // damaged
  const bads: unknown[] = [
    { kind: "detail", letter: "A", of: "front", at: [0, 0], r: 1 },
    { kind: "detail", letter: "A", of: "front", at: null, r: 1, factor: 2 },
    { kind: "detail", letter: "AA", of: "front", at: [0, 0], r: 1, factor: 2 },
    { kind: "detail", letter: "A", of: "front", at: [0, 0, 0], r: 1, factor: 2 },
    { kind: "detail", letter: "A", of: "detail", at: [0, 0], r: 1, factor: 2 },
    { kind: "detail", letter: "A", of: "__proto__", at: [0, 0], r: 1, factor: 2 },
    { kind: "detail", letter: "A", of: "front", at: [0, 0], r: 1, factor: "2" },
    { kind: "detail", letter: "A", of: "front", at: [0, 0], r: 1, factor: 2, extra: "x".repeat(10) },
  ];
  for (const b of bads) {
    const x = JSON.parse(serializeDoc(d));
    x.views = [b];
    try {
      const q = parseDoc(JSON.stringify(x));
      log("R5b", q.ok ? "ok" : q.reason);
    } catch (e) {
      log("R5b CRASH", String(e));
    }
  }
  for (const ex of [null, [], 5, "x", { top: null }, { top: [1, 2] }, { top: [1, 2, 3, 4] }, { top: [1e308, 0, 0] }]) {
    const x = JSON.parse(serializeDoc(d));
    x.explode = ex;
    try {
      const q = parseDoc(JSON.stringify(x));
      log("R5c", ex, q.ok ? ["ok", q.doc.explode] : q.reason);
    } catch (e) {
      log("R5c CRASH", String(e));
    }
  }
});

test("R6 mate: gimbal lock, equal normals, bracket", () => {
  const d: CadDoc = { v: 1, parts: [box("top", 100, 60, 4, [0, 0, 0]), box("leg", 5, 8, 70, [150, 0, 0], [30, 90, 0])], callouts: [], standard: "uspto", views: [{ kind: "iso" }] };
  const m = meshOf(d);
  // pick a triangle of leg and top
  const findTri = (b: number, n: Vec3): number => {
    for (let t = 0; t < m.triangles.length / 3; t++) {
      if (m.triBody[t] !== b) continue;
      const f = faceAt(m, t, [0, 0, 0], 0);
      if (f.ok && Math.abs(f.hit.normal[0] - n[0]) + Math.abs(f.hit.normal[1] - n[1]) + Math.abs(f.hit.normal[2] - n[2]) < 1e-6) return t;
    }
    return -1;
  };
  const topUp = findTri(0, [0, 0, 1]);
  const ctr = (t: number): Vec3 => [0, 1, 2].map((k) => [0, 1, 2].reduce((a, j) => a + m.positions[3 * m.triangles[3 * t + j] + k] / 3, 0)) as Vec3;
  const tg = faceAt(m, topUp, ctr(topUp), 1000);
  for (let t = 0; t < m.triangles.length / 3; t++) {
    if (m.triBody[t] !== 1) continue;
    const f = faceAt(m, t, ctr(t), 0);
    if (!f.ok || !tg.ok) continue;
    const r = mate(f.hit, tg.hit, d.parts[1].placement);
    if (!r.ok) { log("R6 fail", r.reason); continue; }
    const d2: CadDoc = { ...d, parts: [d.parts[0], { ...d.parts[1], placement: r.placement }] };
    const m2 = meshOf(d2);
    // leg's min z must be 4 exactly (sits on top)
    let lo = Infinity;
    for (let i = 0; i < m2.triangles.length; i++) if (m2.triBody[Math.floor(i / 3)] === 1) lo = Math.min(lo, m2.positions[3 * m2.triangles[i] + 2]);
    if (Math.abs(lo - 4) > 1e-9 || overlapNotes(d2, m2).length || m2.crossings.length) log("R6 BAD", f.hit.normal, r.placement, lo, overlapNotes(d2, m2), m2.crossings.length);
  }
  // equal normals: leg top (+z) onto top's top (+z)
  const d3: CadDoc = { v: 1, parts: [box("top", 100, 60, 4, [0, 0, 0]), box("leg", 5, 8, 70, [150, 0, 0])], callouts: [], standard: "uspto", views: [{ kind: "iso" }] };
  const m3 = meshOf(d3);
  const legTop = faceAt(m3, (() => { for (let t = 0; t < m3.triangles.length / 3; t++) if (m3.triBody[t] === 1) { const f = faceAt(m3, t, [0, 0, 0], 0); if (f.ok && f.hit.normal[2] > 0.99) return t; } return -1; })(), [152.5, 4, 70], 100);
  const topTop = faceAt(m3, (() => { for (let t = 0; t < m3.triangles.length / 3; t++) if (m3.triBody[t] === 0) { const f = faceAt(m3, t, [0, 0, 0], 0); if (f.ok && f.hit.normal[2] > 0.99) return t; } return -1; })(), [50, 30, 4], 100);
  if (legTop.ok && topTop.ok) log("R6 equal normals", legTop.hit.snap, topTop.hit.snap, mate(legTop.hit, topTop.hit, d3.parts[1].placement));
});

test("R7 euler round trip random", () => {
  let worst = 0;
  let s = 1;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20000; i++) {
    const a: Vec3 = [rnd() * 360 - 180, rnd() * 180 - 90, rnd() * 360 - 180];
    if (i % 3 === 0) a[1] = 90 * (rnd() < 0.5 ? -1 : 1) + (rnd() - 0.5) * 1e-6;
    const R = rotationMatrix(a);
    const B = rotationMatrix(eulerFromMatrix(R));
    for (let k = 0; k < 9; k++) worst = Math.max(worst, Math.abs(R[k] - B[k]));
  }
  log("R7 worst", worst);
});

test("R8 diagonal explode trail starts in the air", () => {
  const d = TABLE();
  const m = meshOf(d);
  log("R8", explodeTrails(d, m, { top: [40, 0, 40] }));
  log("R8b leg down", explodeTrails(d, m, { leg1: [0, 0, -30] }));
  log("R8c top and legs same lift", explodeTrails(d, m, { top: [0, 0, 30], leg1: [0, 0, 30] }));
});

test("R9 autoExplode variants", () => {
  // aprons
  const d = TABLE();
  d.parts.push(box("apronF", 90, 2, 10, [5, 0, 60]), box("apronB", 90, 2, 10, [5, 58, 60]));
  const m = meshOf(d);
  const off = autoExplode(d, m);
  log("R9 aprons", off);
  const em = meshOf(explodedDoc(d, off));
  log("R9 overlaps after explode", overlapNotes(explodedDoc(d, off), em));
  log("R9 trails", explodeTrails(d, m, off).length);
  // hanging lamp: base above
  const d2: CadDoc = { ...TABLE(), parts: [box("ceiling", 100, 100, 5, [0, 0, 100]), box("rod", 2, 2, 50, [49, 49, 50]), box("shade", 30, 30, 10, [35, 35, 40])] };
  log("R9 lamp", autoExplode(d2, meshOf(d2)));
});

test("R10 big detail radius / detail outside geometry / huge", () => {
  const d = TABLE();
  const m = meshOf(d);
  for (const [at, r] of [[[2.5, 70], 500], [[1000, 1000], 5], [[2.5, 70], 1e7]] as Array<[[number, number], number]>) {
    const sh = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at, r, factor: 10 }] });
    log("R10", at, r, sh.scaleMmPerUnit, sh.widthPx, sh.labels, sh.notes);
  }
});

test("R11 bracket vs callouts and sheet", () => {
  const d = TABLE();
  d.callouts = [{ anchor: [50, 30, 74], label: "10", part: "top", local: [50, 30, 4] }, { anchor: [0, 2.5, 35], label: "12", part: "leg1", local: [0, 2.5, 35] }];
  const m = meshOf(d);
  const off = autoExplode(d, m);
  const placed = [{ anchor: [50, 30, 74] as Vec3, label: "10", src: 0 }, { anchor: [0, 2.5, 35] as Vec3, label: "12", src: 1 }];
  const em = meshOf(explodedDoc(d, off));
  const sh = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }, { kind: "exploded" }], callouts: placed, exploded: { mesh: em, anchors: explodedAnchors(d, placed, off), trails: explodeTrails(d, m, off) } });
  log("R11", sh.widthPx, sh.heightPx, sh.frames?.map((f) => [f.view, f.ox, f.cell.x, f.cell.w]), sh.notes);
  const vis = sh.svg.match(/<path d="M[^"]*"[^>]*\/>/g)?.filter((p) => /L[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+M/.test(p) && p.split("M").length === 3);
  log("R11 bracket", vis);
  const texts = sh.svg.match(/<text x="[\d.]+" y="[\d.]+" dy="0.35em"[^>]*>[^<]*</g);
  log("R11 numerals", texts);
});

test("R2b hidden in detail", () => {
  const d: CadDoc = { v: 1, parts: [box("wall", 100, 5, 100, [0, 0, 0]), box("blk", 20, 20, 20, [40, 50, 40])], callouts: [], standard: "asme", views: [] };
  const m = meshOf(d);
  for (const std of ["asme", "iso"] as const) {
    const sh = layoutSheet(m, { standard: std, views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [50, 50], r: 15, factor: 2 }] });
    const g = sh.svg.match(/<g data-layer="hidden">([\s\S]*?)<\/g>/);
    log("R2b", std, (g?.[1].match(/<path/g) ?? []).length, sh.labels, sh.notes);
  }
});

test("R12 WIP two-pass detail scale consistency", () => {
  const d = TABLE();
  const m = meshOf(d);
  const bad: unknown[] = [];
  for (const std of ["asme", "iso"] as const)
    for (const f of [2, 3, 4, 5, 10])
      for (const r of [2, 5, 8, 12, 20, 30, 40, 60]) {
        const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r, factor: f }];
        const sh = layoutSheet(m, { standard: std, views });
        if (!sh.svg) { bad.push(["refused", std, f, r, sh.notes]); continue; }
        const lab = sh.labels[3];
        const k = lab.match(/(\d[\d.]*):(\d[\d.]*)/);
        const val = k ? +k[1] / +k[2] : NaN;
        const STD = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500, 1 / 1000];
        const isStd = STD.some((x) => Math.abs(x - val) < 1e-9 * x);
        // actual drawn enlargement: measure circle in detail cell? use notes
        if (!isStd || val <= sh.scaleMmPerUnit * (1 + 1e-9)) bad.push([std, f, r, sh.scaleMmPerUnit, lab, sh.notes]);
      }
  log("R12 bad", bad);
});
