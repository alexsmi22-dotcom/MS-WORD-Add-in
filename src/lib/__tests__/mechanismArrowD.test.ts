// Release D: the curved-arrow case table, written BEFORE the planner was rebuilt (the method that failed three rounds
// was tuning against single examples). Every row is a measured assertion on the arrow as drawn (mechMeasure.ts), on
// scenes drawn with the editor exactly as a user draws them (mechScenes.ts — the round-3 reviewer's scenes):
//   clean  = no non-own bond line within 1 pt (ink to ink), no other label's letters within 1 pt (its own 0.6 pt),
//            no charge sign or radical dot within 1 pt, no other arrow within 1.5 pt, the head 0.15 bond length off
//            every bond but its target, the sweep at most 110°;
//   (a) EAS step 2 (arenium C–H → the ring C–C⁺ bond, + at either vertex): the default arrow is clean;
//   (b) homolysis at 12 angles (Br–Br, C–O–O–C) and the peroxide zigzag: each fishhook's tail in the bond's middle,
//       its tip within 2 pt of its own atom's letters and pointing at them, both hooks on one side, mirror images;
//   (c) C–Br → Br at 12 directions: the tail within 3 pt of the visible bond, the head onto Br from outside;
//   (d) no default sweep over 110°;  (e) every arrow ≥ 1.5 pt from the arrows already on the page;
//   plus every scene the reviewer called clean and the round-3 defect scenes; and a flipped arrow (Shift / click) is
//   either clean too or refused by name — never drawn through something.
// Earlier rows (R08, R09/R09b, R11, R2-06, R2-07/07b) stay in mechanismArrowCases.test.ts (cumulative gate).
import type { Box, CdxDoc, CdxNode, Pt } from "../cdxml";
import { aimBox, distToTrace } from "../cdxArrows";
import { labelInk } from "../cdxGlyphs";
import { scene, MECH, GRID, gridCell, L, Scene } from "./mechScenes";
import { measureArrow, nodesOf, bondsOf, rayHitsBox, rayDist, dbox, ArrowMeasure } from "./mechMeasure";

/**
 * Rows that FAIL today, pinned as failing (jest's test.failing: a row that starts to pass turns red, so the table is
 * revisited). Release D measured why: a fishhook from a bond to its own labelled atom cannot both start in the bond's
 * middle and land on its atom's letters pointing at them within a 110° sweep — the head has to turn down onto the
 * letters, and from a tail near the bond that turn alone takes about 120–145° (round 3's "clean" horizontal Br–Br
 * homolysis swept 165°). Rows (b) and (d) conflict there; the planner keeps (d) and refuses those fishhooks by name.
 * (c) k = 3 and 6: the only clean arcs start 3.8 pt off the bond (the row asks ≤ 3 pt).
 * eas2b (row a with E on the sp3 carbon BETWEEN its H and the target bond): every arc from the C–H bond to that ring
 * bond crosses the C–E bond or the ring bond on the other side — refused by name (an earlier build crossed the ring bond
 * at its vertex, which the measure now catches).
 */
const KNOWN_FAILING = new Set([
  "scene homolysisBr2",
  "scene homolysisPeroxide",
  "scene eas2b",
  "hop 3",
  "hop 6",
  ...Array.from({ length: 12 }, (_, k) => "Br2 " + k),
  ...Array.from({ length: 12 }, (_, k) => "OO " + k),
  "peroxide zigzag",
  "horizontal Br2",
]);
const row = (key: string): typeof test => (KNOWN_FAILING.has(key) ? test.failing : test);

const build = (f: (m: Scene) => void): Scene => {
  const m = scene();
  f(m);
  m.re();
  return m;
};
const node = (d: CdxDoc, id: string): CdxNode => nodesOf(d).get(id)!;
const ink = (d: CdxDoc, id: string): Box | null => labelInk(d.fonts, node(d, id));
const bondPts = (d: CdxDoc, id: string): [Pt, Pt] => {
  const b = bondsOf(d).find((x) => x.id === id)!;
  return [node(d, b.b).p, node(d, b.e).p];
};

