/**
 * @jest-environment jsdom
 */
// Canvas inserts meet the USPTO's lettering rule (37 CFR 1.84(p)(3): letters at least 0.32 cm high): the
// drawing is enlarged until its smallest lettering — a formula label's digits and a charge sign at 75 % —
// reaches the required size, never reduced, and refused by name when that would not fit the page.
import { TextDecoder as NodeTextDecoder } from "util";
import { createChemCanvas } from "../../taskpane/chemCanvas";
import { PAGE_PT, usptoInsertSize } from "../../taskpane/chemdrawPane";
import { USPTO_REQUIRED_FONT_PT } from "../figureStyle";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

describe("usptoInsertSize", () => {
  test("10 pt lettering is enlarged to the required size, and the note says by how much", () => {
    const z = usptoInsertSize(100, 50, 10, USPTO_REQUIRED_FONT_PT);
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    expect(z.k).toBeCloseTo(USPTO_REQUIRED_FONT_PT / 10, 9);
    expect(z.widthPt).toBeCloseTo(100 * z.k, 9);
    expect(z.heightPt).toBeCloseTo(50 * z.k, 9);
    expect(z.note).toBe("Enlarged 139 % so its letters meet the USPTO's 1/8-inch minimum (37 CFR 1.84(p)(3)).");
  });
  test("lettering already large enough, or no lettering at all, is never reduced", () => {
    for (const s of [20, null, 0]) {
      const z = usptoInsertSize(100, 50, s, USPTO_REQUIRED_FONT_PT);
      expect(z).toEqual({ ok: true, k: 1, widthPt: 100, heightPt: 50, note: "Its letters already meet the USPTO's 1/8-inch minimum." });
    }
  });
  test("a drawing too large for the page at the required size is refused, never shrunk below the rule", () => {
    const z = usptoInsertSize(PAGE_PT.w, 100, 7.5, USPTO_REQUIRED_FONT_PT);
    expect(z.ok).toBe(false);
    expect(!z.ok && z.reason).toMatch(/^with its letters at the USPTO's 1\/8-inch minimum it would be 12\.1 × 2\.6 in, larger than the page — insert fewer structures/);
  });
  test("exactly the page fits", () => {
    const z = usptoInsertSize(PAGE_PT.w / 2, PAGE_PT.h / 2, USPTO_REQUIRED_FONT_PT / 2, USPTO_REQUIRED_FONT_PT);
    expect(z.ok && [z.widthPt, z.heightPt]).toEqual([PAGE_PT.w, PAGE_PT.h]);
  });
});

describe("the canvas's smallest lettering", () => {
  function setup() {
    document.body.innerHTML = '<div id="mount"></div>';
    const c = createChemCanvas(document.getElementById("mount")!, { setStatus: () => undefined });
    const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
    const click = (x: number, y: number): void => {
      const svg = surface.querySelector("svg")!;
      const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const at = { clientX: x - vx, clientY: y - vy };
      for (const t of ["pointerdown", "pointerup", "click"]) surface.dispatchEvent(new MouseEvent(t, { ...at, button: 0, bubbles: true }));
    };
    const atoms = (): Array<[number, number]> => c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => n.p as [number, number]) : [])));
    const btn = (sel: string): void => document.querySelector<HTMLButtonElement>(sel)!.click();
    return { c, click, atoms, btn };
  }
  test("a bare skeleton has no lettering; Cl is drawn at the label size; NH₂'s subscript at 75 %; a charge at 75 %", () => {
    const t = setup();
    t.click(100, 100);
    expect(t.c.smallestTextPt(false)).toBeNull();
    t.btn('[data-chem-tool="atom"]');
    t.btn('[data-chem-element="Cl"]');
    t.click(...t.atoms()[1]);
    expect(t.c.smallestTextPt(false)).toBe(10);
    t.btn('[data-chem-element="N"]');
    t.click(...t.atoms()[0]);
    expect(t.c.smallestTextPt(false)).toBe(7.5);
  });
  test("a charge sign counts at 75 % of the label size", () => {
    const t = setup();
    t.click(100, 100);
    t.btn('[data-chem-tool="charge+"]');
    t.click(...t.atoms()[0]);
    expect(t.c.smallestTextPt(false)).toBe(7.5);
  });
});
