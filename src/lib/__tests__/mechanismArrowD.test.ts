// Release D: the curved-arrow case table, written BEFORE the planner was rebuilt (the method that failed three rounds
// was tuning against single examples). Every row is a measured assertion on the arrow as drawn (mechMeasure.ts), on
// scenes drawn with the editor exactly as a user draws them (mechScenes.ts — the round-3 reviewer's scenes):
//   clean  = no non-own bond line within 1 pt (ink to ink), no other label's letters within 1 pt (its own 0.6 pt),
//            no charge sign or radical dot within 1 pt, no other arrow within 1.5 pt, the head 0.15 bond length off
//            every bond but its target, the sweep at most 110°;
//   (a) EAS step 2 (arenium C–H → the ring C–C⁺ bond, + at either vertex): the default arrow is clean;
//   (b) homolysis at 12 angles (Br–Br, C–O–O–C) and the peroxide zigzag, placed as published figures place it
//       (Release E, measured 2026-10-23 on Wikimedia Commons "Homolysis2.svg" (ChemDraw-drawn peroxide) and
//       "Homolysis (Chemistry) V.1.svg"; bond lengths from the middle of the VISIBLE bond): each tail within 0.35 of
//       that middle; each tip OVER its own atom — 0.20–0.24 past the middle of its letters, 0.35–0.48 above the line, its head 31–56°
//       down from the bond's direction (rows allow −0.15…0.4, letters' top +0.03…+0.4, 15–65°); both hooks on one side,
//       mirror images — unless an atom's other bonds all lie on one side (a trans RO–OR): then each hook over its atom
//       on its free side, the pair point-symmetric (the published peroxide figure) — as also where the shared side has
//       no room (pinned: Br–Br at 240°). Release D's "tip 2 pt from the
//       letters, aimed into them" forced a near-180° loop no published homolysis draws;
//   (c) C–Br → Br at 12 directions: the tail within 0.29 bond length (4.2 pt) of the visible bond — a published
//       figure's farthest — the head onto Br from outside;
//   (d) no default sweep over 110°;  (e) every arrow ≥ 1.5 pt from the arrows already on the page;
//   plus every scene the reviewer called clean and the round-3 defect scenes; and a flipped arrow (Shift / click) is
//   either clean too or refused by name — never drawn through something.
// Earlier rows (R08, R09/R09b, R11, R2-06, R2-07/07b) stay in mechanismArrowCases.test.ts (cumulative gate).
import type { Box, CdxDoc, CdxNode, Pt } from "../cdxml";
import { aimBox, distToTrace, elementAnchor, elementBox } from "../cdxArrows";
import { labelInk } from "../cdxGlyphs";
import { scene, MECH, GRID, gridCell, L, Scene } from "./mechScenes";
import { setAtomLabel } from "../cdxmlEdit";
import { measureArrow, nodesOf, bondsOf, rayHitsBox, rayDist, dbox, ArrowMeasure, sweepCap, arrowsOf } from "./mechMeasure";
const arrowAttrs = (d: CdxDoc, id: string): Record<string, string | undefined> => arrowsOf(d).find((a) => a.id === id)!.el.attrs;

/**
 * Rows that FAIL today, pinned as failing (jest's test.failing: a row that starts to pass turns red, so the table is
 * revisited). Release E fixed the homolysis rows by measuring published figures (row (b) above) instead of Release D's
 * "tip 2 pt from its letters, aimed into them", which needed a ~180° loop; and row (c)'s 3 pt → 0.29 bond.
 * Kept failing, a DECISION (Release E): eas2b (row a with E on the sp3 carbon angularly BETWEEN its H and the target
 * bond — not how the step is drawn; the standard layout, eas2, is clean): every arc from the C–H bond to that ring bond
 * crosses the C–E bond or the ring bond on the other side, so it is refused by name, never drawn through a bond.
 */
const KNOWN_FAILING = new Set(["scene eas2b"]);
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

/** A fishhook from a bond between two lettered atoms to one of them: half a homolysis (row (b)'s placement). */
function homoOf(d: CdxDoc, x: Scene["added"][number]): { bond: string; target: string } | null {
  const from = x.from as { bond?: string }, to = x.to as { atom?: string };
  if (x.electrons !== 1 || !from.bond || !to.atom) return null;
  const b = bondsOf(d).find((y) => y.id === from.bond);
  if (!b || (b.b !== to.atom && b.e !== to.atom) || !ink(d, b.b) || !ink(d, b.e)) return null;
  return { bond: b.id, target: to.atom };
}

