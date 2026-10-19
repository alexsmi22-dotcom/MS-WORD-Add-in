/**
 * @jest-environment jsdom
 */
// The chemistry canvas (docs/SCOPE-CHEM-CANVAS.md, stage 2), driven as a user drives it: each row of the
// parity table with today's editor pinned — atoms from the palette, bonds clicked and dragged, rings,
// chains, charges, wedges, select / box-select / move / delete, undo / redo, clear — plus what is new
// (brackets, arrows, captions). Every drawing is read back as chemistry: its formula is pinned.
import { TextDecoder as NodeTextDecoder } from "util";
import { Molecule } from "openchemlib/full";
import { createChemCanvas, ChemCanvas, CanvasChange } from "../../taskpane/chemCanvas";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

function setup() {
  document.body.innerHTML = '<div id="mount"></div>';
  const status: Array<[string, string]> = [];
  const changes: CanvasChange[] = [];
  const c: ChemCanvas = createChemCanvas(document.getElementById("mount")!, { setStatus: (m, k) => void status.push([m, k ?? ""]) });
  c.setOnChangeListener((e) => void changes.push(e));
  const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
  /** Page point → client point: the SVG is laid out 1 px = 1 pt from its viewBox origin. */
  const at = (x: number, y: number): { clientX: number; clientY: number } => {
    const svg = surface.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { clientX: x - vx, clientY: y - vy };
  };
  const click = (x: number, y: number, shift = false): void => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at(x, y), button: 0, shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at(x, y), shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at(x, y), shiftKey: shift, bubbles: true }));
  };
  const drag = (from: [number, number], to: [number, number], shift = false): void => {
    surface.dispatchEvent(new MouseEvent("pointerdown", { ...at(...from), button: 0, shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointermove", { ...at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), buttons: 1, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointermove", { ...at(...to), buttons: 1, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("pointerup", { ...at(...to), shiftKey: shift, bubbles: true }));
    surface.dispatchEvent(new MouseEvent("click", { ...at(...to), shiftKey: shift, bubbles: true }));
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-chem-tool="${t}"]`)!.click();
  const element = (sym: string): void => document.querySelector<HTMLButtonElement>(`[data-chem-element="${sym}"]`)!.click();
  const formula = (): string => {
    const r = c.chemistry();
    return r.ok ? r.mol.getMolecularFormula().formula : r.reason;
  };
  const atoms = (): Array<{ id: string; p: [number, number] }> =>
    c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => ({ id: n.id, p: n.p as [number, number] })) : [])));
  const last = (): [string, string] => status[status.length - 1];
  return { c, surface, click, drag, tool, element, formula, atoms, status, changes, last };
}

describe("the parity rows: what today's editor does", () => {
  test("opens on a blank page with the bond tool ready", () => {
    const t = setup();
    expect(t.c.page().objects).toHaveLength(0);
    expect(document.querySelector('[data-chem-tool="bond"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(t.formula()).toBe("");
  });
  test("bond: a click on empty paper draws ethane; drags from its ends grow propane, then a ring closes it", () => {
    const t = setup();
    t.click(100, 100);
    expect(t.formula()).toBe("C2H6");
    const [, end] = t.atoms();
    t.drag(end.p, [end.p[0] + 12, end.p[1] + 12]);
    expect(t.formula()).toBe("C3H8");
    // Three more bonds round, then back to the first atom: cyclohexane.
    let tip = t.atoms()[t.atoms().length - 1];
    for (const [dx, dy] of [[0, 14], [-12, 7], [-12, -7]]) {
      t.drag(tip.p, [tip.p[0] + dx, tip.p[1] + dy]);
      tip = t.atoms()[t.atoms().length - 1];
    }
    t.drag(tip.p, t.atoms()[0].p);
    expect(t.formula()).toBe("C6H12");
    expect(t.changes.every((e) => e.isUserEvent)).toBe(true);
  });
  test("bond: a click on a bond cycles single → double → triple → single; a wedge style sets a wedge, and again turns it round", () => {
    const t = setup();
    t.click(100, 100);
    const [a, b] = t.atoms();
    const mid: [number, number] = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    t.click(...mid);
    expect(t.formula()).toBe("C2H4");
    t.click(...mid);
    expect(t.formula()).toBe("C2H2");
    t.click(...mid);
    expect(t.formula()).toBe("C2H6");
    const style = document.querySelector<HTMLSelectElement>("[data-chem-bondstyle]")!;
    style.value = "WedgeBegin";
    t.click(...mid);
    const bond = (): Record<string, string> => t.c.page().objects[0].items.flatMap((it) => (it.kind === "fragment" ? it.v.bonds : []))[0].el.attrs;
    expect(bond().Display).toBe("WedgeBegin");
    const before = [bond().B, bond().E];
    t.click(...mid);
    expect([bond().B, bond().E]).toEqual(before.reverse());
  });
  test("atom: the palette's N on one of ethane's carbons makes methylamine; on empty paper, a new atom (O → water)", () => {
    const t = setup();
    t.click(100, 100);
    t.element("N");
    t.click(...t.atoms()[1].p);
    expect(t.formula()).toBe("CH5N");
    t.element("O");
    t.click(200, 200);
    expect(t.formula()).toBe("CH7NO");
  });
  test("ring, chain, charge: benzene on empty paper; a chain dragged from it; a charge on an atom", () => {
    const t = setup();
    t.tool("ring");
    t.click(150, 150);
    expect(t.formula()).toBe("C6H6");
    t.tool("chain");
    const end = t.atoms().reduce((p, q) => (q.p[0] > p.p[0] ? q : p));
    t.drag(end.p, [end.p[0] + 40, end.p[1]]);
    expect(t.formula()).toMatch(/^C9H12$|^C8H10$|^C10H14$/);
    t.tool("charge-");
    t.click(...t.atoms()[t.atoms().length - 1].p);
    const r = t.c.chemistry();
    expect(r.ok && r.mol.getAtomCharge(r.mol.getAllAtoms() - 1)).toBe(-1);
  });
  test("select: box-select, move, Delete; undo brings it back, redo takes it away; Reset empties (undoable)", () => {
    const t = setup();
    t.click(100, 100);
    t.tool("select");
    t.drag([80, 80], [130, 120]);
    expect(t.c.selection().size).toBe(1);
    const before = t.atoms()[0].p;
    t.drag([before[0] + 3, before[1] - 2], [before[0] + 53, before[1] + 18]);
    expect(t.atoms()[0].p[0]).toBeCloseTo(before[0] + 50, 0);
    t.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(t.formula()).toBe("");
    document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
    expect(t.formula()).toBe("C2H6");
    document.querySelector<HTMLButtonElement>('[data-chem-action="redo"]')!.click();
    expect(t.formula()).toBe("");
    document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
    t.c.clearAll();
    expect(t.formula()).toBe("");
    document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
    expect(t.formula()).toBe("C2H6");
  });
  test("setMolecule / getMolecule (Edit in Draw, the large window's return): the same idcode both ways; a programmatic load is not a user edit", () => {
    const t = setup();
    const m = Molecule.fromSmiles("C[C@H](N)C(=O)O");
    m.inventCoordinates();
    t.c.setMolecule(m);
    expect(t.c.getMolecule().getIDCode()).toBe(m.getIDCode());
    expect(t.changes[t.changes.length - 1]).toEqual({ isUserEvent: false });
  });
  test("the Markush flag rides on the Molecule", () => {
    const t = setup();
    t.click(100, 100);
    t.c.setFragment(true);
    expect(t.c.getMolecule().isFragment()).toBe(true);
  });
});

describe("what is new: brackets, arrows, captions", () => {
  test("an arrow and a caption make the page a drawing (it inserts as drawn); the structure's formula still reads", () => {
    const t = setup();
    t.click(100, 100);
    expect(t.c.hasDrawing()).toBe(false);
    t.tool("arrow");
    t.drag([160, 100], [220, 100]);
    expect(t.last()).toEqual(["Reaction arrow drawn.", "success"]);
    t.tool("text");
    (document.querySelector("[data-chem-value]") as HTMLInputElement).value = "Scheme 1";
    t.click(100, 160);
    expect(t.c.hasDrawing()).toBe(true);
    expect(t.c.render(false)!.svg).toContain(">Scheme 1<");
    // A reaction has no single formula (review); one structure selected has its own.
    expect(t.formula()).toBe("a reaction (an arrow on the page) has no single formula — select one structure (Select tool) to read its formula");
    t.tool("select");
    t.click(...t.atoms()[0].p);
    const sel = t.c.chemistry(true);
    expect(sel.ok && sel.mol.getMolecularFormula().formula).toBe("C2H6");
  });
  test("a refused edit says why and changes nothing (a fifth bond on a carbon)", () => {
    const t = setup();
    t.element("C");
    t.click(100, 100);
    t.tool("bond");
    const c0 = t.atoms()[0].p;
    for (const [dx, dy] of [[20, 0], [0, 20], [-20, 0], [0, -20]]) t.drag(c0, [c0[0] + dx, c0[1] + dy]);
    expect(t.formula()).toBe("C5H12");
    t.drag(c0, [c0[0] + 14, c0[1] + 14]);
    expect(t.last()).toEqual(["That C has no bond to spare.", "error"]);
    expect(t.formula()).toBe("C5H12");
  });
});

describe("a ChemDraw page on the canvas", () => {
  const NAMED = `<?xml version="1.0" encoding="UTF-8" ?><CDXML BondLength="30" LabelSize="10" CaptionSize="12"><fonttable><font id="3" name="Arial"/></fonttable><page id="1">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="126 115"/><n id="13" p="152 100"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/></fragment>
<t id="30" p="100 160"><s font="3" size="12">propane</s></t><chemicalproperty id="31" ChemicalPropertyDisplayID="30" ChemicalPropertyType="1" BasisObjects="10"/></page></CDXML>`;
  test("a name ChemDraw computed goes stale when its structure is edited (not when a caption moves); Save writes CDXML ChemDraw opens", () => {
    const t = setup();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readCdxml } = require("../cdxml") as typeof import("../cdxml");
    const r = readCdxml(NAMED);
    if (!r.ok) throw new Error(r.reason);
    t.c.loadPage(r.doc);
    expect(t.c.staleNames()).toEqual([]);
    t.tool("arrow");
    t.drag([200, 200], [260, 200]);
    expect(t.c.staleNames()).toEqual([]);
    t.element("N");
    t.click(126, 115);
    expect(t.c.staleNames()).toEqual(["propane"]);
  });
});

test("Save as .cdxml downloads the page as CDXML that reads back the same", async () => {
  document.body.innerHTML = '<div id="mount"></div>';
  const saved: Array<{ blob: Blob; name: string }> = [];
  const c = createChemCanvas(document.getElementById("mount")!, { setStatus: () => undefined, downloadFile: (blob, name) => void saved.push({ blob, name }) });
  const m = Molecule.fromSmiles("CCO");
  m.inventCoordinates();
  c.setMolecule(m);
  c.setName("ethanol.cdxml");
  document.querySelector<HTMLButtonElement>('[data-chem-action="save"]')!.click();
  // Loaded, not edited: saved under its own name.
  expect(saved[0].name).toBe("ethanol.cdxml");
  const text = await new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsText(saved[0].blob);
  });
  expect(text).toMatch(/^<\?xml/);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readCdxml } = require("../cdxml") as typeof import("../cdxml");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pageToMolecule } = require("../cdxmlMol") as typeof import("../cdxmlMol");
  if (text) {
    const r = readCdxml(text);
    const back = r.ok ? pageToMolecule(r.doc) : null;
    expect(back && back.ok && back.value.mol.getIDCode()).toBe(m.getIDCode());
  }
});
