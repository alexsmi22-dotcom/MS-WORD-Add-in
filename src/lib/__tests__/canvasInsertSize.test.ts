// The Draw tab's insert size: ChemDraw's by default (as drawn, reduced only to fit the page), the USPTO
// drawing sheet size when chosen (a user found every insert at the USPTO size "so big").
import { canvasInsertFit, chemdrawFit, PAGE_PT, usptoInsertSize } from "../insertSize";
import { USPTO_REQUIRED_FONT_PT } from "../figureStyle";

const R = USPTO_REQUIRED_FONT_PT;

describe("canvasInsertFit", () => {
  it("ChemDraw size inserts a structure as drawn, with 10 pt labels (ChemDraw's ACS 1996 style) unenlarged", () => {
    const z = canvasInsertFit("chemdraw", 120, 80, 10, R);
    expect(z).toMatchObject({ ok: true, k: 1, widthPt: 120, heightPt: 80 });
    if (!z.ok) throw new Error();
    expect(z.note).toContain("ChemDraw's size");
    // Its letters are under the USPTO minimum, and the note says so and names the other choice.
    expect(z.note).toContain("10.0 pt, under the USPTO's 1/8-inch minimum");
    expect(z.note).toContain("USPTO drawing sheet size");
  });

  it("the USPTO choice is usptoInsertSize exactly (enlarged until the letters meet the minimum)", () => {
    for (const args of [[120, 80, 10], [PAGE_PT.w * 1.1, 100, 20], [100, 50, null], [PAGE_PT.w * 200, 100, null]] as Array<[number, number, number | null]>) {
      expect(canvasInsertFit("uspto", ...args, R)).toEqual(usptoInsertSize(...args, R));
    }
    const z = canvasInsertFit("uspto", 120, 80, 10, R);
    expect(z.ok && z.k).toBeCloseTo(R / 10, 9);
  });

  it("ChemDraw size reduces only to fit the page, and refuses under a quarter as chemdrawFit does", () => {
    const z = canvasInsertFit("chemdraw", PAGE_PT.w * 2, 100, null, R);
    expect(z).toMatchObject({ ok: true, k: 0.5, widthPt: PAGE_PT.w, heightPt: 50 });
    const no = canvasInsertFit("chemdraw", PAGE_PT.w * 10, 100, null, R);
    expect(no).toEqual(chemdrawFit(PAGE_PT.w * 10, 100));
    expect(no.ok).toBe(false);
  });

  it("no lettering warning when the letters meet the minimum as inserted, or there are none", () => {
    const big = canvasInsertFit("chemdraw", 120, 80, R * 1.5, R);
    expect(big.ok && big.note).toBe("It is inserted at ChemDraw's size.");
    const none = canvasInsertFit("chemdraw", 120, 80, null, R);
    expect(none.ok && none.note).toBe("It is inserted at ChemDraw's size.");
    // Letters that meet the minimum as drawn but not once reduced to fit the page are warned about.
    const reduced = canvasInsertFit("chemdraw", PAGE_PT.w * 2, 100, R * 1.5, R);
    expect(reduced.ok && reduced.note).toContain("under the USPTO's 1/8-inch minimum");
  });
});