/** The middle of a bond's visible stretch (clear of both atoms' letters), and its unit direction toward `target`. */
function visibleMid(d: CdxDoc, bond: string, target: string): { vm: Pt; dT: Pt } {
  const b = bondsOf(d).find((y) => y.id === bond)!;
  const tp = node(d, target).p, op = node(d, b.b === target ? b.e : b.b).p;
  const inks = [ink(d, b.b), ink(d, b.e)].filter((z): z is Box => !!z);
  let t0 = -1, t1 = -1;
  for (let i = 0; i <= 200; i++) {
    const q: Pt = [op[0] + ((tp[0] - op[0]) * i) / 200, op[1] + ((tp[1] - op[1]) * i) / 200];
    if (inks.every((bx) => dbox(bx, q) > 0)) {
      if (t0 < 0) t0 = i / 200;
      t1 = i / 200;
    }
  }
  const t = t0 < 0 ? 0.5 : (t0 + t1) / 2;
  const n = Math.hypot(tp[0] - op[0], tp[1] - op[1]);
  return { vm: [op[0] + (tp[0] - op[0]) * t, op[1] + (tp[1] - op[1]) * t], dT: [(tp[0] - op[0]) / n, (tp[1] - op[1]) / n] };
}

/** Row (b): the tip over its own atom, as the published figures draw it. */
function overTarget(d: CdxDoc, a: ArrowMeasure, h: { bond: string; target: string }): string | null {
  const { dT } = visibleMid(d, h.bond, h.target);
  // From the middle of its element's letters on the bond line ("Br" both letters, set from its B; in "OH" the O).
  const at = node(d, h.target).p, bx = ink(d, h.target)!;
  const ic = elementAnchor(node(d, h.target), bx);
  const k = (ic[0] - at[0]) * dT[0] + (ic[1] - at[1]) * dT[1];
  const tp: Pt = [at[0] + dT[0] * k, at[1] + dT[1] * k];
  // The side the arc bows to (its middle's side of the bond line).
  const nR: Pt = [-dT[1], dT[0]];
  const s = Math.sign((a.mid[0] - tp[0]) * nR[0] + (a.mid[1] - tp[1]) * nR[1]) || 1;
  const n: Pt = [nR[0] * s, nR[1] * s];
  const rel: Pt = [a.tip[0] - tp[0], a.tip[1] - tp[1]];
  const along = (rel[0] * dT[0] + rel[1] * dT[1]) / L, up = rel[0] * n[0] + rel[1] * n[1];
  // Above its element's letters (an OH's H is not lifted over; the clearance rows keep the arc off it).
  const eb = elementBox(node(d, h.target), bx);
  const corners: Pt[] = [[eb[0], eb[1]], [eb[2], eb[1]], [eb[0], eb[3]], [eb[2], eb[3]]];
  const top = Math.max(...corners.map((c) => (c[0] - tp[0]) * n[0] + (c[1] - tp[1]) * n[1]));
  const down = (Math.atan2(-(a.dir[0] * n[0] + a.dir[1] * n[1]), a.dir[0] * dT[0] + a.dir[1] * dT[1]) * 180) / Math.PI;
  if (!(along >= -0.15 && along <= 0.4)) return `tip ${along.toFixed(2)} bond along from its atom (−0.15…0.4)`;
  if (!(up >= top + 0.03 * L && up <= top + 0.4 * L)) return `tip ${((up - top) / L).toFixed(2)} bond above its letters (0.03…0.4)`;
  if (!(down >= 15 && down <= 65)) return `head ${down.toFixed(0)}° down from the bond (15…65°)`;
  // And, measured from the atom itself (independent of the anchor above): the published hooks' tips are 0.54 bond
  // from their atoms at most; a two-letter symbol's middle sits ~0.25 bond from its atom (set from its first letter):
  // 0.8. A tip past an OH's H (review) is a bond away.
  const fromAtom = Math.hypot(a.tip[0] - at[0], a.tip[1] - at[1]) / L;
  if (fromAtom > 0.8) return `tip ${fromAtom.toFixed(2)} bond from its atom (≤ 0.8)`;
  return null;
}

