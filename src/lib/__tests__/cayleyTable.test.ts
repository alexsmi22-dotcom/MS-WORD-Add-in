/**
 * cayleyTableSvg — the text-cell grid for Cayley tables (v2.134.0). Pins the
 * figure contract: everything inside the canvas, width/height with the same
 * aspect as the viewBox, identity cells outlined, legible ink on every cell,
 * the 20-element cap, and label-sized cells that scale as a whole.
 */
import { cayleyTableSvg, MAX_TABLE, TableTooWideError } from "../cayleyTableSvg";
import { inkOn } from "../chartPalette";
import { cyclicGroup, symmetricGroup, productGroup, FiniteGroup, op } from "../algebraGroups";
import { tryAlgebra } from "../algebra";

const tableOf = (G: FiniteGroup): number[][] => Array.from({ length: G.n }, (_, a) => Array.from({ length: G.n }, (_, b) => op(G, a, b)));
const nums = (svg: string, attr: string): number[] => [...svg.matchAll(new RegExp(`\\s${attr}="(-?[\\d.]+)"`, "g"))].map((m) => Number(m[1]));

function viewBox(svg: string): [number, number, number, number] {
  return /viewBox="([^"]+)"/.exec(svg)![1].split(/\s+/).map(Number) as [number, number, number, number];
}
function dims(svg: string): [number, number] {
  const m = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg)!;
  return [Number(m[1]), Number(m[2])];
}

describe("cayleyTableSvg", () => {
  const S3 = symmetricGroup(3);
  const svg = cayleyTableSvg(S3.labels, tableOf(S3), { caption: "Cayley table of S₃", identity: S3.e });

  it("width/height keep the viewBox aspect", () => {
    const [, , vw, vh] = viewBox(svg);
    const [w, h] = dims(svg);
    expect(Math.abs(w / h - vw / vh)).toBeLessThan(0.01);
  });
  it("every rect and text sits inside the canvas", () => {
    const [, , vw, vh] = viewBox(svg);
    for (const x of nums(svg, "x")) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(vw); }
    for (const y of nums(svg, "y")) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(vh); }
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
    for (const r of rects) {
      expect(Number(r[1]) + Number(r[3])).toBeLessThanOrEqual(vw + 0.5);
      expect(Number(r[2]) + Number(r[4])).toBeLessThanOrEqual(vh + 0.5);
    }
  });
  it("the identity is outlined exactly once per row (n outlines for a group)", () => {
    expect((svg.match(/fill="none" stroke=/g) ?? []).length).toBe(6);
  });
  it("header row and column are bold; 36 body cells carry their entry's label", () => {
    expect((svg.match(/font-weight="bold"/g) ?? []).length).toBe(1 + 6 + 6);
    expect((svg.match(/<text[^>]*>\(1 2 3\)<\/text>/g) ?? []).length).toBe(1 + 1 + 6);
  });
  it("cell text ink is inkOn(fill) — legible on every tint", () => {
    const cells = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="(#[0-9a-f]{6})" stroke="#ffffff"\/><text[^>]*fill="(#[0-9a-f]{6})"/g)];
    expect(cells.length).toBe(36);
    for (const c of cells) expect(c[2]).toBe(inkOn(c[1]));
  });
  it("equal entries share a colour (an abelian table is visibly symmetric)", () => {
    const Z = cyclicGroup(5);
    const s = cayleyTableSvg(Z.labels, tableOf(Z), { identity: 0 });
    const fills = [...s.matchAll(/fill="(#[0-9a-f]{6})" stroke="#ffffff"/g)].map((m) => m[1]);
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) expect(fills[a * 5 + b]).toBe(fills[b * 5 + a]);
  });
  it("long labels widen the cells; the table scales to ≤ 640 px but never draws text below 9 px", () => {
    const G = productGroup([cyclicGroup(3), cyclicGroup(4)]);
    const s = cayleyTableSvg(G.labels, tableOf(G), { identity: G.e });
    const [w, h] = dims(s);
    const [, , vw, vh] = viewBox(s);
    expect(w).toBeLessThanOrEqual(640);
    expect(vw).toBeGreaterThan(640);
    expect((12 * w) / vw).toBeGreaterThanOrEqual(9);
    expect(Math.abs(w / h - vw / vh)).toBeLessThan(0.01);
    // Labels too long to stay legible: refused by name, never drawn tiny.
    const P = productGroup([symmetricGroup(3), cyclicGroup(2)]);
    expect(() => cayleyTableSvg(P.labels, tableOf(P), { identity: P.e })).toThrow(TableTooWideError);
    expect(() => cayleyTableSvg(P.labels, tableOf(P), { identity: P.e })).toThrow(/below the 9 px legibility floor/);
  });
  it("a group whose table cannot be drawn legibly keeps the text table and says why", () => {
    const r = tryAlgebra("S3 x Z/2")!;
    expect(r.svg).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/legibility floor, so it is not drawn/);
  });
  it("the cap: at most 20 elements are drawn", () => {
    expect(MAX_TABLE).toBe(20);
    const Z20 = cyclicGroup(20);
    expect(() => cayleyTableSvg(Z20.labels, tableOf(Z20))).not.toThrow();
    const Z21 = cyclicGroup(21);
    expect(() => cayleyTableSvg(Z21.labels, tableOf(Z21))).toThrow(/1 to 20/);
    expect(tryAlgebra("Z/21")!.svg).toBeUndefined();
    expect(tryAlgebra("Z/21")!.caveats.join(" ")).toMatch(/not drawn — tables are drawn for at most 20 elements/);
  });
  it("coset bands tint by band, and a grey element is grey", () => {
    const Z = cyclicGroup(6);
    const s = cayleyTableSvg(Z.labels, tableOf(Z), { bands: [0, 1, 2, 0, 1, 2], grey: 0 });
    expect(s).toMatch(/#e2e2df/);
  });
  it("the caption is escaped and wrapped inside the canvas", () => {
    const s = cayleyTableSvg(["e", "a"], [[0, 1], [1, 0]], { caption: "A <long> caption & more ".repeat(8) });
    expect(s).toContain("&lt;long&gt;");
    const [, , vw] = viewBox(s);
    const lines = [...s.matchAll(/<text x="12" y="[\d.]+" font-size="11"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&[a-z]+;/g, "x"));
    for (const l of lines) expect(12 + l.length * 11 * 0.6).toBeLessThanOrEqual(vw);
  });
});