/** Where the head ends, against its target: the tip outside the letters and within reach, pointing at them. */
function headOnTarget(d: CdxDoc, a: ArrowMeasure, to: { atom?: string; bond?: string; at?: Pt }): string | null {
  if (to.at) return Math.hypot(a.tip[0] - to.at[0], a.tip[1] - to.at[1]) <= 0.6 ? null : "tip off its page point";
  if (to.bond) {
    const [p, q] = bondPts(d, to.bond);
    const gap = distToTrace([p, q], a.tip);
    if (gap > 4.5) return `tip ${gap.toFixed(2)} pt from its bond`;
    // Pointing at the bond: the ray from the tip meets the bond line within a line width.
    let best = Infinity;
    for (let i = 0; i <= 20; i++) best = Math.min(best, rayDist(a.tip, a.dir, [p[0] + ((q[0] - p[0]) * i) / 20, p[1] + ((q[1] - p[1]) * i) / 20]));
    return best <= 1.2 ? null : "head not pointing at its bond";
  }
  const n = node(d, to.atom!);
  const bx = ink(d, to.atom!);
  if (bx) {
    const g = dbox(bx, a.tip) - d.style.lineWidth / 2;
    if (!(g > 0.2 && g <= 2.0)) return `tip ${g.toFixed(2)} pt from its label's letters`;
    return rayHitsBox(a.tip, a.dir, aimBox(bx, d.style.labelSize), 0.5) ? null : "head not pointing at its label";
  }
  const r = Math.hypot(a.tip[0] - n.p[0], a.tip[1] - n.p[1]);
  if (!(r >= 0.12 * L && r <= 0.35 * L)) return `tip ${r.toFixed(2)} pt from its atom`;
  return rayDist(a.tip, a.dir, n.p) <= 0.12 * L ? null : "head not pointing at its atom";
}

function report(m: Scene): Array<{ name: string; problems: string[]; a?: ArrowMeasure }> {
  return m.added.map((x, i) => {
    const name = `#${i + 1} ${JSON.stringify(x.from)}→${JSON.stringify(x.to)}`;
    if (!x.id) return { name, problems: ["refused: " + x.reason] };
    const a = measureArrow(m.doc, x.id);
    const problems = [...a.issues];
    const h = headOnTarget(m.doc, a, x.to as never);
    if (h) problems.push(h);
    return { name, problems, a };
  });
}

describe("every scene the round-3 reviewer drew, and its defect scenes: the default arrows are clean and land on their targets", () => {
  for (const name of Object.keys(MECH))
    row("scene " + name)(name, () => {
      const m = build((s) => MECH[name](s));
      const rows = report(m);
      expect(rows.filter((r) => r.problems.length).map((r) => `${r.name}: ${r.problems.join("; ")}`)).toEqual([]);
    });
});

describe("flipped (Shift, or a click on the arrow): clean, or refused by name", () => {
  test.each(Object.keys(MECH))("%s", (name) => {
    const m = build((s) => MECH[name](s, true));
    for (const r of report(m)) {
      if (r.problems[0]?.startsWith("refused: ")) expect(r.problems[0]).toMatch(/^refused: .{20,}/);
      else expect(`${r.name}: ${r.problems.join("; ")}`).toBe(`${r.name}: `);
    }
  });
});

const K = Array.from({ length: 12 }, (_, k) => k);

describe("(c) C–Br → Br, the bond leaving Br at each of 12 directions", () => {
  for (const k of K)
    row("hop " + k)(`k = ${k}`, () => {
      const m = build((s) => GRID.gridHopBr(s, k, gridCell(0)));
      const [r] = report(m);
      expect(r.problems).toEqual([]);
      const a = r.a!;
      // The tail within 3 pt of the visible bond (from the carbon to where the bond meets Br's letters).
      const [p, q] = bondPts(m.doc, a.source!);
      expect(distToTrace([p, q], a.tail)).toBeLessThanOrEqual(3);
      const br = (m.added[0].to as { atom: string }).atom;
      const bx = ink(m.doc, br)!;
      expect(dbox(bx, a.tail)).toBeGreaterThan(0.5);
    });
});

