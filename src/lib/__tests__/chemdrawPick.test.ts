// Picking one structure out of a ChemDraw page (chemdrawPick.ts): a gallery in reading order, each structure a
// molecule (structure editor) or refused by name (page canvas), and a page cut down to the one picked.
import { readCdxml } from "../cdxml";
import { pageStructures, subsetPage } from "../chemdrawPick";

const page = (inner: string) => {
  const d = readCdxml(`<CDXML BondLength="30"><page id="900">${inner}</page></CDXML>`);
  if (!d.ok) throw new Error(d.reason);
  return d.doc;
};
/** Ethane at (x, y): two carbons and their bond. */
const ethane = (id: number, x: number, y: number): string =>
  `<fragment id="${id}"><n id="${id + 1}" p="${x} ${y}"/><n id="${id + 2}" p="${x + 30} ${y}"/><b id="${id + 3}" B="${id + 1}" E="${id + 2}"/></fragment>`;
const genericX = (id: number, x: number, y: number): string =>
  `<fragment id="${id}"><n id="${id + 1}" p="${x} ${y}"/><n id="${id + 2}" p="${x + 30} ${y}" NodeType="GenericNickname" GenericNickname="X"><t p="${x + 30} ${y + 3}"><s font="3" size="10">X</s></t></n><b id="${id + 3}" B="${id + 1}" E="${id + 2}"/></fragment>`;

describe("pageStructures", () => {
  it("lists every structure in reading order (rows top to bottom, then left to right), each drawn", () => {
    const d = page(ethane(100, 300, 0) + ethane(200, 0, 0) + ethane(300, 0, 200) + `<t id="400" p="0 400"><s font="3" size="10">caption</s></t>`);
    const { structures, more } = pageStructures(d);
    expect(structures.map((s) => s.id)).toEqual(["200", "100", "300"]);
    expect(more).toBe(0);
    for (const s of structures) expect(s.svg).toMatch(/^<svg/);
  });

  it("a molecule opens in the structure editor; a generic atom is refused by name (page canvas)", () => {
    const { structures } = pageStructures(page(ethane(100, 0, 0) + genericX(200, 0, 200)));
    expect(structures[0].mol?.getMolecularFormula().formula).toBe("C2H6");
    expect(structures[0].reason).toBe("");
    expect(structures[1].mol).toBeNull();
    expect(structures[1].reason).toMatch(/^the generic atom “X” has no single formula/);
  });
});

describe("subsetPage", () => {
  it("keeps only the structure picked (a whole document never goes onto the canvas)", () => {
    const d = page(ethane(100, 0, 0) + ethane(200, 0, 200) + `<t id="400" p="0 400"><s font="3" size="10">caption</s></t>`);
    const sub = subsetPage(d, new Set(["200"]))!;
    expect(sub.objects.map((o) => o.id)).toEqual(["200"]);
    // The original page is untouched.
    expect(d.objects.length).toBe(3);
  });
});
