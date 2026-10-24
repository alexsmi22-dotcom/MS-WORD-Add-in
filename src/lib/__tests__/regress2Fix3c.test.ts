// fix3c: round-2 regressions pinned (review of main @ 69a5275 against live e34ce0b).
//   9. Pipe at zero flow: the tool's own reason ("no flow ... friction factor undefined") was replaced by the central
//      guard's false "overflowed or underflowed"; and the guard's wording claimed overflow for a 0/0.
//  10. Detail tag on a USPTO sheet: with a section and a detail at the same end of a view, "FIG. 4" fell back onto the
//      section's "3" (and onto the part outline) when its four corner places were all taken.
import { analyzePipe } from "../fluids";
import { guardEngResult, refuseNonFinite } from "../finiteResult";
import { hasBrokenNumber } from "../insertGate";
import { textWidthPt } from "../arialMetrics";
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Mesh, Placement, tessellate } from "../cadModel";
import { layoutSheet, SheetOptions, ViewSpec } from "../cadSheet";

describe("9. Pipe at zero flow keeps its own reason; the central guard does not claim overflow for 0/0", () => {
  test("the engine still answers V = 0 as no flow (base behaviour): zero head loss, friction factor not a number", () => {
    const r = analyzePipe({ D: 0.05, L: 10, V: 0, eps: 4.5e-5, rho: 998.2, mu: 0.001002, sumK: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hTotal).toBe(0);
    expect(r.dp).toBe(0);
    expect(Number.isFinite(r.f)).toBe(false);
    expect(r.notes.join(" ")).toMatch(/no flow.*friction factor is undefined at zero flow/i);
  });
  test("an ok result printing NaN or undefined is refused as UNDEFINED at these inputs, not as an overflow", () => {
    for (const text of ["Darcy friction factor f = NaN", "ratio = undefined", "x = NaN\ny = Infinity"]) {
      const o = guardEngResult({ text, ok: true });
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(/undefined at these inputs/);
      expect(o.text).not.toMatch(/overflow/);
    }
  });
  test("an ok result printing Infinity alone is still the overflow refusal (the round-2 guard's purpose)", () => {
    const o = guardEngResult({ text: "order Infinity", ok: true });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/not a finite number/);
    expect(o.text).toMatch(/infinite|overflow/);
  });
  test("a bare 'not finite' (a formatter's word, cause unknown) gets wording that claims neither", () => {
    const o = refuseNonFinite({ text: "Setup not finite", ok: true }, "Link budget");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Link budget: /);
    expect(o.text).toMatch(/overflowed.*or is undefined/);
    for (const t of [o.text]) expect(hasBrokenNumber(t)).toBe(false);
  });
  test("a refusal passes the guard unchanged, keeping its own wording (base behaviour)", () => {
    const why = "There is no flow (velocity 0), so the friction factor is undefined: give a velocity or a flow rate above zero.";
    expect(guardEngResult({ text: why, ok: false })).toEqual({ text: why, ok: false });
  });
});