function report(m: Scene): Array<{ name: string; problems: string[]; a?: ArrowMeasure }> {
  return m.added.map((x, i) => {
    const name = `#${i + 1} ${JSON.stringify(x.from)}→${JSON.stringify(x.to)}`;
    if (!x.id) return { name, problems: ["refused: " + x.reason] };
    const a = measureArrow(m.doc, x.id);
    const problems = [...a.issues];
    const ho = homoOf(m.doc, x);
    const h = ho ? overTarget(m.doc, a, ho) : headOnTarget(m.doc, a, x.to as never);
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
      // The tail within 0.29 bond length of the visible bond (from the carbon to where the bond meets Br's letters):
      // the farthest a published figure's tail sits off its line (Wikimedia Commons "Homolysis2.svg", ChemDraw-drawn,
      // 0.20 and 0.29; measured 2026-10-23). Release D asked 3 pt (0.21) and pinned k = 3, 6 failing at 3.8 pt (0.26),
      // which looked clean zoomed.
      const [p, q] = bondPts(m.doc, a.source!);
      expect(distToTrace([p, q], a.tail)).toBeLessThanOrEqual(0.29 * L);
      const br = (m.added[0].to as { atom: string }).atom;
      const bx = ink(m.doc, br)!;
      expect(dbox(bx, a.tail)).toBeGreaterThan(0.5);
    });
});

/**
 * The side of a bond (sign of the cross product with b→e) clear of one atom's other bonds and of its label's other
 * letters (an OH's H, measured off the bond's line by more than 0.15 bond): 0 when neither, or both sides.
 */
function atomFree(d: CdxDoc, bond: string, at: string): number {
  const b = bondsOf(d).find((y) => y.id === bond)!;
  const pa = node(d, b.b).p, pb = node(d, b.e).p, dB: Pt = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L], p = node(d, at).p;
  const sides = new Set<number>();
  const side = (q: Pt): number => dB[0] * (q[1] - p[1]) - dB[1] * (q[0] - p[0]);
  for (const o of bondsOf(d)) {
    if (o.id === bond || (o.b !== at && o.e !== at)) continue;
    const sg = Math.sign(side(node(d, o.b === at ? o.e : o.b).p));
    if (sg) sides.add(sg);
  }
  const bx = ink(d, at);
  if (bx) {
    const eb = elementBox(node(d, at), bx);
    for (const [x0, x1] of [[bx[0], eb[0]], [eb[2], bx[2]]]) {
      if (x1 - x0 < 0.25 * d.style.labelSize) continue;
      const off = side([(x0 + x1) / 2, (bx[1] + bx[3]) / 2]);
      if (Math.abs(off) > 0.15 * L) sides.add(Math.sign(off));
    }
  }
  return sides.size === 1 ? -[...sides][0] : 0;
}

/** (b): two fishhooks from one bond to its two atoms. */
function homolysis(m: Scene, opposite = false): void {
  const rows = report(m);
  expect(rows.filter((r) => r.problems.length).map((r) => `${r.name}: ${r.problems.join("; ")}`)).toEqual([]);
  const [h1, h2] = rows.map((r) => r.a!);
  const a1 = h1.target!, a2 = h2.target!;
  const b = bondsOf(m.doc).find((y) => y.id === h1.source)!;
  const { vm: mid } = visibleMid(m.doc, b.id, b.e);
  const [p, q] = bondPts(m.doc, b.id);
  const u: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  // Tails in the visible bond's middle.
  for (const h of [h1, h2]) expect(Math.hypot(h.tail[0] - mid[0], h.tail[1] - mid[1])).toBeLessThanOrEqual(0.35 * L);
  // Sides: over each atom on its free side where its other bonds pin one; else one side for both.
  const sideOf = (z: Pt): number => Math.sign(u[0] * (z[1] - mid[1]) - u[1] * (z[0] - mid[0]));
  const s1 = sideOf(h1.mid), s2 = sideOf(h2.mid);
  expect(s1).not.toBe(0);
  expect(s2).not.toBe(0);
  const f1 = atomFree(m.doc, b.id, a1), f2 = atomFree(m.doc, b.id, a2);
  if (f1) expect(s1).toBe(f1);
  if (f2) expect(s2).toBe(f2);
  if (!f1 && !f2) expect(s1 === s2 ? "one side" : "opposite").toBe(opposite ? "opposite" : "one side");
  // Mirror images in the visible bond's perpendicular bisector (one side), or point images through its middle
  // (opposite sides), within the two labels' own asymmetry (a label's letters are set from its first letter centred on
  // the atom, so "Br" is not symmetric about its atom) plus 1 pt.
  const image = (z: Pt): Pt => {
    if (s1 !== s2) return [2 * mid[0] - z[0], 2 * mid[1] - z[1]];
    const t = (z[0] - mid[0]) * u[0] + (z[1] - mid[1]) * u[1];
    return [z[0] - 2 * t * u[0], z[1] - 2 * t * u[1]];
  };
  const i1 = ink(m.doc, a1), i2 = ink(m.doc, a2);
  const centre = (bx: Box | null, id: string): Pt => (bx ? [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2] : node(m.doc, id).p);
  const close = (x: Pt, y: Pt): number => Math.hypot(x[0] - y[0], x[1] - y[1]);
  const tol = 1 + close(image(centre(i1, a1)), centre(i2, a2));
  expect(close(image(h1.tail), h2.tail)).toBeLessThanOrEqual(1);
  expect(close(image(h1.tip), h2.tip)).toBeLessThanOrEqual(tol);
  expect(close(image(h1.mid), h2.mid)).toBeLessThanOrEqual(tol);
}