/** (b): two fishhooks from one bond to its two atoms. */
function homolysis(m: Scene): void {
  const rows = report(m);
  expect(rows.filter((r) => r.problems.length).map((r) => `${r.name}: ${r.problems.join("; ")}`)).toEqual([]);
  const [h1, h2] = rows.map((r) => r.a!);
  const [p, q] = bondPts(m.doc, h1.source!);
  const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const u: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  // Tails in the bond's middle.
  for (const h of [h1, h2]) expect(Math.hypot(h.tail[0] - mid[0], h.tail[1] - mid[1])).toBeLessThanOrEqual(0.35 * L);
  // Both on one side of the bond: their arcs' middles.
  const sideOf = (z: Pt): number => Math.sign(u[0] * (z[1] - mid[1]) - u[1] * (z[0] - mid[0]));
  expect(sideOf(h1.mid)).toBe(sideOf(h2.mid));
  expect(sideOf(h1.mid)).not.toBe(0);
  // Mirror images in the bond's perpendicular bisector, within the two labels' own asymmetry (a label's letters are
  // set from its first letter centred on the atom, so "Br" is not symmetric about its atom) plus 1 pt.
  const mirror = (z: Pt): Pt => {
    const t = (z[0] - mid[0]) * u[0] + (z[1] - mid[1]) * u[1];
    return [z[0] - 2 * t * u[0], z[1] - 2 * t * u[1]];
  };
  const a1 = h1.target!, a2 = h2.target!;
  const i1 = ink(m.doc, a1), i2 = ink(m.doc, a2);
  const centre = (b: Box | null, id: string): Pt => (b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : node(m.doc, id).p);
  const c1 = mirror(centre(i1, a1)), c2 = centre(i2, a2);
  const tol = 1 + Math.hypot(c1[0] - c2[0], c1[1] - c2[1]);
  const close = (x: Pt, y: Pt): number => Math.hypot(x[0] - y[0], x[1] - y[1]);
  expect(close(mirror(h1.tail), h2.tail)).toBeLessThanOrEqual(1);
  expect(close(mirror(h1.tip), h2.tip)).toBeLessThanOrEqual(tol);
  expect(close(mirror(h1.mid), h2.mid)).toBeLessThanOrEqual(tol);
}

describe("(b) homolysis: two fishhooks, one side, mirror images", () => {
  for (const k of K) row("Br2 " + k)(`Br–Br at ${k} × 30°`, () => homolysis(build((s) => GRID.gridHomoBr2(s, k, gridCell(0)))));
  for (const k of K) row("OO " + k)(`C–O–O–C at ${k} × 30°`, () => homolysis(build((s) => GRID.gridHomoOO(s, k, gridCell(0)))));
  row("peroxide zigzag")("the peroxide zigzag (R3-02)", () => homolysis(build((s) => MECH.homolysisPeroxide(s))));
  row("horizontal Br2")("horizontal Br–Br", () => homolysis(build((s) => MECH.homolysisBr2(s))));
});

describe("R3-06: an alkoxide's lone pair to its own C–O bond, at 12 directions", () => {
  test.each(K)("k = %i", (k) => {
    const m = build((s) => GRID.gridLoneToBond(s, k, gridCell(0)));
    const [r] = report(m);
    expect(r.problems).toEqual([]);
  });
});

describe("(d) the default sweep never exceeds 110°, on every row above", () => {
  test("all scenes and grids", () => {
    const sweeps: number[] = [];
    for (const f of Object.values(MECH)) for (const r of report(build((s) => f(s)))) if (r.a) sweeps.push(r.a.sweep);
    for (const g of Object.values(GRID)) for (const k of K) for (const r of report(build((s) => g(s, k, gridCell(0))))) if (r.a) sweeps.push(r.a.sweep);
    expect(sweeps.length).toBeGreaterThan(60);
    expect(Math.max(...sweeps)).toBeLessThanOrEqual(110 + 1e-6);
  });
});