describe("10. A detail's tag clears the cutting-line names, the lines and every other name on the sheet", () => {
  let seq = 0;
  const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++seq}`, name: `b${seq}`, spec, placement });
  const at = (x: number, y: number, z: number): Placement => ({ translate: [x, y, z], rotateDeg: [0, 0, 0] });
  const meshOf = (...bodies: Body[]): Mesh => {
    const r = tessellate({ version: 1, bodies } as Assembly);
    if (!r.ok) throw new Error(r.reason);
    return r.mesh;
  };
  const parts: Record<string, Mesh> = {
    block: meshOf(body(box(40, 20, 10)), body(box(10, 10, 20), at(0, 0, 10))),
    flat: meshOf(body(box(200, 10, 10))),
    tall: meshOf(body(box(10, 10, 200))),
  };
  // The section and the detail at the same (left) end of the front view: the reviewer's sheet.
  const views: ViewSpec[] = [
    { kind: "front" },
    { kind: "top" },
    { kind: "section", label: "A", of: "front", a: [5, -5], b: [5, 40] },
    { kind: "detail", letter: "B", of: "front", at: [0, 0], r: 5, factor: 2 },
  ];
  type TBox = { s: string; x0: number; x1: number; y0: number; y1: number; fpx: number; anchored: boolean; cut: boolean };
  const textsOf = (svg: string): TBox[] =>
    [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((t) => {
      const a = t[1];
      const g = (k: string): string => new RegExp(` ${k}="([^"]*)"`).exec(a)?.[1] ?? "";
      const fpx = Number(g("font-size"));
      const w = textWidthPt(t[2], fpx * 0.75) / 0.75;
      const x = Number(g("x")), y = Number(g("y"));
      const anc = g("text-anchor");
      const x0 = anc === "middle" ? x - w / 2 : anc === "end" ? x - w : x;
      const yb = g("dy") === "0.35em" ? y + 0.35 * fpx : y;
      return { s: t[2], x0, x1: x0 + w, y0: yb - 0.72 * fpx, y1: yb, fpx, anchored: !!anc, cut: a.includes("data-cutting-label") };
    });
  const segsOf = (svg: string): Array<[number, number, number, number]> => {
    const out: Array<[number, number, number, number]> = [];
    for (const m of svg.matchAll(/<path[^>]* d="([^"]*)"/g))
      for (const run of m[1].split("M").filter(Boolean)) {
        const pts = run.replace(/Z/g, "").split("L").map((p) => p.trim().split(/\s+/).map(Number));
        for (let i = 1; i < pts.length; i++) out.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
      }
    return out;
  };
  const segHits = ([x1, y1, x2, y2]: [number, number, number, number], b: TBox): boolean => {
    // Sampled: fine enough for boxes several px across.
    for (let t = 0; t <= 1; t += 1 / 64) {
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
    }
    return false;
  };
  const meet = (a: TBox, b: TBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  for (const pn of Object.keys(parts))
    for (const standard of ["uspto", "asme", "iso"] as const)
      for (const figStart of [undefined, 10])
        test(`${pn}, ${standard}${figStart ? ", FIG. numbers from 10" : ""}: tag clear and near its circle`, () => {
          const o: SheetOptions = { standard, lineBudgetMs: 600000, views, figStart, callouts: [{ label: "10", anchor: [0, 0, 0] }] };
          const s = layoutSheet(parts[pn], o);
          expect(s.svg).toBeTruthy();
          expect(s.notes.filter((n) => /could not be set clear/.test(n))).toEqual([]);
          const texts = textsOf(s.svg);
          const detailFig = standard === "uspto" ? `FIG. ${(figStart ?? 1) + 3}` : "B";
          // The tag: the one text naming the detail that is not centred (titles and cutting names are).
          const tags = texts.filter((t) => t.s === detailFig && !t.anchored);
          expect(tags.length).toBe(1);
          const tag = tags[0];
          // Round 2's intent kept: on a USPTO sheet the tag is a view number, at the heading size.
          if (standard === "uspto") {
            const fig = texts.find((t) => /^FIG\. \d+$/.test(t.s) && t.anchored)!;
            expect(tag.fpx).toBeCloseTo(fig.fpx, 6);
          }
          for (const t of texts) if (t !== tag) expect(meet(tag, t) ? `${tag.s} on ${t.s}` : "").toBe("");
          const hit = segsOf(s.svg).filter((sg) => segHits(sg, tag));
          expect(hit).toEqual([]);
          // Inside the sheet.
          const vb = /viewBox="([^"]*)"/.exec(s.svg)![1].split(/\s+/).map(Number);
          expect(tag.x0).toBeGreaterThanOrEqual(vb[0]);
          expect(tag.x1).toBeLessThanOrEqual(vb[0] + vb[2]);
          expect(tag.y0).toBeGreaterThanOrEqual(vb[1]);
          expect(tag.y1).toBeLessThanOrEqual(vb[1] + vb[3]);
          // Near its circle: the detail circle is the many-point path on the front view; the tag's box within a few
          // letter heights of it.
          const circle = [...s.svg.matchAll(/<path d="(M[^"]*)"/g)]
            .map((m) => m[1].slice(1).split("L").map((p) => p.trim().split(/\s+/).map(Number)))
            .filter((pts) => pts.length >= 24)
            .map((pts) => {
              const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
              const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
              return { cx, cy, r: Math.max(...rs), round: Math.max(...rs) - Math.min(...rs) < 0.05 * Math.max(...rs) };
            })
            .filter((c) => c.round)
            .sort((p, q) => p.r - q.r)[0];
          expect(circle).toBeTruthy();
          const gx = Math.max(tag.x0 - circle.cx, 0, circle.cx - tag.x1), gy = Math.max(tag.y0 - circle.cy, 0, circle.cy - tag.y1);
          expect(Math.hypot(gx, gy) - circle.r).toBeLessThan(tag.fpx * 4);
        });

  test("the reviewer's sheet: the section's names clear the thin part's outline (top end as well as the foot)", () => {
    const s = layoutSheet(parts.flat, { standard: "uspto", lineBudgetMs: 600000, views, callouts: [{ label: "10", anchor: [0, 0, 0] }] });
    const cuts = textsOf(s.svg).filter((t) => t.cut);
    expect(cuts.length).toBe(2);
    const outline = [...s.svg.matchAll(/<path d="(M[^"]*)"[^>]*\/>/g)];
    expect(outline.length).toBeGreaterThan(0);
    const segs = segsOf(s.svg.replace(/<path data-(?:arrow|cutting)[^>]*\/>/g, ""));
    for (const c of cuts) expect(segs.filter((sg) => segHits(sg, c))).toEqual([]);
  });
});