describe("(b) homolysis: two fishhooks, one side, mirror images", () => {
  // Br–Br at 240°: the first hook's side (the bond's tie-break) has no room for the second (the upper Br's "r" fills
  // it), so the pair is drawn on opposite sides, point-symmetric — the published peroxide figure's layout. Pinned.
  const BR2_OPPOSITE = new Set([8]);
  for (const k of K) row("Br2 " + k)(`Br–Br at ${k} × 30°`, () => homolysis(build((s) => GRID.gridHomoBr2(s, k, gridCell(0))), BR2_OPPOSITE.has(k)));
  for (const k of K) row("OO " + k)(`C–O–O–C at ${k} × 30°`, () => homolysis(build((s) => GRID.gridHomoOO(s, k, gridCell(0)))));
  row("peroxide zigzag")("the peroxide zigzag (R3-02)", () => homolysis(build((s) => MECH.homolysisPeroxide(s))));
  // Review (Release E): multi-letter labels — the tip over the O of "OH", not past its H. Drawn as a user draws it:
  // O–O, then each O typed "OH" (the editor sets the H away from the bond). Each H picks its O's side (row (b)'s
  // rule); none is pinned.
  const HOOH_OPPOSITE = new Set<number>();
  for (const k of K)
    row("HOOH " + k)(`HO–OH at ${k} × 30°`, () =>
      homolysis(
        build((s) => {
          const a = s.atom(gridCell(0), "O");
          const b = s.bond(a, k * 30, "O");
          setAtomLabel(s.doc, a, "OH");
          setAtomLabel(s.doc, b.n, "OH");
          s.re();
          s.curved({ bond: b.b }, { atom: a }, 1);
          s.curved({ bond: b.b }, { atom: b.n }, 1);
        }),
        HOOH_OPPOSITE.has(k),
      ),
    );
  row("horizontal Br2")("horizontal Br–Br", () => homolysis(build((s) => MECH.homolysisBr2(s))));
});

describe("(b) a level Br–Cl: the 2.5 pt dash leaves no room for the published placement", () => {
  // Review (Release E): the general placement is used there, as before: the hook to Cl clean, the hook to Br refused by
  // name (Br's letters reach over the dash) — never drawn through the letters.
  test("hook to Cl drawn clean, hook to Br refused by name", () => {
    const m = build((s) => {
      const a = s.atom(gridCell(0), "Br");
      const b = s.bond(a, 0, "Cl");
      s.curved({ bond: b.b }, { atom: a }, 1);
      s.curved({ bond: b.b }, { atom: b.n }, 1);
    });
    const [toBr, toCl] = report(m);
    expect(toBr.problems[0]).toMatch(/^refused: .{20,}/);
    expect(toCl.problems).toEqual([]);
  });
});

describe("R3-06: an alkoxide's lone pair to its own C–O bond, at 12 directions", () => {
  test.each(K)("k = %i", (k) => {
    const m = build((s) => GRID.gridLoneToBond(s, k, gridCell(0)));
    const [r] = report(m);
    expect(r.problems).toEqual([]);
  });
});

describe("(d) the default sweep never exceeds 110° (a homolysis fishhook: 155°, measured on published figures), on every row above", () => {
  test("all scenes and grids", () => {
    const over: string[] = [];
    let n = 0;
    const check = (m: Scene): void => {
      for (const r of report(m)) {
        if (!r.a) continue;
        n++;
        const ar = { el: { attrs: arrowAttrs(m.doc, r.a.id) } };
        if (r.a.sweep > sweepCap(m.doc, ar) + 1e-6) over.push(`${r.name}: ${r.a.sweep.toFixed(0)}°`);
      }
    };
    for (const f of Object.values(MECH)) check(build((s) => f(s)));
    for (const g of Object.values(GRID)) for (const k of K) check(build((s) => g(s, k, gridCell(0))));
    expect(n).toBeGreaterThan(60);
    expect(over).toEqual([]);
  });
});
