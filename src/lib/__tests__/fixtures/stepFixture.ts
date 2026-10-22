// STEP files for the tests, written here (no third-party sample files in the repo): boxes and a cylinder as
// AP214 B-rep solids, each its own product, in a chosen length unit — read by the real engine (occtRun.js).

type Unit = "mm" | "inch" | "m";

/** A solid to write: an axis-aligned box from `at`, or a cylinder standing on `at` (its base centre). */
export type FixtureSolid =
  | { name: string; kind: "box"; at: [number, number, number]; size: [number, number, number] }
  | { name: string; kind: "cylinder"; at: [number, number, number]; r: number; h: number };

export function stepFile(solids: FixtureSolid[], unit: Unit = "mm"): string {
  const lines: string[] = [];
  let n = 0;
  const e = (s: string): string => {
    n++;
    lines.push(`#${n}=${s};`);
    return `#${n}`;
  };
  const f = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));
  const pt = (p: number[]): string => e(`CARTESIAN_POINT('',(${p.map(f).join(",")}))`);
  const dir = (d: number[]): string => e(`DIRECTION('',(${d.map(f).join(",")}))`);
  const axis = (o: number[], z: number[], x: number[]): string => e(`AXIS2_PLACEMENT_3D('',${pt(o)},${dir(z)},${dir(x)})`);

  const lenUnit =
    unit === "mm"
      ? e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")
      : unit === "m"
        ? e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.))")
        : (() => {
            const mm = e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
            const dim = e("DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)");
            const m = e(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${mm})`);
            return e(`(CONVERSION_BASED_UNIT('INCH',${m})LENGTH_UNIT()NAMED_UNIT(${dim}))`);
          })();
  const angle = e("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const solidAngle = e("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${lenUnit},'distance_accuracy_value','')`);
  const ctx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenUnit},${angle},${solidAngle}))REPRESENTATION_CONTEXT('',''))`);
  const appCtx = e("APPLICATION_CONTEXT('automotive design')");
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
  const prodCtx = e(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const defCtx = e(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);

  const edge = (a: string, b: string, pa: number[], pb: number[]): string => {
    const d = pb.map((v, i) => v - pa[i]);
    const l = Math.hypot(...d);
    const line = e(`LINE('',${pt(pa)},${e(`VECTOR('',${dir(d.map((v) => v / l))},1.)`)})`);
    return e(`EDGE_CURVE('',${a},${b},${line},.T.)`);
  };
  const loopFace = (surface: string, oriented: string[], same = true): string =>
    e(`ADVANCED_FACE('',(${e(`FACE_OUTER_BOUND('',${e(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`)}),${surface},${same ? ".T." : ".F."})`);
  const oe = (edgeId: string, forward: boolean): string => e(`ORIENTED_EDGE('',*,*,${edgeId},${forward ? ".T." : ".F."})`);

  const box = (at: number[], s: number[]): string => {
    const c = (i: number): number[] => [at[0] + (i & 1 ? s[0] : 0), at[1] + (i & 2 ? s[1] : 0), at[2] + (i & 4 ? s[2] : 0)];
    const v = Array.from({ length: 8 }, (_, i) => e(`VERTEX_POINT('',${pt(c(i))})`));
    const E = new Map<string, string>();
    const ed = (i: number, j: number): [string, boolean] => {
      const k = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!E.has(k)) E.set(k, edge(v[Math.min(i, j)], v[Math.max(i, j)], c(Math.min(i, j)), c(Math.max(i, j))));
      return [E.get(k)!, i < j];
    };
    // Each face's corners counter-clockwise seen from outside, with its outward normal.
    const faces: [number[], number[], number[]][] = [
      [[0, 2, 3, 1], [0, 0, -1], [1, 0, 0]],
      [[4, 5, 7, 6], [0, 0, 1], [1, 0, 0]],
      [[0, 1, 5, 4], [0, -1, 0], [1, 0, 0]],
      [[2, 6, 7, 3], [0, 1, 0], [1, 0, 0]],
      [[0, 4, 6, 2], [-1, 0, 0], [0, 1, 0]],
      [[1, 3, 7, 5], [1, 0, 0], [0, 1, 0]],
    ];
    const ids = faces.map(([q, nrm, x]) => {
      const plane = e(`PLANE('',${axis(c(q[0]), nrm, x)})`);
      return loopFace(plane, q.map((a, k) => { const [id, fwd] = ed(a, q[(k + 1) % 4]); return oe(id, fwd); }));
    });
    return e(`MANIFOLD_SOLID_BREP('',${e(`CLOSED_SHELL('',(${ids.join(",")}))`)})`);
  };

  const cylinder = (at: number[], r: number, h: number): string => {
    // One seam: the side is a single periodic face bounded by two circles and the seam line twice.
    const p0 = [at[0] + r, at[1], at[2]], p1 = [at[0] + r, at[1], at[2] + h];
    const v0 = e(`VERTEX_POINT('',${pt(p0)})`), v1 = e(`VERTEX_POINT('',${pt(p1)})`);
    const c0 = e(`EDGE_CURVE('',${v0},${v0},${e(`CIRCLE('',${axis(at, [0, 0, 1], [1, 0, 0])},${f(r)})`)},.T.)`);
    const c1 = e(`EDGE_CURVE('',${v1},${v1},${e(`CIRCLE('',${axis([at[0], at[1], at[2] + h], [0, 0, 1], [1, 0, 0])},${f(r)})`)},.T.)`);
    const seam = edge(v0, v1, p0, p1);
    const side = e(`CYLINDRICAL_SURFACE('',${axis(at, [0, 0, 1], [1, 0, 0])},${f(r)})`);
    const sideFace = loopFace(side, [oe(c0, true), oe(seam, true), oe(c1, false), oe(seam, false)]);
    const bottom = loopFace(e(`PLANE('',${axis(at, [0, 0, 1], [1, 0, 0])})`), [oe(c0, false)], false);
    const top = loopFace(e(`PLANE('',${axis([at[0], at[1], at[2] + h], [0, 0, 1], [1, 0, 0])})`), [oe(c1, true)], true);
    return e(`MANIFOLD_SOLID_BREP('',${e(`CLOSED_SHELL('',(${[sideFace, bottom, top].join(",")}))`)})`);
  };

  for (const s of solids) {
    const solid = s.kind === "box" ? box(s.at, s.size) : cylinder(s.at, s.r, s.h);
    const product = e(`PRODUCT('${s.name}','${s.name}','',(${prodCtx}))`);
    const form = e(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
    const def = e(`PRODUCT_DEFINITION('design','',${form},${defCtx})`);
    const shape = e(`PRODUCT_DEFINITION_SHAPE('','',${def})`);
    const rep = e(`ADVANCED_BREP_SHAPE_REPRESENTATION('${s.name}',(${axis([0, 0, 0], [0, 0, 1], [1, 0, 0])},${solid}),${ctx})`);
    e(`SHAPE_DEFINITION_REPRESENTATION(${shape},${rep})`);
  }
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('fixture.step','2026-10-21T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
